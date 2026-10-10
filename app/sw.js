// Keeps the app installable without caching anything: every request goes straight to the network.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

// Takes over open pages and deletes every cache left behind by earlier versions of this worker.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// A fetch handler is required for installability; it only forwards the request.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
