# Portland exercise region

Real OpenStreetMap road geometry, bridge names and facility locations within
`[-122.70, 45.44, -122.56, 45.54]`. The graph includes Sellwood, Hawthorne, Morrison
and Ross Island bridges, multiple hospitals, and Johnson Creek neighbourhoods.
AWS Terrarium tiles provide sampled terrain height at H3 resolution 10 cell centres.

This is exercise data. A synthetic planning population of 250,000 is allocated
by OSM building footprint area; it is not a census estimate. School/community
buildings are potential exercise shelter sites, not designated or available
shelters. Shelter capacity (250) and hospital capacity (200) are assumptions.
EOC and public-works staging are explicitly synthetic and co-located with a station.
Utility feeders, connectivity, customers and unit availability are synthetic.
Bridge seismic classes are demo assumptions: Sellwood/Tilikum retrofitted;
Hawthorne/Morrison/Burnside vulnerable; others standard, not engineering assessments.

Facility candidates within 60 metres are deduplicated by type; the first ten
shelters and four substations by stable OSM id are retained. All hospitals and
fire/ambulance stations are retained. `overrides.json` supports explicit additions,
removals, names, capacities, kinds and positions. No overrides are applied initially.

The six pack files are `region`, `roads`, `facilities`, `cells`, `grid`, and `units`.
`cell-nodes.json` records each cell's nearest retained road node. The road graph is
one weakly connected component, while one-way restrictions remain on each edge.
Road access restrictions tagged private/no are omitted.

Run `pnpm --filter @bastion/region-pack region:build --offline` using the original
`.data/region-cache`. `sources.json` records hashes for reproducibility. Raw data
is not committed; a fresh upstream download may differ. The committed pack is
immediately usable without downloads. See `docs/demo/ATTRIBUTION.md` for sources.

A synthetic western reserve USAR crew is seeded at `way-367749332`, the northernmost west-side fire station, to make cross-river route comparisons possible. The generator applies the same deterministic selection; these are exercise resources, not actual station staffing. Total units after recovery rehearsal: 46.

A synthetic public-works reserve stages at west-side fire station `way-305816961` (the southernmost west-side fire station). Without it, the sole east-side crew cannot finish the quake clearance within the three-minute stage window. This staging assumption is reproduced by the generator and is not real agency staffing.
