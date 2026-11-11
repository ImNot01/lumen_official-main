import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { USERNAME_RE } from '../lib/errors'
import { processAvatar } from '../lib/image'
import { uploadWithProgress } from '../lib/upload'
import { useAuth } from '../context/AuthContext'
import type { Profile } from '../context/AuthContext'
import { Avatar } from '../components/Avatar'
import { Alert, Field, Spinner, Splash, ThemeToggle } from '../components/ui'

type UState = 'same' | 'checking' | 'ok' | 'taken' | 'invalid' | 'error'
type Msg = { kind: 'error' | 'success'; text: string } | null

export default function ProfilePage() {
  const { profile, session } = useAuth()
  if (!profile || !session) return <Splash />
  return <Editor profile={profile} email={session.user.email ?? ''} />
}

function Editor({ profile, email }: { profile: Profile; email: string }) {
  const { refreshProfile, signOut } = useAuth()

  // ----- details form -----
  const [name, setName] = useState(profile.display_name)
  const [uname, setUname] = useState(profile.username)
  const [bio, setBio] = useState(profile.bio)
  const [uState, setUState] = useState<UState>('same')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    const u = uname.trim().toLowerCase()
    if (u === profile.username) {
      setUState('same')
      return
    }
    if (!USERNAME_RE.test(u)) {
      setUState('invalid')
      return
    }
    setUState('checking')
    let cancelled = false
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('is_username_available', { u })
      if (cancelled) return
      setUState(error ? 'error' : data ? 'ok' : 'taken')
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [uname, profile.username])

  const unameHint = {
    same: null,
    checking: <span className="text-slate-500 dark:text-slate-400">Checking availability...</span>,
    ok: <span className="text-emerald-600 dark:text-emerald-400">Username is available.</span>,
    taken: <span className="text-red-600 dark:text-red-400">That username is taken.</span>,
    invalid: <span className="text-red-600 dark:text-red-400">Use 3-24 lowercase letters, numbers, dots or underscores.</span>,
    error: <span className="text-amber-600 dark:text-amber-400">Could not check right now.</span>,
  }[uState]

  const dirty =
    name.trim() !== profile.display_name || uname.trim().toLowerCase() !== profile.username || bio.trim() !== profile.bio

  async function saveDetails(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const dn = name.trim()
    const u = uname.trim().toLowerCase()
    const b = bio.trim()
    if (!dn) return setMsg({ kind: 'error', text: 'Enter your name.' })
    if (!USERNAME_RE.test(u)) return setMsg({ kind: 'error', text: 'Choose a valid username.' })
    if (uState === 'taken') return setMsg({ kind: 'error', text: 'That username is taken. Pick another one.' })
    if (b.length > 200) return setMsg({ kind: 'error', text: 'Bio can be at most 200 characters.' })
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: dn, username: u, bio: b })
        .eq('id', profile.id)
        .select('id')
      if (error) {
        setMsg({
          kind: 'error',
          text: error.code === '23505' ? 'That username is taken. Pick another one.' : error.message,
        })
        return
      }
      if (!data || data.length === 0) {
        setMsg({ kind: 'error', text: 'Could not save your changes. Try again.' })
        return
      }
      await refreshProfile()
      setMsg({ kind: 'success', text: 'Profile saved.' })
    } catch (ex) {
      setMsg({ kind: 'error', text: ex instanceof Error ? ex.message : 'Could not save. Check your connection.' })
    } finally {
      setSaving(false)
    }
  }

  // ----- profile picture -----
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [photoMsg, setPhotoMsg] = useState<Msg>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    const url = pending?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [pending])

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoMsg(null)
    setProcessing(true)
    try {
      const blob = await processAvatar(file)
      setPending({ blob, url: URL.createObjectURL(blob) })
    } catch (ex) {
      setPhotoMsg({ kind: 'error', text: ex instanceof Error ? ex.message : 'Could not read that image.' })
    } finally {
      setProcessing(false)
    }
  }

  async function savePhoto() {
    if (!pending) return
    setPhotoMsg(null)
    setProgress(0)
    const oldPath = profile.avatar_path
    const ext = pending.blob.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${profile.id}/${Date.now()}.${ext}`
    try {
      await uploadWithProgress('avatars', path, pending.blob, setProgress)
      const { data, error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', profile.id).select('id')
      if (error || !data || data.length === 0) {
        await supabase.storage.from('avatars').remove([path])
        throw new Error(error?.message ?? 'Could not save your new picture. Your old one is unchanged.')
      }
      await refreshProfile()
      setPending(null)
      setPhotoMsg({ kind: 'success', text: 'Profile picture updated.' })
      if (oldPath) void supabase.storage.from('avatars').remove([oldPath])
    } catch (ex) {
      setPhotoMsg({
        kind: 'error',
        text: (ex instanceof Error ? ex.message : 'Upload failed.') + ' Your previous picture is unchanged.',
      })
    } finally {
      setProgress(null)
    }
  }

  async function removePhoto() {
    if (!profile.avatar_path) return
    setPhotoMsg(null)
    setRemoving(true)
    const oldPath = profile.avatar_path
    try {
      const { data, error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', profile.id).select('id')
      if (error || !data || data.length === 0) throw new Error(error?.message ?? 'Could not remove the picture.')
      await refreshProfile()
      void supabase.storage.from('avatars').remove([oldPath])
      setPhotoMsg({ kind: 'success', text: 'Profile picture removed.' })
    } catch (ex) {
      setPhotoMsg({ kind: 'error', text: ex instanceof Error ? ex.message : 'Could not remove the picture.' })
    } finally {
      setRemoving(false)
    }
  }

  // ----- account deletion -----
  const [showDelete, setShowDelete] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function deleteAccount() {
    setDeleteError(null)
    setDeleting(true)
    try {
      const { error } = await supabase.rpc('delete_my_account')
      if (error) {
        setDeleteError(error.message)
        return
      }
      await signOut()
    } catch (ex) {
      setDeleteError(ex instanceof Error ? ex.message : 'Could not delete the account.')
    } finally {
      setDeleting(false)
    }
  }

  const uploading = progress !== null

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>

      <section className="glass p-6" aria-labelledby="photo-h">
        <h2 id="photo-h" className="text-base font-semibold">Profile picture</h2>
        <div className="mt-4 flex items-center gap-5">
          <Avatar src={pending?.url} path={profile.avatar_path} name={profile.display_name} size={88} />
          <div className="flex min-w-0 flex-col gap-2">
            {!pending ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => void onPick(e)}
                />
                <button type="button" className="btn-ghost" disabled={processing || removing} onClick={() => fileRef.current?.click()}>
                  {processing && <Spinner className="h-4 w-4" />} {profile.avatar_path ? 'Change picture' : 'Upload picture'}
                </button>
                {profile.avatar_path && (
                  <button
                    type="button"
                    className="text-left text-sm font-medium text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400"
                    disabled={removing}
                    onClick={() => void removePhoto()}
                  >
                    {removing ? 'Removing...' : 'Remove picture'}
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500 dark:text-slate-400">Preview. Not saved yet.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={uploading} onClick={() => void savePhoto()}>
                    {uploading && <Spinner className="h-4 w-4" />} Save picture
                  </button>
                  <button type="button" className="btn-ghost" disabled={uploading} onClick={() => { setPending(null); setPhotoMsg(null) }}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {uploading && (
          <div className="mt-4">
            <div
              className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress ?? 0}
              aria-label="Upload progress"
            >
              <div className="h-full rounded-full bg-brand-600 transition-[width] dark:bg-brand-400" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Uploading {progress}%</p>
          </div>
        )}
        {photoMsg && <div className="mt-4"><Alert kind={photoMsg.kind}>{photoMsg.text}</Alert></div>}
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">JPG, PNG, WEBP, GIF (HEIC where your browser supports it). Large photos are resized automatically.</p>
      </section>

      <section className="glass p-6" aria-labelledby="details-h">
        <h2 id="details-h" className="text-base font-semibold">Details</h2>
        <form onSubmit={saveDetails} className="mt-4 space-y-4" noValidate>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <Field label="Name" id="p_name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="name" />
          <Field
            label="Username"
            id="p_username"
            value={uname}
            onChange={(e) => setUname(e.target.value.toLowerCase())}
            maxLength={24}
            autoCapitalize="none"
            spellCheck={false}
            hint={unameHint}
          />
          <div>
            <label htmlFor="p_bio" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Bio</label>
            <textarea id="p_bio" className="input min-h-[96px] resize-y" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} placeholder="Tell people about yourself" />
            <p className="mt-1.5 text-right text-sm text-slate-500 dark:text-slate-400">{bio.length}/200</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Email</p>
            <p className="truncate text-[15px] text-slate-500 dark:text-slate-400">{email}</p>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={saving || !dirty || uState === 'checking' || uState === 'taken' || uState === 'invalid'}>
            {saving && <Spinner className="h-4 w-4" />} Save changes
          </button>
        </form>
      </section>

      <section className="glass flex items-center justify-between gap-4 p-6" aria-labelledby="appearance-h">
        <h2 id="appearance-h" className="text-base font-semibold">Appearance</h2>
        <ThemeToggle />
      </section>

      <section className="glass space-y-3 p-6" aria-labelledby="account-h">
        <h2 id="account-h" className="text-base font-semibold">Account</h2>
        <button type="button" className="btn-ghost w-full" onClick={() => void signOut()}>Sign out</button>
        {!showDelete ? (
          <button
            type="button"
            className="w-full py-2 text-sm font-medium text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400"
            onClick={() => setShowDelete(true)}
          >
            Delete my account
          </button>
        ) : (
          <div className="space-y-3 rounded-2xl border border-red-200 p-4 dark:border-red-500/30">
            <p className="text-sm">
              This permanently deletes your account and profile. Type <strong>{profile.username}</strong> to confirm.
            </p>
            {deleteError && <Alert kind="error">{deleteError}</Alert>}
            <input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type your username to confirm" autoCapitalize="none" />
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={() => { setShowDelete(false); setConfirmText(''); setDeleteError(null) }}>
                Cancel
              </button>
              <button type="button" className="btn-danger flex-1" disabled={deleting || confirmText !== profile.username} onClick={() => void deleteAccount()}>
                {deleting && <Spinner className="h-4 w-4" />} Delete forever
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
