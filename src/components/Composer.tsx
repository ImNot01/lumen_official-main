import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { LocalMsg } from '../lib/chat'

const EMOJIS = ['😀', '😂', '😊', '😍', '🥰', '😘', '😎', '🤔', '😅', '😭', '😢', '😡', '🙏', '👍', '👎', '👏', '🙌', '💪', '🔥', '❤️', '💔', '🎉', '✨', '🌹', '😴', '🤯', '🥳', '😉', '🙂', '😬', '🤝', '👀']

type Props = {
  editing: LocalMsg | null
  reply: { name: string; text: string } | null
  onSend: (text: string) => void
  onSaveEdit: (text: string) => void
  onCancel: () => void
  onTyping: (typing: boolean) => void
}

export default function Composer({ editing, reply, onSend, onSaveEdit, onCancel, onTyping }: Props) {
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      setText(editing.body ?? '')
      ref.current?.focus()
    }
  }, [editing])

  useEffect(() => {
    if (reply) ref.current?.focus()
  }, [reply])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  function submit() {
    const t = text.trim()
    if (!t) return
    if (editing) onSaveEdit(t)
    else onSend(t)
    setText('')
    setEmojiOpen(false)
    onTyping(false)
    ref.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function addEmoji(emoji: string) {
    const el = ref.current
    if (!el) {
      setText((t) => t + emoji)
      return
    }
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    onTyping(true)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  return (
    <div
      className="border-t border-slate-200/80 bg-white/80 px-3 pt-2 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b0d12]/80"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {(editing || reply) && (
        <div className="animate-slide-up mb-2 flex items-center justify-between gap-3 rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-white/5">
          <div className="min-w-0">
            <p className="font-semibold">{editing ? 'Editing message' : `Replying to ${reply?.name}`}</p>
            {reply && !editing && <p className="truncate text-slate-500 dark:text-slate-400">{reply.text}</p>}
          </div>
          <button
            type="button"
            onClick={() => { setText(''); onCancel() }}
            className="shrink-0 rounded-lg px-2 py-1 font-medium text-slate-600 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-300 dark:hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      )}

      {emojiOpen && (
        <div className="animate-pop-in mb-2 grid grid-cols-8 gap-1 rounded-2xl border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-[#161a22]" role="group" aria-label="Emoji">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => addEmoji(e)} aria-label={`Insert ${e}`} className="rounded-lg py-1 text-xl hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/10">
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEmojiOpen((o) => !o)}
          aria-label="Emoji"
          aria-expanded={emojiOpen}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl transition-transform duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-90 dark:hover:bg-white/10"
        >
          🙂
        </button>
        <label htmlFor="composer" className="sr-only">Message</label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onTyping(e.target.value.trim().length > 0)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => onTyping(false)}
          placeholder="Message"
          maxLength={4000}
          enterKeyHint="enter"
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white/80 px-4 py-2.5 text-[16px] outline-none transition placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-500/30 dark:border-white/10 dark:bg-white/5 dark:focus:border-brand-400"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
          disabled={!text.trim()}
          className="btn-primary h-11 shrink-0 px-4 py-0"
        >
          {editing ? 'Save' : 'Send'}
        </button>
      </div>
    </div>
  )
}
