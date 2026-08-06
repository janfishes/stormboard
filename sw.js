/* Storm Board service worker.

   One job: keep the last good copy of the page in Cache Storage and serve it
   INSTANTLY on every open, then re-fetch the live page in the background and
   store it for the next open (stale-while-revalidate). Same design as My Tides
   and WTF, and it matters more here than in either of them: the open you most
   need this page for is the one where the power is out, the cell towers are
   congested and the forecast has already been read once.

   Two lessons carried over deliberately:

   1. The background refresh is fetch(SHELL_URL, {cache:'no-store'}), NOT
      fetch(e.request). A navigation request carries the default cache mode, so
      the refresh could itself be answered out of the browser's HTTP cache —
      and GitHub Pages serves with max-age=600. That put a second, ten-minute
      layer of stale on top of the one-open delay this design already has.

   2. A new build therefore always takes TWO opens by design: the first serves
      the saved copy, the refetch lands for the next. That is not a broken
      deploy. Before diagnosing one, check what is actually live:
        curl -s https://janfishes.github.io/stormboard/ | grep -o "BUILD_NUM = [0-9]*"

   The update pill in the page closes that gap on demand: its check is not a
   navigation, so it passes straight through to the network, sees the live
   BUILD_NUM, and its tap re-fetches the page into this cache before reloading.

   NOTHING ELSE IS CACHED, and that is a safety decision rather than a
   simplification. Every live feed on this page — the storm list, the cone, the
   surge series, the wind forecast, the county's shelter flags — must always go
   to the network. A cached storm forecast is worse than no storm forecast,
   because it looks exactly like a current one. The page is built to degrade
   card by card and to say which feed failed; it is never built to show you
   yesterday's hurricane. */

const SHELL_CACHE = 'stormboard-shell-v1';
const SHELL_URL = './index.html';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.add(new Request(SHELL_URL, { cache: 'no-store' })))
      .catch(() => {})               // offline install: the cache fills on first fetch instead
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;   // the page only; everything else goes to the network
  e.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(SHELL_URL).then((cached) => {
        const refresh = fetch(SHELL_URL, { cache: 'no-store' })
          .then((res) => {
            if (res && res.ok) cache.put(SHELL_URL, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) return cached;             // instant open; the refresh lands for next time
        return refresh.then((res) => res || new Response(
          'Offline, and no saved copy of Storm Board yet. Connect once and reopen.',
          { status: 503, headers: { 'Content-Type': 'text/plain' } }
        ));
      })
    )
  );
});
