// Festify Service Worker
const CACHE = 'festify-v1'

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim())
})

// Push notification handler (for background messages)
self.addEventListener('push', e => {
  if (!e.data) return
  let payload
  try { payload = e.data.json() } catch { payload = { title: 'Festify', body: e.data.text() } }

  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'festify-msg',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: payload.url || '/chat' },
    actions: payload.actions || [],
  }
  e.waitUntil(self.registration.showNotification(payload.title || 'Festify', options))
})

// Notification click → open app
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/chat'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus(); return
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
