### Essential versus optional

| Essential for the stage demo | Makes it complete | Optional |
|---|---|---|
| Real 3D city map with hazard, unit, incident, closure and grid layers | Rules console with live autonomy changes | Hurricane hazard |
| Flash-flood and earthquake scenarios, deterministic | What-if inject tools on the map | Rewind / seek |
| AI fusion of signals into incidents; 911 triage | AI briefing and copilot | After-action report |
| Explainable dispatch and ambulance assignment that reacts to bridge and hospital status | Tornado hazard | Field reports with photo analysis |
| Rules, approval, override, audit; exercise sandbox | Real NWS / USGS feeds in live mode | Public closure map page |
| Utility-owned grid isolation | Public closure and CAP feeds | Landing page |
| Restoration ranking by access regained; work orders through to reopening | Deployment to a public URL, E2E smoke tests, demo director | |
| Sign-in with roles | Responsive and accessibility pass | |

### Assumptions (labelled, because the brief left them open)

| # | Assumption | If wrong |
|---|---|---|
| A1 | No existing repository: the working folder is empty and not a git repo. Everything is built from scratch. | n/a (verified) |
| A2 | Hackathon length about 48 hours. Milestones are given as hours from start; scale proportionally. | Cut P1 from the bottom, keep the milestone order. |
| A3 | No mandated stack. TypeScript monorepo chosen for shared types and speed. | If a platform is mandated (the folder name suggests a Kiro event), the plan and briefs transfer as-is; they can be dropped into steering / spec files. |
| A4 | Demo region is Portland, Oregon, because one map can host both a creek flash flood and a bridge-breaking earthquake. Region is a data pack, so it is swappable. | Change the bounding box in MUS-003; nothing else moves. |
| A5 | A free Mapbox token and an Anthropic API key are obtainable. | MapLibre fallback; `INTEL_MODE=off` rule-based fallback. |
| A6 | "Real emergency" side is demonstrated with simulated connectors (dispatch, SCADA, alerting write to an outbox) plus real read-only public feeds. No real agency systems are contacted. | n/a |
| A7 | Hazard and grid models are plausible, not validated engineering models; grid topology is synthetic. Stated openly if judges ask. | n/a |
| A8 | Each developer drives their own Claude Code session in their own clone. | Use git worktrees on a shared machine. |
