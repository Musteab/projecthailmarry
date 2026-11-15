# Johnson Creek: rescue to recovery

Load `flash-flood-johnson-creek` in Portland, exercise mode, default 5×. The 1,500 simulated seconds take five stage minutes. All warnings, sensor readings, reported casualties, capacities, grid links and population are fictional training data. Creek geometry is simplified OpenStreetMap geometry, retrieved with the region pack.

| Stage time | Beat             | Expected observation                                    |
| ---------- | ---------------- | ------------------------------------------------------- |
| 0:00       | Warning          | Official exercise signal, forecast footprint            |
| 0:20       | Rising water     | Synthetic gauge, active inundation, blocked roads       |
| 0:52       | Rescue           | Three simultaneous reports become one water rescue      |
| 1:22       | Cardiac call     | Separate medical incident, ALS triage                   |
| 1:50       | Utility exposure | Feeder telemetry; scripted hospital backup loss at 2:00 |
| 2:22       | Shelter          | Displaced residents generate a shelter need             |
| 3:42       | Recovery         | Mailwell Drive debris, access restoration opportunity   |
| 4:20       | Handoff          | Coordinator compares options and issues work order      |

The debris edge `way-5293984-8` is an articulation in this clipped road graph: blocking it separates a pocket allocated 1,021 synthetic residents. This is a model result, not a claim about real residents or all real access routes. Random recession debris is disabled so the recovery scene remains repeatable. Hospital backup loss is an explicit scenario inject; it does not prove automatic electrical isolation.

Validation: three real runtime runs with the current default server systems in cache mode produced 356 wet cells at peak, 562 affected road edges at peak, all eight beats, one three-source water rescue at 0.98 confidence, a separate ALS medical incident, shelter need, and the intended debris edge. The cache-mode provider made zero calls.

Pending integration: dispatch, utility-rule isolation, shelter activation, ranked restoration and work-order execution require Dominic's action/grid/recovery systems. The current scenario check reports those capabilities and does not pretend they passed. Re-run the full acceptance after those systems land; tune only this scenario and owned fixtures.

Run from the repo: `pnpm --filter @bastion/intel exec node --import tsx scripts/scenario-check.ts flash-flood-johnson-creek`. Add `--warm` to regenerate deterministic rehearsal responses. These fixtures are labelled rule-based in the provenance manifest; they are not claimed to be live Claude output. No secret or external API is required.
