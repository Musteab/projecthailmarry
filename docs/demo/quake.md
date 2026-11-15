# Portland Hills: routes change the response

Launch `earthquake-portland-hills` in exercise mode at 5×: 900 simulation seconds, three stage minutes. Magnitude, shaking and damage are synthetic training inputs. The intensity offset keeps unplanned damage low; the bridge, power failures and debris are forced for a repeatable presentation.

| Stage time | Scene                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| 0:00       | Exercise early warning                                                  |
| 0:10       | Ross Island Bridge closes; shaking propagates                           |
| 0:20       | Two corroborating reports identify the first structure collapse         |
| 0:26       | A separate collapse competes for specialist crews                       |
| 0:41       | Cardiac call; hospital power loss changes the destination               |
| 1:37       | Southwest Arnold Street debris creates a different recovery opportunity |
| 2:30       | Compare response and recovery with the flood                            |

A synthetic reserve USAR crew at west-side station `way-367749332` makes the river crossing comparison possible. Its placement is reproduced by the region generator and is not a claim about real staffing.

Three cache-mode real-runtime rehearsals selected `unit-usar-way-367749332` for the first collapse and `relation-13050886` (Good Samaritan) for the cardiac transport. Flood rehearsals selected a swift-water crew and Providence Milwaukie instead. The quake debris is on `way-726588882-15`, whose removal separates a modelled pocket allocated 391 residents; the flood blocks Mailwell Drive instead. These population counts are synthetic allocations on the clipped graph.

Run `pnpm --filter @bastion/intel exec node --import tsx scripts/scenario-check.ts earthquake-portland-hills`. The harness seeds the server's default agency rules and checks dispatch, ambulance destination, forced damage, all camera beats and three identical results with zero provider calls. `--warm` records explicitly labelled deterministic fallback fixtures, not live Claude responses.

Recovery acceptance: three fresh-backend rehearsals rank Southwest Arnold Street first and complete its work order through reopening. A documented synthetic west-side public-works reserve makes the travel time fit the three-minute stage window.
