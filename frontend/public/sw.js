const sw = self;
const SW_VERSION = "2";
const CACHE_NAME = `jacob-shell-v${SW_VERSION}`;
// Routes to pre-cache on install so the app shell loads offline.
const PRECACHE_URLS = ["/home", "/manifest.webmanifest"];
// ── install ────────────────────────────────────────────────────────────────
sw.addEventListener("install", (event) => {
    event.waitUntil(caches
        .open(CACHE_NAME)
        .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => undefined))
        .then(() => sw.skipWaiting()));
});
// ── activate ───────────────────────────────────────────────────────────────
sw.addEventListener("activate", (event) => {
    event.waitUntil(caches
        .keys()
        .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith("jacob-") && k !== CACHE_NAME)
        .map((k) => caches.delete(k))))
        .then(() => sw.clients.claim()));
});
// ── fetch ──────────────────────────────────────────────────────────────────
sw.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    // Passthrough: cross-origin, Firebase/Firestore SDK, backend API.
    if (url.origin !== sw.location.origin ||
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/__/")) {
        return;
    }
    // Stale-while-revalidate: Next.js static chunks (cache-busted by hash).
    if (url.pathname.startsWith("/_next/static/")) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }
    // Network-first with offline fallback: navigation and app shell.
    if (request.mode === "navigate" || url.pathname.startsWith("/_next/")) {
        event.respondWith(networkFirstWithFallback(request));
        return;
    }
});
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const networkPromise = fetch(request).then((res) => {
        if (res.ok)
            void cache.put(request, res.clone());
        return res;
    });
    return cached ?? networkPromise;
}
async function networkFirstWithFallback(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const res = await fetch(request);
        if (res.ok)
            void cache.put(request, res.clone());
        return res;
    }
    catch {
        const cached = await cache.match(request);
        if (cached)
            return cached;
        // Fall back to the cached home shell when any route is unavailable offline.
        const shell = await cache.match("/home");
        return shell ?? new Response("Offline", { status: 503, statusText: "Offline" });
    }
}
