# Storm Board

Hurricane and nor'easter prep for one specific piece of water: the Halifax River,
Turnbull and Rose Bays, and Ponce de Leon Inlet, in Volusia County, Florida.

**Live:** https://janfishes.github.io/stormboard/

One HTML file, no build step, no framework, no runtime dependency on any CDN.
Fourth in the family after [WTF](https://github.com/janfishes/WTF),
[My Tides](https://github.com/janfishes/tideboard) and
[Inshore Mini Mapper](https://github.com/janfishes/inshore-minimapper), and it
follows their conventions deliberately.

---

## What it is for

Plenty of tools will tell you what a hurricane is doing to *Daytona*. The thing
none of them will tell you is what the surge does to the water you actually keep
a boat in.

Storm Board's headline card takes the forecast **surge** at Ponce Inlet and
carries it up the creeks to your own spots, using the lags and height models
[My Tides](https://github.com/janfishes/tideboard) has *measured* for them. You
enter the height of your dock, your ramp or your yard once, and it tells you
when that goes under — not when "Daytona floods".

Around that:

- **The clock** — a countdown to tropical-storm-force wind, minus however much
  lead time you want, from the NWS forecast grid.
- **The tropics** — active storms from the National Hurricane Center, with the
  5-day forecast cone drawn relative to Ponce Inlet.
- **Your zone** — Volusia County's own evacuation zone, storm surge zone,
  shelters and sandbag sites, looked up for your address.
- **Haul-out** — a trailer-boat checklist grouped by lead time, with the reason
  for every item.

---

## The five feeds, and what is wrong with each

Every one of these was measured on 2026-08-06, not assumed. The awkward facts
are the useful ones, so they are written down.

| Feed | Source | The catch |
|---|---|---|
| Storm list | NHC `CurrentStorms.json` | **No CORS header at all.** Goes through the worker. |
| Forecast cone | NHC GIS shapefile ZIPs | **CORS is a cache lottery** — see below. Goes through the worker. |
| Surge forecast | P-ETSS station **8721147** | Forecast only. There is no gauge here. |
| Astronomical tide | NOAA CO-OPS **8721138** | Prediction-only station; same one My Tides uses. |
| Wind, watches, warnings | api.weather.gov | CORS-open, no proxy needed. |
| Zones, shelters, sandbags | Volusia County GIS | CORS-open, but **defaults to Web Mercator** — see below. |

### There is no water level gauge at Ponce

Station 8721138 publishes predictions and nothing else; so does 8721147. The
nearest gauges that actually *measure* are Trident Pier, 54 nm south, and
Mayport, 100 nm north. So Storm Board can forecast the surge here but can never
check it against a reading, and it says so on the card rather than implying a
precision it does not have.

The surge itself comes from **P-ETSS at station 8721147, "Ponce de Leon Inlet
South"** — a *different* station from the tide board's 8721138, and the only
place a forecast surge height for this water exists. It is fetched as `ss`, the
**anomaly**, never `twl`. An anomaly is a difference and transfers between
nearby stations; an absolute water level does not. That distinction is what
makes mixing the two stations legitimate.

### Why the surge is not damped like the tide

The tide at DJM swings 0.59 of what the inlet does, and at Dunlawton 0.536. It
is tempting to shrink the surge by the same factor. That would be wrong.
Friction takes more out of a fast wave than a slow one, and a surge is a far
longer wave than the twice-daily tide, so it runs up these creeks close to
undamped — and a dead-end bay with the wind blowing straight up it can finish
*higher* than the open coast.

So the transfer factor defaults to **1.0**, which is a middle estimate and not a
safe one. It is editable, and the value in force is printed on the card, because
an assumption you cannot see is one you cannot argue with.

### Verify CORS in a browser, not with curl

`curl -H 'Origin: …'` against the NHC cone ZIPs returns
`access-control-allow-origin: *` every single time. A real browser fetch fails
with a bare `TypeError: Failed to fetch`. CloudFront caches a copy of the object
*without* the CORS header and sends no `Vary: Origin`, so which copy you get
depends on which edge answers.

It would have worked in testing and failed during a hurricane, or the reverse.
**curl does not enforce CORS and therefore cannot see it being absent.**

### ArcGIS returns Web Mercator unless you ask otherwise

The Volusia layers default to `wkid:102100` — metres, not degrees. The first
build fed those straight into a great-circle distance and put the nearest
shelter **928 nm** away, in a list that was still sorted and still looked
entirely plausible. `outSR=4326` is load bearing.

---

## Measured water: the gauges, and why there are almost none

Checked site by site on 2026-08-06. **There is no permanent water level gauge in
Port Orange or New Smyrna Beach.**

| Gauge | Status |
|---|---|
| Turnbull Creek nr NSB (02248060) — **40 m from the Turnbull Bay trestle** | recorded 2000–**2009**, switched off |
| Spruce Creek nr NSB (02248053) | ended **2006** |
| Reed Canal, Halifax Canal nr Harbor Oaks | both ended **Sept 2013** |
| "Halifax River at Port Orange" (290855080582700), at the Dunlawton bridge | **six readings, 5–11 Oct 2016** — a Hurricane Matthew deployment |
| **Spruce Creek nr Samsula (02248000)** | **live**, real-time, record back to 1951 |

The **Spruce Creek Park tide gauge is not a live feed.** It was a Stevens survey
gauge, and its 59 samples are already spent: they *are* the +213/+247 lag and the
0.645 height scaling that WTF and My Tides use for that spot.

### The card lights itself up

USGS pre-surveys sites and deploys gauges ahead of a landfalling hurricane. The
catalogue already includes Turnbull Creek ("power pole SE side of bridge, between
bridge and RR bridge"), Rose Bay Bridge, the SR421/Dunlawton bridge and the Port
Orange pier. Matthew 2016 put a live one at Port Orange, Ian 2022 at Daytona
Main St, Milton 2024 none here.

One bbox call returns every site in the box **including the discontinued and
not-yet-deployed ones, with empty value arrays**. So "is it reporting" is just
"does it have values", and a storm deployment appears on its own with no code
change and no list to maintain.

Where a deployed gauge lands within 0.3 nm of one of your spots — the Dunlawton
bridge gauge is 116 m from the Dunlawton card — the app computes **measured minus
predicted astronomical = the surge that actually happened**, and prints it beside
what P-ETSS forecast. That check has never been possible on this water. Matched
by **position, never by name**.

### The gauge map: no names on it, and you can zoom it

The pins carry **no labels**. They used to, and de-colliding fifteen name pills
on a 640-pixel picture is a bug this file wrote three separate times — while the
USGS ImageryTopo basemap underneath was already printing *Port Orange*, *Rose
Bay* and *Ponce De Leon Inlet* in the very places the pills were covering up.

What replaces a name is more than a name. **Pinch, scroll or use the +/− buttons
to zoom, drag to move, and tap any pin** for what it is, exactly where it sits
(including the mounting — "power pole on the SE side of the bridge"), what it
measures, whether it is online right now, and **when it gets switched on**. FIT
returns to the whole picture.

Zoom narrows the *bounding box* and re-fetches the basemap for it at the same
pixel size, so zooming in buys real resolution instead of magnifying blur. Asking
for the image at 2× the drawing size does the opposite: ImageryTopo drops to a
level of detail with no ocean tiles and unreadable place names.

Two of these sites are the **same place under two records** — the Turnbull Creek
trestle is both storm-deployment site FLVOL03144 and switched-off gauge 02248060,
and the Dunlawton bridge is both FLVOL17777 and the six-reading Matthew
deployment. Drawn straight they came out as a hollow ring with a cross through
it, a symbol meaning nothing. A switched-off gauge within ~100 m of a deployable
one is now folded into it: one pin, and the dead gauge's record is in the tap
panel as history.

The picture's **shape is measured off the window**, capped at a little over half
the screen height, so the panel you just opened is on screen with the pin you
tapped.

### Two datum rules

`62620` (estuary/ocean water surface elevation) and `63160` are **NAVD88**;
everything else here is MLLW, so tidal readings get **+2.25 ft** on the way in — the
sign is the opposite of what "NAVD88 is 2.25 ft above MLLW" sounds like, and
build 2 had it backwards. That
conversion is applied **only to tidal sites**. Spruce Creek near Samsula is 8 km
upstream, above the tidal reach — converting it would turn a creek stage into a
tide-looking number that means nothing. It is a **runoff** signal, and because it
sits *upstream* of Spruce Creek Park it sees fresh water before the park does.

### Rainfall, and stormwater structures

The card also carries NWS `quantitativePrecipitation`, because a stormwater pond,
berm or dam is driven by **rain**, with no surge term in it at all. **Nothing
public monitors those structures in real time** — they are below the National
Inventory of Dams thresholds (NID lists only two dams in all of Volusia County,
both 15+ nm inland) and absent from OpenStreetMap. The rain forecast and the
creek gauge are the closest available warning.

**Rain is only half of why one overtops.** These ponds drain east to the Halifax
by gravity through an outfall at their own low level. When surge lifts the
receiving water the outfall stops draining and can run backwards, so the pond
keeps filling from the sky with nowhere to go — compound flooding. That is why a
pond can overtop on a rainfall total it has handled before, and why the card
tells you to read peak water time against heaviest rain.

---

## Shared state

Storm Board is served from `janfishes.github.io`, the same origin as My Tides
and Mini Mapper, so it reads their `localStorage` directly. A lag calibrated on
the tide board improves the surge forecast here on the next open, with no export
step.

It **reads** `tide-lags`, `tide-positions`, `tide-added-spots`.
It **writes** only its own `storm-*` keys.

It must never write a `tide-*` key: two apps writing one key is how a
calibration gets silently overwritten by an app that did not measure it.

`BUILTIN_LOCATIONS` is a **copy** of My Tides' built-in cards, deliberately —
the card list changes rarely, the calibrations change often and come across
live. If My Tides changes its built-ins, copy them here too, or the same storm
tide will be reported differently by the two apps.

---

## The worker

`worker/storm-proxy.js` is a Cloudflare Worker that adds CORS headers to the two
NOAA feeds that lack them. It parses nothing, stores nothing, logs nothing and
**holds no secrets**, so there is nothing to rotate if the repo changes hands.

```
GET /nhc                       NHC CurrentStorms.json          cached  5 min
GET /petss?station=8721147     P-ETSS point series as JSON     cached 30 min
GET /cone?id=al142024&adv=014  5-day cone/track shapefile ZIP  cached 10 min
```

Upstream URLs are **built** from validated inputs, never taken from the caller —
that is the difference between a narrow shim for a handful of NOAA products and
an open relay anyone can point anywhere.

Deploy:

```sh
cd worker && npx wrangler login && npx wrangler deploy
```

then put the printed URL into `STORM_PROXY` in `index.html`. It is a plain
constant on purpose: the app is one file with no build, and a new owner should
be able to point it at their own worker by editing one line.

This is a **separate** worker from `ndbc-proxy`, deliberately. That one is load
bearing for My Tides *and* WTF, and adding routes to it to serve a third app
would put two live boat tools at risk of a bad deploy of a fourth.

---

## No libraries, including for the cone

The NHC cone arrives as a ZIP of shapefiles. Rather than pull a parser off a
CDN — into an app whose whole point is that it is one file that works on a bad
signal — `index.html` inflates the entries with the browser's own
`DecompressionStream('deflate-raw')` and reads the shapefile and dBASE formats
directly. About a hundred lines.

Verified against the real archive for Hurricane Milton (`al142024`), advisory
14: 2,406-point cone ring, 9 forecast points, **zero** mismatches between the
`.shp` geometry and the `.dbf` attributes, and Ponce Inlet correctly reported
inside the cone.

---

## Icons

Master artwork: `~/Desktop/Storm Board Files/StormBoard-icon.svg`.

The PNGs are rendered with **headless Chrome**, not `qlmanage` — qlmanage drops
the paths on this artwork and renders only the text. Then `sips -z` down to
512/192/180.

**Three places hold this artwork and all three must change together:**

1. `StormBoard-icon.svg` and the PNGs rendered from it
2. the inline `<svg class="ticon">` beside the `<h1>` in `index.html`
3. the `data:` URI favicon in `index.html`

macOS snapshots the icon when an app is added to the Dock, so a new icon can lag
a build; remove it from the Dock and re-add to force the current one. Check that
before suspecting the artwork.

---

## Liability

Storm Board is **informational**. It does not tell anyone whether to evacuate —
Volusia County Emergency Management and the National Weather Service are the
authorities on that, and an official order overrides everything on the page.

Wherever the app says it is not to be used for navigation, **it says so in
capitals**. That is a standing rule across this family of apps; add new ones in
caps.

The exposure here is deliberately lower than My Tides' inlet run ratings, which
are navigation-safety advice. Nothing on this page tells anyone to get on the
water.
