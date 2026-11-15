# Local command demo — Sunway City & Taman Sri Muda

BASTION now opens as a working local exercise command table. Its three flows are **simulate → act → restore**. The UI consumes `@bastion/client`; it never opens its own HTTP or WebSocket connection.

## Run

```sh
pnpm install --frozen-lockfile
pnpm dev:mock
```

Open the Vite URL, choose a region and disaster, and press **Enter command**. No Mapbox key, AI key, external map connection or server is required. Both region datasets and the fonts are bundled. This is a local web demo, **not** an installable offline PWA: preload it or run the local Vite/preview server before presenting.

For the existing Fastify transport, run `pnpm dev` and visit `/?backend=server`. Sign in with a seeded server account. The server's catalogue and role permissions drive this mode; a region without these local building assets renders the supplied street graph. The UI still launches **exercise** operations. Local region assets are not silently uploaded to the server.

## 90-second presentation

1. Select **Sunway City → Flash flood**. Point out the actual street network, building footprints and stylised Sunway Pyramid landmark.
2. Press **Dispatch** in the timeline. This reconstructs the exercise at 00:40 and pauses. Inspect the pending second-crew decision; show evidence, authority, alternatives and **Approve action**. The crew follows open road edges.
3. Press **Protect**. The scripted SCADA alert and pre-authorized utility rule isolate the illustrative feeder. The grid console shows affected sections; facility details show backup power. Switch the exercise persona to **EOC operator** to demonstrate that utility decisions are disabled, then return to administrator.
4. Press **Restore**. Open **Recovery**, inspect the top option, and switch between before/after hospital-access cells. Unlike an arbitrary map animation, the comparison is computed on the road graph. The deliberately selected exercise closures reconnect synthetic population when repaired.
5. **Issue work order → Mark assigned → Mark in progress → Mark inspection → Pass inspection & reopen**. The road changes state and the audit records each step. Inspection can also fail.
6. Switch to **Taman Sri Muda** or launch the **Earthquake stress test**. The earthquake uses USAR, structural-collapse reports, facility power loss and hospital diversion. Its regional occurrence is hypothetical; it is not a local risk prediction.

Alternatively let the authored sequence run at 5×. The simulation lasts 6:20, around 76 wall-clock seconds. Scripted work orders progress automatically so an uninterrupted presentation still reaches reopening. Operator-created work on the same repair is reused by the script.

**Chapter jumps rebuild the exercise and reset interventions.** They are rehearsal shortcuts, not a production history scrubber. Rules retain their chosen policy. Camera moves can be interrupted by dragging.

## Controls

- Drag to orbit; right-drag to pan; scroll to zoom. The crosshair restores the regional view; 2D switches to overhead.
- `Space`: play/pause when keyboard focus is outside a form/control. `R`: regional view. `P`: presentation mode. `Esc`: exit presentation / clear selection.
- Decision stream: approve, reject with reason, or override with optional replacement crew. A utility override supplies the opposite switching action in the exercise. Executed dispatch overrides release the original crew.
- Context: incident evidence and triage, unit route/ETA/recall proposal, facilities, road closures and grid sections.
- **Grid**: feeder isolation/restoration proposals and per-authority autonomy policies.
- **Inject a disruption**: block/reopen an actual street segment or put an exercise hospital on backup power.
- **Brief**: scripted situation summary, exercise assistant and downloadable JSON world/audit timeline.
- Persistent exercise marker and per-action sandbox badges distinguish the demo from operational dispatch. Local persona switching is a UI permission demonstration, not authentication. Server mode uses the authenticated user's role.

## What is real, modeled and not connected

| Layer                                                | Status                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Street geometry / one-way tags                       | OpenStreetMap snapshot; largest mutually reachable component after clipping                            |
| Buildings                                            | Real OSM footprints; tagged heights/levels where present, otherwise estimates                          |
| Landmark                                             | Stylised Sunway Pyramid geometry, not a photogrammetric reconstruction                                 |
| Terrain                                              | Flat; no surveyed elevation or hydraulic simulation                                                    |
| Flood / quake fields                                 | Authored exercise curves over H3 cells, not predictions or observations                                |
| Population / crew counts / feeder topology / staging | Synthetic exercise data                                                                                |
| Medical facility operating state / shelters          | Exercise-only; not current hospital status or official shelter designations                            |
| Routing                                              | One-way-aware graph travel time; no turn restrictions, congestion or verified disaster road conditions |
| Recovery                                             | Graph-based hospital access; synthetic population/crew hours; no shelter access model yet              |
| Signals / fusion / triage / confidence               | Scripted fixtures; no live satellite, sensor, 999, SCADA or AI connection                              |
| Dispatch / power switching / public alerts           | Sandbox state changes; no real agency or utility integration                                           |
| Hazards shipped here                                 | Flood and earthquake; hurricane/tornado UI scenarios remain future work                                |

Live operation requires validated hazard models, calibrated sensors, current road restrictions, agency authentication, dispatch adapters and utility-approved protection systems. Satellite imagery alone is insufficient for instant flash-flood detection or safe remote power switching.

## Checks and screenshots

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
# With the web app running (default rehearsal URL is port 5188):
DEMO_URL=http://127.0.0.1:5173 node apps/web/scripts/rehearse.mjs
```

The rehearsal uses Chrome on macOS, or an installed Playwright Chromium elsewhere. Set `CHROME_PATH` for another Chrome executable and `DEMO_SCREENSHOTS` to change its output folder. It exercises approvals/rejection/override, persona restrictions, utility policy, access comparison, the work-order lifecycle, disruptions, briefing, region switching, both hazards, presentation and mobile layouts, and fails on browser errors.

`apps/web/src/data/local.test.ts` validates both region packs and all four disaster runs, including road references, dispatch, grid isolation, ranked recovery and reopening. Existing client/engine/server tests remain in the full repository check.

## Implementation handoff

- `apps/web/src/App.tsx`: command shell, launcher, transport, camera/UI state, permissions and dialogs.
- `apps/web/src/components/MapScene.tsx`: R3F scene, merged city geometry, vehicles, projected DOM labels, hazard/access layers, 2D WebGL fallback.
- `apps/web/src/components/Panels.tsx`: response, utility, recovery and briefing workflows.
- `apps/web/src/data/`: local snapshots and authored scenarios; see its README for regeneration.
- `packages/client/src/mock/routing.ts`: heap-based routing and reverse multi-source access analysis. This avoids thousands of repeated shortest-path searches on a local region.
- `MockTransport` accepts optional scripts alongside a region. Shared contracts and server code are unchanged.

This batch covers the main frontend shell, 3D and dynamic layers, scenario launcher/timeline, decisions, entity context, recovery/work orders, metrics/presentation, utility rules, injects, briefing, responsive states and demo polish. Remaining integration work includes production agency adapters, live AI/feeds, full server-region asset loading, four-hazard parity, terrain calibration and a dedicated component gallery. It does not wait on the separate region-pack work in the other checkout.
