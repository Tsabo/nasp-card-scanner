/**
 * @file Service worker: lets the app open and work without a signal.
 *
 * A service worker is a script the browser runs in the background for this
 * site. It sits between the page and the network:
 *
 * - App files are fetched from the network when online (so updates arrive)
 *   and saved to a cache; when offline, the cached copy is used.
 * - Fonts never change, so the cached copy is used whenever there is one.
 *
 * This file is compiled separately from the app (see tsconfig.sw.json)
 * because it runs in a worker, not on the page. It is a plain script rather
 * than a module, since not every browser accepts module service workers.
 */

// Filled in by scripts/build.ts: a version that changes whenever any file
// changes, and the list of every file in the built site.
declare const CACHE_VERSION: string;
declare const APP_FILES: readonly string[];

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// In a worker, `self` is the worker itself. TypeScript's WebWorker library
// types it generically, so name the service-worker version once here.
const serviceWorker = self as unknown as ServiceWorkerGlobalScope;

// Install: download every app file into a fresh cache.
serviceWorker.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => serviceWorker.skipWaiting()),
  );
});

// Activate: delete caches left by older versions.
serviceWorker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
        ),
      )
      .then(() => serviceWorker.clients.claim()),
  );
});

serviceWorker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === serviceWorker.location.origin) {
    event.respondWith(networkFirst(request));
  }
  // Anything else goes straight to the network as normal.
});

/** Uses the cached copy if there is one, otherwise fetches and caches it. */
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  const cache = await caches.open(CACHE_VERSION);
  await cache.put(request, response.clone());
  return response;
}

/**
 * Fetches from the network and refreshes the cache, falling back to the
 * cached copy (or the app's start page) when offline.
 */
async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached =
      (await caches.match(request, { ignoreSearch: true })) ?? (await caches.match("index.html"));
    return cached ?? Response.error();
  }
}
