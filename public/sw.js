// Lumen notification service worker.
// Android Chrome requires notifications to be shown through a service worker
// (ServiceWorkerRegistration.showNotification) rather than the page calling
// `new Notification()` directly; this file exists to satisfy that requirement
// and to route a notification tap back into the app.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {}
    try {
      payload = event.data ? event.data.json() : {}
    } catch (error) {
      console.error('Invalid push notification payload', error)
    }
    const url = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/'
    const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const alreadyViewing = openClients.some((client) => {
      try {
        return client.visibilityState === 'visible' && new URL(client.url).pathname === url
      } catch {
        return false
      }
    })
    if (alreadyViewing) return
    await self.registration.showNotification(
      typeof payload.title === 'string' ? payload.title : 'Lumen',
      {
        body: typeof payload.body === 'string' ? payload.body : 'You have a new message.',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: typeof payload.tag === 'string' ? payload.tag : undefined,
        renotify: false,
        requireInteraction: payload.type === 'call',
        vibrate: payload.type === 'call' ? [300, 100, 300, 100, 600] : undefined,
        data: { url },
      },
    )
  })())
})

self.addEventListener('notificationclick', (event) => {
  const requestedUrl = (event.notification.data && event.notification.data.url) || '/'
  const url = typeof requestedUrl === 'string' && requestedUrl.startsWith('/') ? requestedUrl : '/'
  event.notification.close()
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus()
          client.postMessage({ type: 'lumen-navigate', url })
          return
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url)
      }
    })(),
  )
})
