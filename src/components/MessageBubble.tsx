import { memo } from 'react'
import type { KeyboardEvent } from 'react'
import type { LocalMsg, Reaction } from '../lib/chat'
import { REACTIONS, clock } from '../lib/chat'

type Props = {
  msg: LocalMsg
  mine: boolean
  meId: string
  senderLabel?: string
  reactions: Reaction[]
  selected: boolean
  highlighted: boolean
  statusText: string | null
  replyId: string | null
  replyName: string
  replyText: string
  onSelect: (id: string) => void
  onReact: (id: string, emoji: string) => void
  onReply: (id: string) => void
  onCopy: (id: string) => void
  onEdit: (id: string) => void
  onUnsend: (id: string) => void
  onDeleteForMe: (id: string) => void
  onRetry: (id: string) => void
  onDiscard: (id: string) => void
  onJumpTo: (id: string) => void
}

const actionBtn =
  'rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/10'

function MessageBubbleBase(p: Props) {
  const { msg, mine } = p
  const deleted = Boolean(msg.deleted_at)
  const sent = msg.status === 'sent'
  const failed = msg.status === 'failed'

  const groups = new Map<string, { count: number; mine: boolean }>()
  for (const r of p.reactions) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false }
    g.count += 1
    if (r.user_id === p.meId) g.mine = true
    groups.set(r.emoji, g)
  }

  const bubble = deleted
    ? 'border border-dashed border-slate-300 italic text-slate-500 dark:border-white/20 dark:text-slate-400'
    : mine
      ? 'bg-brand-700 text-white dark:bg-brand-500 dark:text-slate-950'
      : 'border border-slate-200 bg-white text-slate-900 dark:border-transparent dark:bg-white/10 dark:text-slate-100'

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      p.onSelect(msg.id)
    }
  }

  return (
    <div
      id={`m-${msg.id}`}
      className={`flex flex-col ${mine ? 'items-end' : 'items-start'} animate-fade-in rounded-2xl transition-colors duration-300 ${p.highlighted ? 'bg-brand-500/15' : ''}`}
    >
      <div className="max-w-[82%] md:max-w-[70%]">
        {p.senderLabel && (
          <p className="mb-0.5 px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{p.senderLabel}</p>
        )}
        {p.replyId && !deleted && (
          <button
            type="button"
            onClick={() => p.onJumpTo(p.replyId as string)}
            className="mb-1 block w-full rounded-xl border-l-4 border-brand-600 bg-slate-200/70 px-3 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-brand-400 dark:bg-white/10"
          >
            <span className="block font-semibold">{p.replyName}</span>
            <span className="block truncate text-slate-600 dark:text-slate-300">{p.replyText}</span>
          </button>
        )}

        <div
          role="button"
          tabIndex={0}
          aria-expanded={p.selected}
          aria-label={`${mine ? 'Your' : 'Their'} message. Press to show actions.`}
          onClick={() => p.onSelect(msg.id)}
          onKeyDown={onKey}
          className={`cursor-pointer whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${bubble} ${failed ? 'ring-2 ring-red-500/60' : ''}`}
        >
          {deleted ? 'Message unsent' : msg.body}
        </div>

        {groups.size > 0 && (
          <div className={`-mt-1.5 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
            {Array.from(groups.entries()).map(([emoji, g]) => (
              <button
                key={emoji}
                type="button"
                aria-pressed={g.mine}
                aria-label={`${emoji} ${g.count}${g.mine ? ', you reacted' : ''}`}
                onClick={() => p.onReact(msg.id, emoji)}
                className={`rounded-full border px-2 py-0.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  g.mine
                    ? 'border-brand-600 bg-brand-50 text-brand-900 dark:border-brand-400 dark:bg-brand-500/20 dark:text-brand-100'
                    : 'border-slate-200 bg-white dark:border-white/10 dark:bg-[#161a22]'
                }`}
              >
                {emoji} {g.count}
              </button>
            ))}
          </div>
        )}

        <div className={`mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400 ${mine ? 'justify-end' : 'justify-start'}`}>
          <span>{clock(msg.created_at)}</span>
          {msg.edited_at && !deleted && <span>Edited</span>}
          {msg.status === 'sending' && <span>Sending...</span>}
          {sent && p.statusText && <span>{p.statusText}</span>}
        </div>

        {failed && (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs text-red-600 dark:text-red-400" role="alert">
            <span>Failed to send{msg.error ? `. ${msg.error}` : ''}</span>
            <button type="button" onClick={() => p.onRetry(msg.id)} className="rounded-lg px-2 py-1 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Retry</button>
            <button type="button" onClick={() => p.onDiscard(msg.id)} className="rounded-lg px-2 py-1 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Delete</button>
          </div>
        )}

        {p.selected && sent && (
          <div
            role="group"
            aria-label="Message actions"
            className="animate-pop-in mt-2 flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-[#161a22]"
          >
            {!deleted && (
              <div className="flex flex-wrap gap-0.5">
                {REACTIONS.map((e) => (
                  <button key={e} type="button" aria-label={`React with ${e}`} onClick={() => p.onReact(msg.id, e)} className="rounded-lg px-1.5 py-1 text-xl hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/10">
                    {e}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-0.5">
              {!deleted && <button type="button" className={actionBtn} onClick={() => p.onReply(msg.id)}>Reply</button>}
              {!deleted && <button type="button" className={actionBtn} onClick={() => p.onCopy(msg.id)}>Copy</button>}
              {mine && !deleted && msg.kind === 'text' && <button type="button" className={actionBtn} onClick={() => p.onEdit(msg.id)}>Edit</button>}
              {mine && !deleted && <button type="button" className={`${actionBtn} text-red-600 dark:text-red-400`} onClick={() => p.onUnsend(msg.id)}>Unsend</button>}
              <button type="button" className={`${actionBtn} text-red-600 dark:text-red-400`} onClick={() => p.onDeleteForMe(msg.id)}>Delete for me</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(MessageBubbleBase)
