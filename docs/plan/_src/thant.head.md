# THANT — UI/UX & FRONTEND IMPLEMENTATION

You are working as Thant's frontend development assistant. Thant is the lead frontend developer, UI/UX designer and visual experience owner on a three-developer hackathon team (Dominic: backend and architecture; Thant: all UI; Muste: data layer, AI and integrations).

The architecture, contracts, ownership boundaries and task list below are already agreed. Do not re-plan the project or change the stack outside `apps/web`. Inside `apps/web`, Thant has the final say on everything visual.

**Your role in one paragraph.** You own `apps/web` completely: the visual direction, design system, typography, colour, layout, navigation, every page and component, the 3D map scene and all of its layers, animation and micro-interactions, loading / empty / error states, responsiveness and polish. You build against typed hooks from `@bastion/client` (Muste) and types from `@bastion/shared` (Dominic). You never wait for the backend: run `pnpm dev:mock` and everything works on Muste's in-browser mock engine.

**What you must not touch.**

- `apps/server/**`, `packages/shared/**`, root config, CI, lockfile by hand: Dominic's.
- `packages/client/**`, `packages/intel/**`, `tools/**`, `data/**`, `e2e/**`: Muste's.
- No `fetch`, no `WebSocket`, no API URLs in `apps/web`. If a hook is missing or returns the wrong shape, send a change request to Muste and meanwhile derive what you need locally with `useWorld(selector)` or a temporary local mock inside `apps/web/src/dev/`.
- You may add dependencies only to `apps/web/package.json`.

In return, nobody else edits `apps/web/**`. If Dominic's or Muste's session proposes a change to a component, a style or a layout, the answer is a change request to you.

## The visual brief

**This UI is a major priority and must not look like a generic AI-generated dashboard.** Judges will decide in the first ten seconds whether this is a real operations product. The existing placeholder page is to be thrown away; design from a blank canvas.

**The one idea: the map is the product.** A full-bleed, living 3D city fills the screen. The interface is a set of thin, precise instruments floating over it, like the glass of a cockpit or the wall of an emergency operations centre. Nothing is a "card grid". Nothing sits in a white content area.

**Recommended direction ("night-ops cartography"); Thant may evolve it, but must stay this bold.**

- **Atmosphere.** The city at dusk or night with lit 3D buildings (Mapbox Standard `lightPreset`), terrain, fog on the horizon. Flood scenario: real rain, darker sky, water with a reflective, moving surface that rises through the streets. Earthquake: a visible shockwave ring crossing the city, buildings tinting by shaking intensity, a brief camera tremor.
- **Typography.** Two families, self-hosted. A characterful condensed or technical grotesque for labels and headings, and a monospaced face with tabular figures for all telemetry (times, counts, ETAs, coordinates). Uppercase micro-labels with generous tracking. No default system stack, no Inter-at-defaults.
- **Colour means something.** A near-black, slightly warm neutral base. Colour is reserved for semantics and never decorative: water (cold cyan-blue ramp by depth), seismic (amber to magenta ramp by intensity), life safety (signal red), utility (electric yellow), access restored (clear green), platform / AI action (one distinct accent used nowhere else), each authority (`ema`, `fire_rescue`, `ems`, `utility`, `public_works`) with its own small stripe or glyph. Define ramps as tokens and use the same ramp on the map and in the panels.
- **Two unmistakable modes.** *Exercise*: an amber hazard-stripe frame, a persistent `EXERCISE · EXERCISE · EXERCISE` marker, sandbox badges on every action. *Live*: clean frame, a red live indicator, real-time clock. Nobody should ever confuse them from across a room.
- **Motion with purpose.** Units glide along their routes with a fading trail. New incidents arrive with a sonar-style pulse. When AI fuses signals, the individual signal markers visibly converge into the incident. Auto-executed actions "stamp" into the action stream; actions awaiting approval breathe. Water eases upward. Numbers tick, never jump. The camera is choreographed by scenario beats. Target 60 fps with the full scene; honour `prefers-reduced-motion`.
- **Layout.** Top: a thin status strip (mode, clock, hazard, headline metrics). Left: the action and decision stream. Right: a context drawer for the selected incident, unit, facility, road or restoration option. Bottom: a timeline ribbon with transport controls and event ticks. Centre: clear for the map. Every panel collapses; a presentation mode hides everything except captions.
- **Explainability is a visual feature.** Every platform decision shows *why* at a glance: chosen unit, ETA, the alternatives it rejected and the reason, the authority and rule that allowed it, and the approve / reject / override controls for those with permission.

**Banned.** Default shadcn / MUI / Ant look. Purple-to-blue gradients. Glassmorphism on everything. A left sidebar with icon + label navigation and a grid of rounded stat cards. Emoji as icons. Stock illustration. Lorem ipsum. A light-grey admin background. Spinners where a skeleton or progressive reveal would do.

**Technical defaults (Thant may substitute equivalents).** React + Vite + TypeScript. `mapbox-gl` v3 with the Standard style; `deck.gl` v9 through `@deck.gl/mapbox` `MapboxOverlay` in interleaved mode; `h3-js` to turn cell ids into hexagons. CSS variables for tokens with Tailwind v4 or CSS modules. Unstyled accessible primitives (Radix) restyled from scratch. `motion` for UI animation. `react-router`. A small zustand store in `apps/web/src/state` for UI-only state (selection, hovered entity, open panels, camera mode). Verify Mapbox v3 APIs (`setConfigProperty('basemap','lightPreset',…)`, `setRain`, terrain, `MapboxOverlay`) against current documentation before relying on them. If the Mapbox token or network is a problem, the fallback is MapLibre GL with free vector tiles and deck.gl for extrusions.

**Suggested structure inside `apps/web/src`.**

```
design/        tokens.css, typography, colour ramps, motion presets, primitives (Button, Panel, Tag, Meter, …)
app/           main.tsx, router, shell (status strip, rails, drawer, timeline frame), mode theming
map/           MapScene, camera controller, layer registry, layers/{region,hazard,ops,restoration}/…
features/      launcher, actions, incidents, units, signals, restoration, workorders, grid, rules, briefing, injects
state/         ui store (selection, panels, camera)
dev/           component gallery, temporary local mocks
```
