# World Streaming Setup

This project does **not** currently ship an exact 1:1 Earth replica. It still uses a handcrafted simulator world.

What is implemented now:
- a backend readiness endpoint at `/api/world-streaming/status`
- frontend UI that shows whether external providers are configured
- a non-breaking setup path for future globe-streaming work

What is **not** implemented yet:
- streamed globe terrain
- live satellite imagery in the current renderer
- world airport search tied to a real geospatial provider
- exact legal 1:1 replicas of 50 aircraft

## What you need to provide

### 1. Terrain / imagery accounts

Create these accounts and tokens:

1. Cesium ion
   - purpose: global terrain + OSM buildings
   - environment variable: `CESIUM_ION_TOKEN`

2. Mapbox
   - purpose: satellite / aerial imagery
   - environment variable: `MAPBOX_ACCESS_TOKEN`

3. ArcGIS (optional)
   - purpose: supplemental imagery / elevation / labels
   - environment variable: `ARCGIS_API_KEY`

Add them to local `.env` and your deployment provider.

## Recommended provider stack

- Cesium World Terrain for globe terrain
- Cesium OSM Buildings for building geometry
- Mapbox Satellite for imagery
- ArcGIS only if you want supplemental layers and legal attribution options

## Legal boundaries

Do not add assets unless you have the right to use them.

That includes:
- aircraft models
- liveries
- airport scenery packs
- photogrammetry datasets
- commercial map tiles outside allowed license terms

If you want 50 exact real-world aircraft, the safe options are:

1. buy a legally licensed aircraft model pack and give me the files inside this repo
2. give me a list of asset URLs with proof of license terms that allow use in this project
3. use only original / simplified non-infringing stand-in aircraft until licensed assets are available

## Recommended migration path

### Phase 1: Provider readiness
- add Cesium / Mapbox credentials
- keep current simulator playable
- expose world-streaming readiness in UI

### Phase 2: Separate world mode
- build a dedicated globe mode using a streaming provider
- keep current handcrafted mode as a fallback
- add airport search + spawn selection

### Phase 3: Aircraft expansion
- import legally licensed aircraft assets
- normalize pivots, scale, stats, and cockpit / landing gear behavior
- expose them in the current hangar and the future world mode

## What I need from you next

If you want me to continue toward a real streamed world, do these:

1. Create a Cesium ion account and get a token.
2. Create a Mapbox account and get a token.
3. Optionally create an ArcGIS API key.
4. Decide whether you want:
   - a browser globe mode with CesiumJS, or
   - a bigger engine migration later.
5. For the 50 aircraft request, provide either:
   - licensed model files, or
   - a legally usable asset source list.

Once those are available, the next implementation step is a separate `Real Earth Beta` launch path, not a silent replacement of the current simulator.
