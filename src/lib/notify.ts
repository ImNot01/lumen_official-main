import { supabase } from './supabase'

export type PermState = 'default' | 'granted' | 'denied' | 'unsupported'
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
const pushSync = new Map<string, Promise<void>>()

export function getPermission(): PermState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as PermState
}

let swReady: Promise<ServiceWorkerRegistration | null> | null = null

/** Registers the notification service worker once. Safe to call repeatedly. */
export function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  if (!swReady) {
    swReady = navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => reg)
      .catch((error: unknown) => {
        swReady = null
        throw error
      })
  }
  return swReady
}

export async function requestPermission(): Promise<PermState> {
  if (!('Notification' in window)) return 'unsupported'
  const res = await Notification.requestPermission()
  return res as PermState
}

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

async function createPushSubscription(userId: string): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('Push notifications are not configured. Set VITE_VAPID_PUBLIC_KEY and deploy the Supabase push function.')
  if (getPermission() !== 'granted') throw new Error('Allow notifications for this site in your browser settings first.')
  const registration = await ensureServiceWorker()
  if (!registration || !('PushManager' in window)) throw new Error('Push notifications are not supported by this browser.')
  await navigator.serviceWorker.ready
  const vapidKey = decodeVapidKey(VAPID_PUBLIC_KEY)
  let subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    const currentKey = subscription.options.applicationServerKey
    const sameKey = currentKey && new Uint8Array(currentKey).every((byte, index) => byte === vapidKey[index]) &&
      new Uint8Array(currentKey).length === vapidKey.length
    if (!sameKey) {
      await subscription.unsubscribe()
      subscription = null
    }
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey,
  })
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!p256dh || !auth) throw new Error('The browser returned an incomplete push subscription.')
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
  })
  if (error) throw new Error(`Could not save this device for push notifications: ${error.message}`)
}

export function registerPushSubscription(userId: string): Promise<void> {
  const pending = pushSync.get(userId)
  if (pending) return pending
  const task = createPushSubscription(userId).finally(() => pushSync.delete(userId))
  pushSync.set(userId, task)
  return task
}

/**
 * Shows a system notification. Prefers the service worker (required by Android
 * Chrome for notifications to appear in the system tray) and falls back to the
 * plain Notification constructor where no service worker is available.
 * No-op where unsupported entirely (e.g. Safari on iPhone).
 */
export async function showNotification(title: string, body: string, url: string, tag?: string): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const options: NotificationOptions = { body, icon: '/favicon.svg', badge: '/favicon.svg', tag, data: { url } }

  let reg: ServiceWorkerRegistration | null = null
  try {
    reg = await ensureServiceWorker()
  } catch (error) {
    console.error('Unable to register the notification service worker', error)
  }
  if (reg) {
    try {
      await reg.showNotification(title, options)
      return
    } catch (error) {
      console.error('Unable to show a service-worker notification', error)
    }
  }
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      window.location.href = url
      n.close()
    }
  } catch (error) {
    console.error('Unable to show a browser notification', error)
  }
}
