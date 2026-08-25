# Restaurant Site Score: Methodology & Architecture

A design spec for a proof-of-concept that scores a candidate location for a restaurant/food concept, using free and low-cost data sources.

**Geographic scope:** Omaha, NE metro — specifically Douglas and Sarpy counties, Nebraska (Omaha proper plus Bellevue, Papillion, La Vista, and surrounding suburbs). This is a deliberate subset of the full 8-county OMB-defined Omaha–Council Bluffs metro area, chosen to keep data ingestion manageable; Pottawattamie County, IA (Council Bluffs) could be added later using the same pipeline if a cross-river example becomes useful.

**Stack:** Vite + React frontend, Node.js + Express backend, PostgreSQL via Neon (with the PostGIS extension) for storage.

---

## 1. Scope

Score one lat/lng point for one restaurant *subtype* at a time. Subtype matters more than "restaurant" as a category — a coffee shop, a QSR, a fast-casual lunch spot, and a fine-dining dinner destination each care about different things (walk-up morning traffic vs. evening drive-time vs. household income). Build the scoring engine to take a subtype parameter and swap in different trade-area sizes and weights accordingly. For the MVP, three profiles are enough:

- **Coffee shop / cafe** — short walk radius, morning/commuter emphasis, office & transit density matters a lot.
- **Fast casual / QSR** — mid drive-time radius, daytime population + arterial road visibility matter most.
- **Sit-down / dinner destination** — larger drive-time radius, household income and evening residential density matter more, visibility matters less.

---

## 2. Scoring Framework

### 2.1 Structure

Compute five sub-scores, each normalized to 0–100, then combine with a weighted sum:

```
Overall Score = Σ (weight_i × subscore_i)
```

**Making this tunable:** the scoring engine is a pure function — `computeScore(metrics, config) → { overall, subscores }` — with no hardcoded weights or thresholds anywhere in it. All weights and normalization parameters (the citywide benchmarks each sub-score compares against) live in a `scoring_profiles` table in Postgres, keyed by restaurant subtype and versioned, so they can be edited without a code change or redeploy. The `/score` endpoint also accepts an optional `weights` override in the request body, so a specific query can be run with hypothetical weights (e.g. "what if I cared more about competition and less about growth trend") without touching the stored profile — useful both for tuning and as a "what-if" feature in the UI later. See §3.4 for the table shape.

| Sub-score | What it measures | Primary data source |
|---|---|---|
| Demand Density | People who could realistically eat here | Census ACS |
| Competitive Saturation | How crowded the category already is | Overture Places |
| Complementary Draw | Nearby generators of organic foot traffic | Overture Places |
| Accessibility & Visibility | How easy the site is to reach and notice | OSM road/transit tags + isochrone shape |
| Growth Trend | Whether the area is gaining or losing population | Census population estimates |

Default weights (tune per subtype later):

| Sub-score | Weight |
|---|---|
| Demand Density | 25% |
| Competitive Saturation | 20% |
| Complementary Draw | 20% |
| Accessibility & Visibility | 20% |
| Growth Trend | 15% |

### 2.2 Trade area (the shared input)

Everything downstream depends on defining "the area this site can draw from." Generate an isochrone (not a simple radius circle — road-network-aware) via OpenRouteService for the subtype's travel profile:

- Coffee shop: 5- and 10-minute *walk* isochrones.
- QSR/fast casual: 5- and 10-minute *drive* isochrones.
- Dinner destination: 10- and 20-minute *drive* isochrones.

Use the inner ring as "primary trade area" (weighted 70%) and the outer ring minus inner as "secondary trade area" (weighted 30%) when aggregating demographics — this avoids a cliff-edge effect at the isochrone boundary.

### 2.3 Sub-score definitions

**Demand Density**
Sum ACS population within the trade area (population-weighted by the fraction of each Census block group polygon that overlaps the isochrone, via `ST_Intersection` area ratio). Optionally filter/weight by income bracket appropriate to the concept's average check size — e.g. weight residents in the $50k–150k household income band more heavily for a fast-casual concept than residents above $200k. Add daytime workforce population (Census LEHD LODES data, also free) for lunch-driven concepts. Normalize by comparing the trade area's population count against the distribution of population counts across a sample of points citywide (percentile rank → 0–100).

**Competitive Saturation**
Count same-category POIs (from Overture Places, filtered by category taxonomy) within the trade area, and compute `competitors_per_1000_residents`. Compare against the city-wide median for that ratio. Score is *inverted* — more competitors relative to demand lowers the score:

```
saturation_score = 100 − min(100, (local_ratio / citywide_median_ratio) × 50)
```

This rewards underserved pockets and penalizes areas already saturated with the same concept, without penalizing raw competitor count in a dense, high-demand area where the market can support multiple options.

**Complementary Draw**
This is the free stand-in for paid foot-traffic panels. Count nearby generators of organic foot traffic within a short walk (400m) of the exact point: offices, gyms, grocery/retail anchors, transit stops, schools, hotels, entertainment venues. Weight each category by how reliably it produces the right kind of visit (e.g. a transit stop or office tower counts more for a coffee shop than a single retail shop does). Normalize the weighted count against the citywide distribution, same percentile-rank approach as above. If you later add a paid foot-traffic API (BestTime or similar), blend it in as a second input to this sub-score rather than replacing it — real data plus the proxy is more robust than either alone, and it lets the demo degrade gracefully if the foot-traffic API is unavailable or budget-limited.

**Accessibility & Visibility**
Composite of: road classification at the point (arterial/collector roads score higher than residential streets, from OSM `highway` tags), whether it's a corner lot (OSM building footprint adjacency, or skip this if too fiddly for MVP), count of transit stops within 400m, and parking availability if you can get it (often not free — treat as a manual override field rather than an API call for the MVP). Combine into a 0–100 heuristic score; document the heuristic clearly since this is the least rigorous sub-score and the one most worth revisiting later.

**Growth Trend**
Compare the trade area's population between two ACS 5-year vintages several years apart (e.g. the 2023 5-year estimate against the 2018 5-year estimate). Normalize: 0% or negative growth → low score, top-quartile growth rate citywide → high score.

*Implementation note (found while scaffolding, not obvious up front):* the Census Bureau only publishes ACS 1-year estimates for geographies with 65,000+ people, which block groups never hit — so "5-year vs 1-year" isn't actually available at this geography. `scripts/ingest-census.js` instead pulls two 5-year vintages roughly five years apart as an approximation of a trend rate; it's a real limitation of the underlying data, not a rounding error, and is worth surfacing in the UI (e.g. "approximate multi-year trend") rather than presenting as a clean YoY growth rate.

### 2.4 Output bands

Translate the overall 0–100 score into a plain-language verdict, matching the pattern established tools use:

- 80–100: Strong site
- 60–79: Good site, worth deeper diligence
- 40–59: Marginal — depends on rent and concept fit
- 0–39: Weak site

Always show the sub-score breakdown alongside the overall number (a horizontal bar chart, one bar per sub-score) — the single number is the least useful part of the output; *why* it landed there is what makes the tool feel credible.

---

## 3. Architecture

### 3.1 Design principle for a proof-of-concept

Hitting live external APIs on every user query would be slow, costly, and make rate limits the bottleneck during a demo. Instead, I pre-ingest data for one metro area (Omaha, NE) into my own database, and serve queries entirely from that local store. Isochrones are the one thing computed live, since they depend on the exact clicked point — everything else (POIs, demographics) is pre-loaded and queried spatially.

### 3.2 Components

**Frontend** — Map UI built on Mapbox GL JS, where the user clicks a point on the map. Sends `{lat, lng, subtype}` to the backend and renders the returned score, sub-score breakdown, and isochrone overlay. Mapbox GL JS's free tier covers 50,000 map loads/month, plenty for this project; it requires a Mapbox access token (free account signup) and its source/layer styling model is what makes the isochrone fill (colored by value) and category-styled POI markers straightforward to build — see §3.6 for specifics.

**Backend API — Node.js + Express** — A single endpoint, `POST /score`, that:
1. Calls OpenRouteService for the isochrone polygon(s) matching the subtype's travel profile.
2. Runs spatial queries against the Neon/PostGIS database using that polygon: population-weighted demographic sum, POI counts by category, complementary-business counts.
3. Loads the active `scoring_profiles` row for the subtype (or merges in a request-supplied override) and passes it plus the query results into the scoring engine — a pure, dependency-free module so the scoring math is unit-testable without mocking any API or database.
4. Returns the overall score, sub-scores, and supporting geometry to the frontend.

Library choices: I use `pg` (node-postgres) directly with parameterized SQL for anything spatial — the PostGIS functions needed (`ST_Intersects`, `ST_DWithin`, `ST_Area`, `ST_GeomFromGeoJSON`) are just SQL, and an ORM's geometry support tends to get in the way rather than help. A query builder or GeoJSON library (Knex, `@turf/turf`) turned out not to be necessary — the OpenRouteService isochrone response gets passed straight to Postgres as a JSON string via `ST_GeomFromGeoJSON`, with no client-side reshaping needed.

**Database — PostgreSQL on Neon, with PostGIS** — Neon's free tier (0.5GB storage per project, 100 CU-hours/month, scale-to-zero when idle) comfortably covers a two-county dataset; Douglas + Sarpy together are a few hundred Census block groups and well under 100,000 Overture POIs, realistically tens of megabytes. PostGIS is a supported extension on Neon (confirmed directly against their docs), along with the TIGER geocoder extension, which is handy since the demographic layer is TIGER/ACS data. Tables, each with a spatial index (`GIST`) on their geometry column:
- Census block group polygons (Douglas + Sarpy only) joined to ACS demographic attributes (population, income, age).
- Overture Places POIs for the same two counties, with category tags.
- Overture Transportation road segments (Douglas + Sarpy only), tagged with a road class, for the accessibility heuristic.
- `scoring_profiles` — one row per restaurant subtype: `subtype`, `weights` (jsonb), `normalization_params` (jsonb), `version`, `created_at`. This is what makes the score calculation tunable without a deploy — edit a row (or insert a new version) and the next request picks it up.
- `isochrone_cache` — keyed by rounded `(lat, lng, travel_profile)`, storing the returned polygon and a timestamp, to avoid re-hitting OpenRouteService for repeated or nearby demo clicks.

**ETL / ingestion scripts** (run once for Douglas + Sarpy counties, not per request) — Download Overture data via the `overturemaps` CLI filtered to the two counties' combined bounding box, pull ACS + TIGER block group data via the Census API, and load all of it into Neon: `ingest-overture.sh` (places), `ingest-roads.sh` (road segments), and `ingest-census.js` (demographics + geometry). Since Neon speaks the standard Postgres wire protocol, `ogr2ogr -f "PostgreSQL" "PG:<neon-connection-string>"` can target it directly — no separate export/import step needed. Re-run periodically (Overture ships monthly; ACS updates annually) rather than live. I wrote these as plain Node/bash scripts to keep the whole project in one language, rather than reaching for Python/GeoPandas.

**Isochrone caching** — Cache isochrone responses keyed by `(rounded lat/lng, travel profile)` since nearby points and repeated demo clicks will often reuse the same or a very similar polygon. This keeps usage comfortably inside the isochrones free tier under repeated use. (Note, added 2026-08-19: the free tier turned out to be smaller than this doc originally assumed — 500 requests/day plus a 20-requests/minute rate limit as of a real account check that date, not a flat 2,500/day — and the provider migrated its API domain from `api.openrouteservice.org` to `api.heigit.org` around the same time, `api.openrouteservice.org` shutting off entirely 2026-08-24. See `backend/src/services/isochrone.js` and `scripts/compute-benchmarks.js` for the current numbers and endpoint.)

The same `isochrone_cache` table also backs `scripts/compute-benchmarks.js`, which samples a grid of points across Douglas + Sarpy per subtype to build the citywide percentile distributions that Demand Density, Complementary Draw, and Growth Trend normalize against (§2.3). Once a grid point's isochrone is cached, every future benchmark run reuses it for free — so this only costs real API calls the first time a subtype's travel profile is populated.

### 3.3 Request flow

```
User clicks map point (within Douglas/Sarpy counties)
   → Frontend (Vite/React) sends {lat, lng, subtype} to POST /score
   → Backend: check isochrone_cache; if miss, call OpenRouteService, cache result
   → Backend: spatial query (raw SQL via `pg`) against Neon/PostGIS for demographics, competitors, complementary POIs within isochrone
   → Backend: load scoring_profiles row for subtype (merge request-supplied weight overrides, if any)
   → Scoring engine: compute 5 sub-scores + weighted overall score
   → Backend returns {overall, subscores, band, isochrone, notes}
   → Frontend renders score card, sub-score bar chart, and isochrone map overlay
```

### 3.4 Confirmed stack

- **Frontend:** Vite + React, with Mapbox GL JS (`react-map-gl` is a solid React wrapper) for the map and a bar chart for the sub-score breakdown.
- **Backend:** Node.js + Express; `pg` for spatial SQL, with parameterized SQL for anything PostGIS-related.
- **Database:** PostgreSQL on Neon (free tier), with the PostGIS extension.
- **Data sources:** Overture Places (POIs), US Census ACS + TIGER (demographics/geometry), OpenRouteService (isochrones), OpenStreetMap (roads/transit, via Overture's Transportation theme).
- **Hosting:** Docker on Cloud Run, deployed via GitHub Actions — build the image, deploy it as a no-traffic candidate revision, smoke-test that revision, then promote it to 100% traffic.

### 3.5 MVP scope

Douglas and Sarpy counties, Nebraska only — fully ingest this two-county area and demo against it exclusively. This keeps the one-time ETL step small and sidesteps essentially all the free-tier concerns above, since ingestion happens once offline and every live user interaction is cheap (one isochrone call plus local database queries against a dataset that's tens of megabytes, not gigabytes).

### 3.6 Mapbox GL JS specifics

Chosen over MapLibre/Leaflet for its data-driven styling and Studio tooling, at the cost of a proprietary license and an access token dependency. Notes for setup:

- **Account & token:** free Mapbox account, generate a public access token, keep it in a frontend env variable (`VITE_MAPBOX_TOKEN`) — it's meant to be public but should still be URL-restricted in the Mapbox dashboard to this project's domain once deployed.
- **React integration:** use `react-map-gl` (Vis.gl's maintained wrapper) rather than wiring the imperative Mapbox GL JS API directly into React — it manages the map instance lifecycle for you and fits React's component model.
- **Isochrone rendering:** add the isochrone GeoJSON returned by the backend as a `Source`, then a `fill` `Layer` with a single `fill-color` and a data-driven `fill-opacity` expression keyed on the ORS range's `value` (seconds) — closer areas render more opaque, farther areas lighter, distinguishing the primary vs. secondary trade area from §2.2 without needing separate layers.
- **Free tier tracking:** 50,000 map loads/month; a map "load" is counted per `Map` instantiation, so watch for accidental re-mounts in React (e.g. a key change forcing a full remount) inflating the count during development — this is the most common way to burn through a Mapbox free tier by accident.
