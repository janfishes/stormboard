/* Storm proxy — a Cloudflare Worker for Storm Board.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two of the five feeds Storm Board rests on cannot be read by a browser
 * directly, for two different reasons, and both were MEASURED on 2026-08-06
 * rather than assumed:
 *
 *   1. https://www.nhc.noaa.gov/CurrentStorms.json sends NO
 *      Access-Control-Allow-Origin header at all.
 *
 *      The cone ZIPs under /gis/ are worse than that, because they LOOK fine.
 *      `curl -H 'Origin: …'` gets `access-control-allow-origin: *` back from
 *      them every time — but a real browser fetch fails with a bare
 *      "TypeError: Failed to fetch". CloudFront is caching a variant of the
 *      object WITHOUT the CORS header (there is no `Vary: Origin`) and serving
 *      whichever copy the edge happens to hold. So whether the cone loads is a
 *      cache lottery that curl cannot see and that would be won and lost at
 *      random, storm by storm. Measured in headless Chrome 2026-08-06.
 *
 *      That is the same class of dependency as the public CORS relays this
 *      family of apps already abandoned, so the cone comes through here too.
 *
 *   2. P-ETSS — the surge forecast — is not a file at all. It is a POST to a
 *      PHP endpoint (slosh.nws.noaa.gov/etsurge2.0/fixed/php/getData.php) that
 *      answers with Content-Type text/html and no CORS header. That endpoint is
 *      the ONLY place a forecast surge height at Ponce Inlet exists, and the
 *      surge-at-your-dock card — the thing this whole app is for — is built on
 *      it. So it is worth owning the access rather than doing without.
 *
 * This is a SEPARATE worker from ndbc-proxy, deliberately. That one is load
 * bearing for My Tides AND for WTF; adding routes to it to serve a third app
 * would put two live boat tools at risk of a bad deploy of a third. Workers are
 * free and a new one costs nothing but a name.
 *
 * WHAT IT DOES
 * ------------
 *   GET /nhc                       -> NHC CurrentStorms.json, cached 5 min
 *   GET /petss?station=8721147     -> P-ETSS point series as JSON, cached 30 min
 *   GET /cone?id=al142024&adv=014  -> the 5-day cone/track shapefile ZIP, cached 10 min
 *                                     (adv defaults to "latest")
 *
 * It does not parse, store or log anything, and it holds NO SECRETS — so there
 * is nothing here that needs rotating if the repo changes hands.
 *
 * The cache windows are matched to how often the upstream actually changes, not
 * to how often someone might tap refresh. NHC issues advisories on a 6-hourly
 * cycle with intermediate updates; P-ETSS runs 4x a day (its PDY.txt read
 * 2026080612 when this was written). Asking more often than that is hammering a
 * public service to be told the same thing, and during a real storm those
 * services are under load from the entire east coast at once. Being cheap to
 * serve is part of the job.
 *
 * DEPLOY
 * ------
 *   cd worker && npx wrangler login && npx wrangler deploy
 * then put the printed URL into STORM_PROXY in index.html.
 */

const CURRENT_STORMS = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const PETSS_URL = 'https://slosh.nws.noaa.gov/etsurge2.0/fixed/php/getData.php';
const NHC_GIS = 'https://www.nhc.noaa.gov/gis/forecast/archive/';

const NHC_CACHE_SECONDS = 300;
const PETSS_CACHE_SECONDS = 1800;
const CONE_CACHE_SECONDS = 600;

/* Origins allowed to call this. Keep it short: an open proxy is an invitation
 * to have your quota spent by strangers. The first entry is the fallback used
 * when a request arrives with no Origin at all (curl, a health check). */
const ALLOWED_ORIGINS = [
  'https://janfishes.github.io',   // serves Storm Board, My Tides, Mini Mapper and WTF —
];                                 // an origin is scheme+host, so the path is irrelevant

/* Any localhost port, for previewing with `python3 -m http.server`. Pinning a
 * single port is what broke the first test of the NDBC worker: the apps use
 * different ports and the worker rejected whichever was not listed. A loopback
 * origin cannot be reached by anyone else's browser and the payload is public
 * NOAA data either way, so this costs nothing. */
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

function corsHeaders(request, maxAge) {
  const origin = request.headers.get('Origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || LOCALHOST.test(origin);
  const allow = ok ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Cache-Control': `public, max-age=${maxAge}`,
  };
}

const json = (obj, cors, extra) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', ...(extra || {}) },
  });

const fail = (msg, status, cors) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });

/* Cached fetch through Cloudflare's own edge cache.
 *
 * The cache key must be a GET Request with a URL — the Cache API will not key
 * on a body — which is why the P-ETSS station id is folded into a synthetic key
 * PATH rather than the POST body being used as the key.
 *
 * That synthetic key is built on the WORKER'S OWN ORIGIN, and that detail is
 * load bearing. The first cut used a made-up host (`https://cache.invalid/...`)
 * and the /nhc route then failed with a Cloudflare 1042 roughly one request in
 * three — intermittently, which is the worst way for it to fail, because two
 * green checks in a row look like proof it works. The edge will only key the
 * cache on a hostname it actually serves.
 *
 * Every cache operation is also wrapped so it CANNOT take the route down. The
 * cache is an optimisation; the data path is the product. A worker that answers
 * slowly beats one that answers 502 because a cache write threw. */
async function cached(ctx, keyPath, seconds, produce) {
  const cache = caches.default;
  const cacheKey = new Request(keyPath, { method: 'GET' });

  try {
    const hit = await cache.match(cacheKey);
    if (hit) return { body: await hit.text(), cache: 'HIT' };
  } catch (e) { /* fall through to a live fetch */ }

  const body = await produce();
  try {
    ctx.waitUntil(cache.put(cacheKey, new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${seconds}`,
      },
    })));
  } catch (e) { /* uncached is fine; wrong answers are not */ }
  return { body, cache: 'MISS' };
}

const cacheKeyFor = (request, name) => new URL(request.url).origin + '/__cache/' + name;

async function handleNhc(request, ctx, cors) {
  let out;
  try {
    out = await cached(ctx, cacheKeyFor(request, 'nhc'), NHC_CACHE_SECONDS, async () => {
      const res = await fetch(CURRENT_STORMS, {
        headers: { 'User-Agent': 'storm-board (jan@aceshardware.com)' },
        cf: { cacheTtl: NHC_CACHE_SECONDS, cacheEverything: true },
      });
      if (!res.ok) throw new Error('upstream ' + res.status);
      const text = await res.text();
      // Must parse and must have the key we depend on. An NHC error page wearing
      // a 200 would otherwise be cached for five minutes, turning a blip into an
      // outage — and this is the feed that says whether a storm exists at all,
      // so a wrong answer here reads as "all clear".
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.activeStorms)) throw new Error('no activeStorms array');
      return JSON.stringify(data);
    });
  } catch (e) {
    return fail('NHC unreachable: ' + e.message, 502, cors);
  }
  return new Response(out.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': out.cache },
  });
}

async function handlePetss(request, ctx, cors) {
  // CO-OPS/NWS station ids are seven digits (8721147 = Ponce de Leon Inlet
  // South). Validating rather than forwarding whatever arrives is what stops
  // this being a general-purpose POST relay pointed at the rest of the internet.
  const st = new URL(request.url).searchParams.get('station') || '8721147';
  if (!/^\d{7}$/.test(st)) return fail('bad station id', 400, cors);

  let out;
  try {
    out = await cached(ctx, cacheKeyFor(request, 'petss-' + st), PETSS_CACHE_SECONDS, async () => {
      const res = await fetch(PETSS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'storm-board (jan@aceshardware.com)',
        },
        body: 'st=' + encodeURIComponent(st),
      });
      if (!res.ok) throw new Error('upstream ' + res.status);
      const text = await res.text();          // served as text/html despite being JSON
      const data = JSON.parse(text);
      // The six parallel arrays the page expects. 9999 is P-ETSS's missing value
      // and is left in place — deciding what missing means is the page's job,
      // not the proxy's.
      for (const k of ['ts', 'pred', 'ss', 'twl', 'obs', 'anom']) {
        if (!Array.isArray(data[k])) throw new Error('missing ' + k);
      }
      if (!data.ts.length) throw new Error('empty series');
      return JSON.stringify({
        station: st, ts: data.ts, pred: data.pred, ss: data.ss,
        twl: data.twl, obs: data.obs, anom: data.anom,
      });
    });
  } catch (e) {
    return fail('P-ETSS unreachable: ' + e.message, 502, cors);
  }
  return new Response(out.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': out.cache },
  });
}

/* The cone package. Unlike the other two routes this returns BINARY — the
 * shapefile ZIP, passed through untouched for the page to inflate and parse.
 *
 * The upstream URL is BUILT here from a validated storm id and advisory number,
 * never taken from the caller. That is the difference between a narrow shim for
 * one NOAA product and an open relay that anyone can point anywhere. */
async function handleCone(request, ctx, cors) {
  const q = new URL(request.url).searchParams;
  const id = (q.get('id') || '').toLowerCase();
  const adv = (q.get('adv') || 'latest').toLowerCase();
  // Basin letters + storm number + year, e.g. al142024.
  if (!/^[a-z]{2}\d{6}$/.test(id)) return fail('bad storm id', 400, cors);
  // Either "latest" or a zero-padded advisory number; NHC uses 3 digits, and
  // intermediate advisories carry a letter (e.g. 014a).
  if (!/^(latest|\d{1,3}[a-z]?)$/.test(adv)) return fail('bad advisory', 400, cors);

  const upstream = NHC_GIS + id + '_5day_' + adv + '.zip';
  const cache = caches.default;
  const cacheKey = new Request(cacheKeyFor(request, 'cone-' + id + '-' + adv), { method: 'GET' });

  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      return new Response(hit.body, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/zip', 'X-Cache': 'HIT' },
      });
    }
  } catch (e) { /* fall through */ }

  let res;
  try {
    res = await fetch(upstream, {
      headers: { 'User-Agent': 'storm-board (jan@aceshardware.com)' },
      cf: { cacheTtl: CONE_CACHE_SECONDS, cacheEverything: true },
    });
  } catch (e) {
    return fail('NHC GIS unreachable', 502, cors);
  }
  if (!res.ok) return fail('NHC GIS ' + res.status, 502, cors);

  const buf = await res.arrayBuffer();
  // A zip starts "PK\x03\x04". NHC serves a styled 404 page with a 200 in some
  // conditions, and caching that as a cone would be a ten-minute outage of the
  // one graphic the card is built around.
  const head = new Uint8Array(buf.slice(0, 4));
  if (buf.byteLength < 1000 || head[0] !== 0x50 || head[1] !== 0x4B) {
    return fail('upstream did not return a zip', 502, cors);
  }

  try {
    ctx.waitUntil(cache.put(cacheKey, new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Cache-Control': `public, max-age=${CONE_CACHE_SECONDS}`,
      },
    })));
  } catch (e) { /* uncached is fine */ }

  return new Response(buf, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/zip', 'X-Cache': 'MISS' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const maxAge = path === '/petss' ? PETSS_CACHE_SECONDS
                 : path === '/cone'  ? CONE_CACHE_SECONDS
                 : NHC_CACHE_SECONDS;
    const cors = corsHeaders(request, maxAge);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
      });
    }
    if (request.method !== 'GET') return fail('GET only', 405, cors);

    if (path === '/nhc') return handleNhc(request, ctx, cors);
    if (path === '/petss') return handlePetss(request, ctx, cors);
    if (path === '/cone') return handleCone(request, ctx, cors);
    if (path === '/') {
      return json({
        service: 'storm-proxy',
        routes: ['/nhc', '/petss?station=8721147', '/cone?id=al142024&adv=latest'],
        note: 'CORS shim for Storm Board. Public NOAA data only; holds no secrets.',
      }, cors);
    }
    return fail('not found', 404, cors);
  },
};
