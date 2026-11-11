export type Msg = {
  id: string
  conversation_id: string
  sender_id: string | null
  kind: string
  body: string | null
  reply_to_id: string | null
  client_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export type LocalMsg = Msg & { status: 'sending' | 'sent' | 'failed'; error?: string }

export type Reaction = { message_id: string; user_id: string; emoji: string }

export type ProfileLite = {
  id: string
  username: string
  display_name: string
  avatar_path: string | null
  last_seen: string
}

export type ChatRow = {
  cid: string
  ctype: 'direct' | 'group'
  cname: string | null
  cavatar: string | null
  other_id: string | null
  other_username: string | null
  other_display_name: string | null
  other_avatar: string | null
  last_id: string
  last_kind: string
  last_body: string | null
  last_sender: string | null
  last_deleted: boolean
  last_at: string
  unread: number
  pinned: boolean
  muted: boolean
  archived: boolean
}

export const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '😡', '🔥']
export const PAGE = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: string) => UUID_RE.test(s)

/** Works on http:// too (crypto.randomUUID needs https). */
export function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b).map((x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

export const ts = (iso: string) => new Date(iso).getTime()
export const cmpMsg = (a: Msg, b: Msg) => ts(a.created_at) - ts(b.created_at) || a.id.localeCompare(b.id)

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = startOfDay(new Date())
  const diff = Math.round((today - startOfDay(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function listTime(iso: string): string {
  const d = new Date(iso)
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (diff === 0) return clock(iso)
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function lastSeenText(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - ts(iso)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function previewOf(kind: string, body: string | null, deleted: boolean): string {
  if (deleted) return 'Message unsent'
  switch (kind) {
    case 'image': return 'Photo'
    case 'video': return 'Video'
    case 'audio': return 'Audio'
    case 'voice': return 'Voice message'
    case 'document': return 'Document'
    default: return body ?? ''
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * Supabase database calls only run once something waits for them.
 * Use fire() for "send and forget" calls so they actually run.
 */
export function fire(request: PromiseLike<unknown>): void {
  Promise.resolve(request).then(undefined, () => undefined)
}
