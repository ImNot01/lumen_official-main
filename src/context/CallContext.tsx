import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { uuid } from '../lib/chat'
import { useAuth } from './AuthContext'
import { useRealtime } from './RealtimeContext'

type CallStatus = 'ringing' | 'connecting' | 'connected' | 'failed'
type CallInfo = {
  id: string
  conversationId: string
  peerId: string
  peerName: string
  video: boolean
  direction: 'incoming' | 'outgoing'
  status: CallStatus
  error?: string
}
type SignalType = 'offer' | 'answer' | 'candidate' | 'hangup' | 'decline' | 'busy'
type Signal = {
  type: SignalType
  call_id: string
  conversation_id: string
  from: string
  to: string
  peer_name?: string
  video?: boolean
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}
type CallsState = {
  call: CallInfo | null
  micMuted: boolean
  deafened: boolean
  startCall: (conversationId: string, peerId: string, peerName: string, video: boolean) => Promise<void>
  acceptCall: () => Promise<void>
  declineCall: () => Promise<void>
  endCall: () => Promise<void>
  toggleMic: () => void
  toggleDeafen: () => void
  toggleVideo: () => void
  dismissError: () => void
}

const Ctx = createContext<CallsState | null>(null)

function iceServers(): RTCIceServer[] {
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const me = session?.user.id ?? ''
  const rt = useRealtime()
  const [call, setCall] = useState<CallInfo | null>(null)
  const [micMuted, setMicMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteAudioMuted, setRemoteAudioMuted] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const callRef = useRef<CallInfo | null>(null)
  const offerRef = useRef<RTCSessionDescriptionInit | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const remoteIceQueue = useRef<RTCIceCandidateInit[]>([])
  const pendingLocalIce = useRef<RTCIceCandidateInit[]>([])
  const sendLocalIceRef = useRef(false)
  const ringTimerRef = useRef<number | undefined>(undefined)
  const connectedRef = useRef(false)
  const connectedSinceRef = useRef<number | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  const updateCall = useCallback((next: CallInfo | null) => {
    callRef.current = next
    setCall(next)
  }, [])

  const send = useCallback(async (to: string, signal: Omit<Signal, 'from' | 'to'>) => {
    const { error } = await supabase.from('call_signals').insert({
      call_id: signal.call_id,
      conversation_id: signal.conversation_id,
      sender_id: me,
      recipient_id: to,
      type: signal.type,
      payload: {
        description: signal.description ?? null,
        candidate: signal.candidate ?? null,
        peer_name: signal.peer_name ?? null,
        video: signal.video ?? null,
      },
    })
    if (error) throw new Error(`Could not send call signal: ${error.message}`)
  }, [me])

  const applyAudioState = useCallback((muted: boolean, deaf: boolean) => {
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted && !deaf
    })
    if (remoteAudioRef.current) remoteAudioRef.current.muted = deaf
  }, [])

  const makePeer = useCallback((active: CallInfo) => {
    const peer = new RTCPeerConnection({ iceServers: iceServers() })
    peerRef.current = peer
    remoteIceQueue.current = []
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON()
        if (sendLocalIceRef.current) {
          void send(active.peerId, {
            type: 'candidate',
            call_id: active.id,
            conversation_id: active.conversationId,
            candidate,
          }).catch((error: unknown) => console.error('Unable to send call candidate', error))
        } else {
          pendingLocalIce.current.push(candidate)
        }
      }
    }
    peer.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream) setRemoteStream(stream)
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        connectedRef.current = true
        if (connectedSinceRef.current === null) connectedSinceRef.current = Date.now()
        window.clearTimeout(ringTimerRef.current)
        updateCall({ ...active, status: 'connected' })
      } else if (peer.connectionState === 'failed') {
        updateCall({ ...active, status: 'failed', error: 'Could not establish a direct connection. A TURN server may be required on this network.' })
      } else if (peer.connectionState === 'disconnected') {
        updateCall({ ...active, status: 'connecting' })
      } else if (peer.connectionState === 'closed') {
        setRemoteStream(null)
      }
    }
    return peer
  }, [send, updateCall])

  const addLocalTracks = useCallback((peer: RTCPeerConnection, stream: MediaStream) => {
    stream.getTracks().forEach((track) => peer.addTrack(track, stream))
    applyAudioState(micMuted, deafened)
    stream.getVideoTracks().forEach((track) => {
      track.enabled = videoEnabled
    })
  }, [applyAudioState, deafened, micMuted, videoEnabled])

  const cleanup = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null
    localRef.current?.getTracks().forEach((track) => track.stop())
    localRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    remoteIceQueue.current = []
    offerRef.current = null
    pendingLocalIce.current = []
    sendLocalIceRef.current = false
    connectedRef.current = false
    connectedSinceRef.current = null
    setElapsedSeconds(0)
    setMicMuted(false)
    setDeafened(false)
    setVideoEnabled(true)
    setRemoteAudioMuted(false)
    window.clearTimeout(ringTimerRef.current)
    ringTimerRef.current = undefined
    updateCall(null)
  }, [updateCall])

  const endCall = useCallback(async () => {
    const active = callRef.current
    if (active) {
      try {
        await send(active.peerId, {
          type: 'hangup',
          call_id: active.id,
          conversation_id: active.conversationId,
        })
      } catch (error) {
        console.error('Unable to notify the other participant that the call ended', error)
      }
    }
    cleanup()
  }, [cleanup, send])

  const startCall = useCallback(async (conversationId: string, peerId: string, peerName: string, video: boolean) => {
    if (!me || !peerId || callRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      updateCall({ id: '', conversationId, peerId, peerName, video, direction: 'outgoing', status: 'failed', error: 'Calling requires a secure connection (HTTPS) and a browser with media support.' })
      return
    }
    const active: CallInfo = { id: uuid(), conversationId, peerId, peerName, video, direction: 'outgoing', status: 'connecting' }
    updateCall(active)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
      localRef.current = stream
      setLocalStream(stream)
      const peer = makePeer(active)
      addLocalTracks(peer, stream)
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await send(peerId, {
        type: 'offer',
        call_id: active.id,
        conversation_id: conversationId,
        peer_name: profile?.display_name || 'Someone',
        video,
        description: offer,
      })
      if (!connectedRef.current) {
        updateCall({ ...active, status: 'ringing' })
        ringTimerRef.current = window.setTimeout(() => {
          if (callRef.current?.id !== active.id || callRef.current.status !== 'ringing') return
          void send(peerId, {
            type: 'hangup',
            call_id: active.id,
            conversation_id: conversationId,
          }).catch((error: unknown) => console.error('Unable to cancel unanswered call', error))
          cleanup()
          updateCall({ ...active, status: 'failed', error: 'No answer. The other person may be offline or not have this conversation open.' })
        }, 45000)
      }
      sendLocalIceRef.current = true
      for (const candidate of pendingLocalIce.current.splice(0)) {
        await send(peerId, { type: 'candidate', call_id: active.id, conversation_id: conversationId, candidate })
      }
    } catch (error) {
      cleanup()
      updateCall({ ...active, status: 'failed', error: error instanceof Error ? error.message : 'Could not start the call.' })
    }
  }, [addLocalTracks, cleanup, makePeer, me, profile?.display_name, send, updateCall])

  const acceptCall = useCallback(async () => {
    const active = callRef.current
    const offer = offerRef.current
    if (!active || active.direction !== 'incoming' || !offer) return
    if (!navigator.mediaDevices?.getUserMedia) {
      updateCall({ ...active, status: 'failed', error: 'Calling requires a secure connection (HTTPS) and a browser with media support.' })
      return
    }
    updateCall({ ...active, status: 'connecting' })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: active.video })
      localRef.current = stream
      setLocalStream(stream)
      const peer = makePeer(active)
      addLocalTracks(peer, stream)
      await peer.setRemoteDescription(offer)
      for (const candidate of remoteIceQueue.current.splice(0)) await peer.addIceCandidate(candidate)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      await send(active.peerId, {
        type: 'answer',
        call_id: active.id,
        conversation_id: active.conversationId,
        description: answer,
      })
      sendLocalIceRef.current = true
      for (const candidate of pendingLocalIce.current.splice(0)) {
        await send(active.peerId, { type: 'candidate', call_id: active.id, conversation_id: active.conversationId, candidate })
      }
    } catch (error) {
      cleanup()
      updateCall({ ...active, status: 'failed', error: error instanceof Error ? error.message : 'Could not answer the call.' })
    }
  }, [addLocalTracks, cleanup, makePeer, send, updateCall])

  const declineCall = useCallback(async () => {
    const active = callRef.current
    if (active) {
      try {
        await send(active.peerId, { type: 'decline', call_id: active.id, conversation_id: active.conversationId })
      } catch (error) {
        console.error('Unable to decline call', error)
      }
    }
    cleanup()
  }, [cleanup, send])

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream
      remoteAudioRef.current.muted = deafened || remoteAudioMuted
    }
  }, [deafened, remoteAudioMuted, remoteStream, localStream, call?.video])

  useEffect(() => {
    applyAudioState(micMuted, deafened)
  }, [applyAudioState, deafened, micMuted])

  useEffect(() => {
    if (call?.status !== 'connected') return
    const updateDuration = () => {
      if (connectedSinceRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - connectedSinceRef.current) / 1000))
      }
    }
    updateDuration()
    const timer = window.setInterval(updateDuration, 1000)
    return () => window.clearInterval(timer)
  }, [call?.id, call?.status])

  useEffect(() => {
    const off = rt.on('call', (value: unknown) => {
      const signal = value as Signal | undefined
      if (!signal || signal.to !== me || !signal.from || !signal.call_id || !signal.conversation_id) return
      const active = callRef.current
      if (signal.type === 'offer') {
        if (!signal.description) return
        if (active) {
          if (active.id !== signal.call_id) {
            void send(signal.from, { type: 'busy', call_id: signal.call_id, conversation_id: signal.conversation_id })
              .catch((error: unknown) => console.error('Unable to reject a busy call', error))
          }
          return
        }
        const incoming: CallInfo = {
          id: signal.call_id,
          conversationId: signal.conversation_id,
          peerId: signal.from,
          peerName: signal.peer_name || 'Someone',
          video: Boolean(signal.video),
          direction: 'incoming',
          status: 'ringing',
        }
        offerRef.current = signal.description
        updateCall(incoming)
        return
      }
      if (!active || signal.call_id !== active.id || signal.from !== active.peerId) return
      if (signal.type === 'answer' && signal.description && peerRef.current) {
        void peerRef.current.setRemoteDescription(signal.description).then(async () => {
          for (const candidate of remoteIceQueue.current.splice(0)) {
            await peerRef.current?.addIceCandidate(candidate)
          }
        }).catch((error: unknown) => console.error('Unable to apply call answer', error))
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (peerRef.current?.remoteDescription) {
          void peerRef.current.addIceCandidate(signal.candidate).catch((error: unknown) => console.error('Unable to add call candidate', error))
        } else {
          remoteIceQueue.current.push(signal.candidate)
        }
      } else if (signal.type === 'decline' || signal.type === 'busy') {
        cleanup()
        updateCall({
          ...active,
          status: 'failed',
          error: signal.type === 'busy' ? 'The other person is busy.' : 'The call was declined.',
        })
      } else if (signal.type === 'hangup') {
        cleanup()
      }
    })
    return off
  }, [cleanup, me, rt, send, updateCall])

  useEffect(() => {
    if (!me) cleanup()
  }, [cleanup, me])

  useEffect(() => () => cleanup(), [cleanup])

  const value = useMemo<CallsState>(() => ({
    call,
    micMuted,
    deafened,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMic: () => setMicMuted((muted) => !muted),
    toggleDeafen: () => setDeafened((deaf) => !deaf),
    toggleVideo: () => {
      const next = !videoEnabled
      setVideoEnabled(next)
      localRef.current?.getVideoTracks().forEach((track) => { track.enabled = next })
    },
    dismissError: cleanup,
  }), [acceptCall, call, cleanup, deafened, declineCall, endCall, micMuted, startCall, videoEnabled])

  return (
    <Ctx.Provider value={value}>
      {children}
      {call && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Call">
          <section className="w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-[#11141c] text-white shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="font-semibold">{call.direction === 'incoming' ? 'Incoming call' : call.video ? 'Video call' : 'Audio call'}</h2>
                <p className="text-sm text-slate-400">{call.peerName} · {call.status === 'connected' ? formatCallDuration(elapsedSeconds) : call.status === 'failed' ? 'Call failed' : call.status === 'ringing' ? 'Ringing' : 'Connecting...'}</p>
              </div>
              {call.direction === 'incoming' && call.status === 'ringing' && (
                <div className="flex gap-2">
                  <button type="button" className="btn-danger px-4 py-2" onClick={() => void declineCall()}>Decline</button>
                  <button type="button" className="btn-primary px-4 py-2" onClick={() => void acceptCall()}>Answer</button>
                </div>
              )}
            </header>
            {call.video && (
              <div className="relative grid min-h-64 grid-cols-1 gap-2 bg-black p-2 sm:grid-cols-2">
                <video ref={remoteVideoRef} autoPlay muted playsInline className="h-full min-h-64 w-full rounded-2xl bg-slate-900 object-cover" />
                <video ref={localVideoRef} autoPlay muted playsInline className="absolute bottom-4 right-4 h-28 w-40 rounded-2xl bg-slate-800 object-cover sm:static sm:h-full sm:min-h-64 sm:w-full" />
              </div>
            )}
            <audio ref={remoteAudioRef} autoPlay />
            {call.status === 'failed' && <p role="alert" className="px-5 pt-4 text-sm text-red-300">{call.error}</p>}
            <footer className="flex flex-wrap items-center justify-center gap-3 px-5 py-5">
              {call.direction !== 'incoming' || call.status !== 'ringing' ? (
                <>
                  <button type="button" aria-pressed={micMuted || deafened} onClick={() => setMicMuted((muted) => !muted)} className="btn-ghost border-white/15 text-white hover:bg-white/10" disabled={call.status === 'failed'}>{deafened ? 'Mic muted (undeafen to restore)' : micMuted ? 'Unmute' : 'Mute'}</button>
                  <button type="button" aria-pressed={deafened} onClick={() => setDeafened((deaf) => !deaf)} className="btn-ghost border-white/15 text-white hover:bg-white/10" disabled={call.status === 'failed'}>{deafened ? 'Undeafen' : 'Deafen'}</button>
                  {call.video && <button type="button" aria-pressed={!videoEnabled} onClick={() => {
                    setVideoEnabled((enabled) => {
                      localRef.current?.getVideoTracks().forEach((track) => { track.enabled = !enabled })
                      return !enabled
                    })
                  }} className="btn-ghost border-white/15 text-white hover:bg-white/10" disabled={call.status === 'failed'}>{videoEnabled ? 'Turn camera off' : 'Turn camera on'}</button>}
                  <button type="button" aria-pressed={remoteAudioMuted} onClick={() => setRemoteAudioMuted((muted) => !muted)} className="btn-ghost border-white/15 text-white hover:bg-white/10" disabled={call.status === 'failed'}>{remoteAudioMuted ? 'Hear audio' : 'Mute speaker'}</button>
                </>
              ) : null}
              {call.direction !== 'incoming' || call.status !== 'ringing' ? (
                <button type="button" className="btn-danger px-5 py-2" onClick={() => call.status === 'failed' ? cleanup() : void endCall()}>{call.status === 'failed' ? 'Close' : 'End call'}</button>
              ) : null}
            </footer>
          </section>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useCalls(): CallsState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useCalls must be used inside CallProvider')
  return value
}
