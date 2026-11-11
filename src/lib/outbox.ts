export type OutboxItem = {
  client_id: string
  conversation_id: string
  body: string
  reply_to_id: string | null
  queued_at: string
}

const key = (uid: string) => `lumen:outbox:${uid}`

function read(uid: string): OutboxItem[] {
  try {
    const raw = localStorage.getItem(key(uid))
    const v: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? (v as OutboxItem[]) : []
  } catch {
    return []
  }
}

function write(uid: string, items: OutboxItem[]) {
  try {
    localStorage.setItem(key(uid), JSON.stringify(items))
  } catch {
    /* storage unavailable */
  }
}

export function getOutbox(uid: string, conversationId?: string): OutboxItem[] {
  const all = read(uid)
  return conversationId ? all.filter((i) => i.conversation_id === conversationId) : all
}

export function addOutbox(uid: string, item: OutboxItem) {
  const list = read(uid).filter((i) => i.client_id !== item.client_id)
  list.push(item)
  write(uid, list)
}

export function removeOutbox(uid: string, clientId: string | null | undefined) {
  if (!clientId) return
  write(uid, read(uid).filter((i) => i.client_id !== clientId))
}
