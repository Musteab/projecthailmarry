# Local exercise geography

The snapshots `sunway.json` and `srimuda.json` contain OpenStreetMap street and building geometry. © OpenStreetMap contributors, available under the [Open Database License 1.0](https://www.openstreetmap.org/copyright). Each file records the map snapshot timestamp and bounds in `provenance`. These are derived databases with OSM attribution; synthetic exercise additions do not purport to be OSM facts.

- Sunway City bounds: west 101.594, south 3.058, east 101.621, north 3.080.
- Taman Sri Muda bounds: west 101.524, south 3.019, east 101.551, north 3.046.
- OSM heights or levels take precedence. Other heights are estimates. Terrain is flat.
- Road segments retain tagged one-way directions; clipped stubs outside the largest strongly connected component are excluded from routing.
- Facility positions are snapped to the nearest retained road node. Exercise staging, shelters, secondary medical posts, grid sections, population and all hazards are synthetic.
- `exerciseRoadClosures` are authored scenario damage locations selected for measurable hospital-access impact. They are not reported closures.

## Regenerate

Fetch OSM using the same Overpass queries below into `work/sunway-osm.json` and `work/srimuda-osm.json`. The raw downloads are not needed at runtime and are not committed. Save an Overpass JSON response with `out body; >; out skel qt;` so all geometry nodes are included. Replace the bounding box and facility amenity query for the other region.

```overpass
[out:json][timeout:40][bbox:3.058,101.594,3.080,101.621];
(way["building"];way["highway"];way["natural"="water"];
 way["waterway"];way["leisure"="park"];
 nwr["amenity"~"hospital|fire_station|university"];);
out body; >; out skel qt;
```

Sri Muda uses `[bbox:3.019,101.524,3.046,101.551]` and `hospital|fire_station|school` for amenities. Then, from the repository root:

```sh
node apps/web/scripts/build-local-regions.mjs
pnpm --filter @bastion/client exec tsx ../../apps/web/scripts/select-recovery-roads.ts
pnpm test
```

No external requests occur when opening the completed demo. It makes no claim to detect floods from the saved geometry. The full operational caveats and rehearsal steps are in `docs/demo/local-command-ui.md`.
