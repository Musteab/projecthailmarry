# Region pack builder

Run `pnpm --filter @bastion/region-pack region:build --id portland --bbox=-122.70,45.44,-122.56,45.54`.
Use `--offline` to reproduce from the cached inputs in `.data/region-cache`.
A clean machine can use the committed six JSON files immediately; regeneration
requires downloads or an exact copy of the input cache. `sources.json` pins input
hashes and the OSM snapshot timestamp. Refreshed upstream data can change a pack.

Only public Overpass and AWS Terrain Tiles endpoints are used. Downloads stay
outside version control. The package command is provided now; a root `region:build`
alias belongs to Dominic's root tooling.

The graph retains edge direction and polyline geometry, contracts interior nodes,
and keeps the largest weakly connected component. Population is a synthetic
planning total distributed by building footprint, not measured census data.
