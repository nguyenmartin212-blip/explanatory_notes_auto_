/* The Vite build prepends the app asset paths and a build-specific cache name. */
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names
    .filter((name) => name.startsWith('gth-shell-') && name !== SHELL_CACHE)
    .map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === self.location.origin &&
      (url.pathname === '/' || url.pathname.startsWith('/poi/'))) {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.status < 500) return response;
      return (await caches.match('/', { cacheName: SHELL_CACHE })) ?? response;
    }).catch(async () => (await caches.match('/', { cacheName: SHELL_CACHE })) ?? Response.error()));
  } else if (url.origin === self.location.origin && SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname, {
      cacheName: SHELL_CACHE,
      ignoreVary: true,
    }).then((hit) => hit || fetch(request)));
  } else if (request.destination === 'image') {
    event.respondWith(fetch(request).then(async (response) =>
      response.ok || response.type === 'opaque' ? response :
        (await caches.match(request, { ignoreVary: true })) ?? response
    ).catch(async () => (await caches.match(request, { ignoreVary: true })) ?? Response.error()));
  }
});
