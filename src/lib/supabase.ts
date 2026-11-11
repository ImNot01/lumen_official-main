import { createClient } from '@supabase/supabase-js'

function cleanUrl(raw?: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^["']|["']$/g, '')
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.supabase.co')) return null
    return u.origin
  } catch {
    return null
  }
}

const url = cleanUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined)
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const key = rawKey ? rawKey.trim().replace(/^["']|["']$/g, '') : null

export const configured = Boolean(url && key)
export const supabaseUrl: string = url ?? 'https://placeholder.supabase.co'
export const supabaseKey: string = key ?? 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Public URL of a profile picture stored in the "avatars" bucket. */
export function avatarUrl(path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/avatars/${path}`
}
