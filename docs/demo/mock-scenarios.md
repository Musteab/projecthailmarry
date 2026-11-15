# MUS-002: offline demo handoff

Mount `BastionProvider` with mock mode enabled. Choose `mock-flood` or `mock-quake`
from `useScenarios()`, launch it, and start through `useOperation()`. Default speed
is 5x, so each complete run takes 76 wall seconds. All commands remain local.

| Sim time  | Flood                                                                                | Earthquake                                                                           |
| --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 0–20 s    | Warning, gauge, field/911/camera corroboration                                       | Seismic alert, strong shaking, bridge closure, hospital backup/diversion             |
| 25–40 s   | Swift-water dispatch, triaged medical call, ambulance, optional second rescue crew   | USAR via the open bridge, ambulance to a functioning hospital, optional fire support |
| 55–75 s   | Utility isolation, shelter activation, published closure, rejected duplicate request | Feeder fault/isolation, shelter activation, bridge closure, rejected unsuitable crew |
| 150–180 s | Rescue completion, water recession, debris closures                                  | Response completion and masonry clearance needs                                      |
| 205 s     | Ranked road-clearance options and per-cell impact                                    | Different repair options and hospital access comparison                              |
| 210–350 s | Work order: created → assigned → in progress → inspection → reopened                 | Same lifecycle for the earthquake's top-ranked repair                                |
| 365–380 s | Pending utility restoration approval, exercise ends                                  | Exercise ends                                                                        |

To demonstrate operator control, pause at 40 seconds. Reject the reserve request,
or override the executed primary dispatch with another capable unit. Inject a road
closure on the selected unit's route to see rerouting; blocking every route leaves
the unit waiting. Set `mock-utility` to `approve` before 60 seconds to demonstrate
manual utility approval instead of the default automatic exercise rule.

`useDemoDirector().goto(i)` seeks to a beat and pauses. Backward seeking rebuilds
the exercise and discards manual interventions. Reset returns the selected scenario
to its initial state; configured autonomy rules persist. It does not change scenario.

Integration ownership: Thant renders the scene and panels using existing hooks.
No UI files are changed by MUS-002. Dominic's real engine remains independent.

Limits: the mini road network is synthetic; hazard motion is scripted; hospital
access estimates use fixture graph travel times, not an operational traffic model.
The two committed NDJSON files are generated mock captures. Real backend recording
is supported by the CLI but must be verified once operation WebSockets are available.
