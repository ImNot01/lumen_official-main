import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webPush from 'npm:web-push@3.6.7'

type Message = {
  id: string
  conversation_id: string
  sender_id: string | null
  kind: string
  body: string | null
}
type SubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
}

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function messagePreview(message: Message): string {
  if (message.kind === 'text') return (message.body || 'New message').slice(0, 180)
  if (message.kind === 'image') return 'Sent a photo'
  if (message.kind === 'video') return 'Sent a video'
  if (message.kind === 'voice' || message.kind === 'audio') return 'Sent an audio message'
  if (message.kind === 'document') return 'Sent a document'
  return 'Sent a message'
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const expectedSecret = Deno.env.get('LUMEN_PUSH_WEBHOOK_SECRET')
  if (!expectedSecret || request.headers.get('x-push-secret') !== expectedSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error('Push function configuration is incomplete')
    return json({ error: 'Push function is not configured' }, 500)
  }

  let messageId: string | null = null
  let callSignalId: string | null = null
  try {
    const body = await request.json()
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (typeof body.message_id === 'string' && uuid.test(body.message_id)) {
      messageId = body.message_id
    } else if (typeof body.call_signal_id === 'string' && uuid.test(body.call_signal_id)) {
      callSignalId = body.call_signal_id
    } else {
      return json({ error: 'Invalid message id' }, 400)
    }
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  if (callSignalId) {
    const { data: signal, error: signalError } = await db
      .from('call_signals')
      .select('conversation_id, sender_id, recipient_id, type, payload')
      .eq('id', callSignalId)
      .maybeSingle()
    if (signalError) {
      console.error('Could not load call signal for push delivery', signalError.message)
      return json({ error: 'Could not load call signal' }, 500)
    }
    if (!signal || signal.type !== 'offer') return json({ sent: 0 })

    const { data: caller, error: callerError } = await db
      .from('profiles')
      .select('display_name')
      .eq('id', signal.sender_id)
      .maybeSingle()
    if (callerError) {
      console.error('Could not load caller for push delivery', callerError.message)
      return json({ error: 'Could not load caller' }, 500)
    }
    const { data: subscriptions, error: subscriptionError } = await db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', signal.recipient_id)
    if (subscriptionError) {
      console.error('Could not load call push subscriptions', subscriptionError.message)
      return json({ error: 'Could not load subscriptions' }, 500)
    }
    if (!subscriptions?.length) return json({ sent: 0 })

    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const isVideo = Boolean(signal.payload?.video)
    const payload = JSON.stringify({
      title: caller?.display_name || 'Incoming call',
      body: `Incoming ${isVideo ? 'video' : 'audio'} call`,
      url: `/chat/${signal.conversation_id}`,
      tag: `lumen-call-${callSignalId}`,
      type: 'call',
    })
    const results = await Promise.allSettled(
      (subscriptions as SubscriptionRow[]).map(async (subscription) => {
        try {
          await webPush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, payload)
          return true
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            const { error: deleteError } = await db
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', subscription.endpoint)
            if (deleteError) console.error('Could not remove expired push subscription', deleteError.message)
          } else {
            console.error('Call push delivery failed', statusCode ?? 'unknown status')
          }
          return false
        }
      }),
    )
    return json({ sent: results.filter((result) => result.status === 'fulfilled' && result.value).length })
  }

  if (!messageId) return json({ error: 'Invalid message id' }, 400)
  const { data: message, error: messageError } = await db
    .from('messages')
    .select('id, conversation_id, sender_id, kind, body')
    .eq('id', messageId)
    .maybeSingle()
  if (messageError) {
    console.error('Could not load message for push delivery', messageError.message)
    return json({ error: 'Could not load message' }, 500)
  }
  if (!message || !message.sender_id) return json({ sent: 0 })

  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('type, name')
    .eq('id', message.conversation_id)
    .maybeSingle()
  if (conversationError) {
    console.error('Could not load conversation for push delivery', conversationError.message)
    return json({ error: 'Could not load conversation' }, 500)
  }
  const { data: sender, error: senderError } = await db
    .from('profiles')
    .select('display_name')
    .eq('id', message.sender_id)
    .maybeSingle()
  if (senderError) {
    console.error('Could not load sender for push delivery', senderError.message)
    return json({ error: 'Could not load sender' }, 500)
  }

  const { data: members, error: memberError } = await db
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', message.conversation_id)
    .eq('muted', false)
    .neq('user_id', message.sender_id)
  if (memberError) {
    console.error('Could not load message recipients', memberError.message)
    return json({ error: 'Could not load recipients' }, 500)
  }
  const recipientIds = (members ?? []).map((member) => member.user_id as string)
  if (!recipientIds.length) return json({ sent: 0 })

  const { data: subscriptions, error: subscriptionError } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', recipientIds)
  if (subscriptionError) {
    console.error('Could not load push subscriptions', subscriptionError.message)
    return json({ error: 'Could not load subscriptions' }, 500)
  }
  if (!subscriptions?.length) return json({ sent: 0 })

  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  const title = conversation?.type === 'group'
    ? conversation.name || 'New group message'
    : sender?.display_name || 'New message'
  const url = `/chat/${message.conversation_id}`
  const payload = JSON.stringify({
    title,
    body: messagePreview(message as Message),
    url,
    tag: `lumen-message-${message.id}`,
  })

  const results = await Promise.allSettled(
    (subscriptions as SubscriptionRow[]).map(async (subscription) => {
      try {
        await webPush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload)
        return true
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await db
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', subscription.endpoint)
          if (deleteError) console.error('Could not remove expired push subscription', deleteError.message)
        } else {
          console.error('Push delivery failed', statusCode ?? 'unknown status')
        }
        return false
      }
    }),
  )

  return json({ sent: results.filter((result) => result.status === 'fulfilled' && result.value).length })
})
