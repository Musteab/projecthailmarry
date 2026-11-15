import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Expand,
  Layers3,
  MapPin,
  Minus,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  BastionProvider,
  createBastionClient,
  MockTransport,
  useActions,
  useBeat,
  useDemoDirector,
  useMetrics,
  useOperation,
  useRegion,
  useScenarios,
  useSession,
} from '@bastion/client';
import { can } from '@bastion/shared';
import type { AccessImpact, LngLat, Role } from '@bastion/shared';
import { cellToBoundary } from 'h3-js';
import { regions, type LocalRegion, type RegionKey } from './data/regions';
import { localScripts } from './data/scenarios';
import { MapScene, type CameraRequest, type Layers, type Selection } from './components/MapScene';
import {
  ActionFeed,
  BriefingPanel,
  human,
  RecoveryPanel,
  ResponsePanel,
  Tag,
  time,
  UtilitiesPanel,
} from './components/Panels';
import type { Panel, PanelProps } from './components/Panels';
import './styles.css';

const roleLabels: Record<Role, string> = {
  admin: 'Exercise administrator',
  operator: 'EOC operator',
  coordinator: 'Recovery coordinator',
  utility_operator: 'Utility operator',
  observer: 'Observer',
};
export function App() {
  const [regionKey, setRegionKey] = useState<RegionKey>(() =>
    new URLSearchParams(location.search).get('region') === 'srimuda' ? 'srimuda' : 'sunway',
  );
  const server = new URLSearchParams(location.search).get('backend') === 'server';
  const data = regions[regionKey];
  const client = useMemo(
    () =>
      server
        ? createBastionClient({ mock: false })
        : createBastionClient({
            mock: true,
            transport: new MockTransport({ region: data.region, scripts: localScripts(data) }),
          }),
    [data, server],
  );
  return (
    <MotionConfig reducedMotion="user">
      <BastionProvider client={client} key={`${regionKey}-${server}`}>
        <Operations data={data} regionKey={regionKey} changeRegion={setRegionKey} server={server} />
      </BastionProvider>
    </MotionConfig>
  );
}
function Operations({
  data: local,
  regionKey,
  changeRegion,
  server,
}: {
  data: LocalRegion;
  regionKey: RegionKey;
  changeRegion: (r: RegionKey) => void;
  server: boolean;
}) {
  const { region, error } = useRegion(),
    { operation, clock, connection, launch, control, setSpeed, inject } = useOperation(),
    { scenarios } = useScenarios(),
    { user, status, login } = useSession();
  const data = useMemo<LocalRegion>(
    () =>
      !region || region.config.id === local.region.config.id
        ? local
        : {
            region,
            surfaces: [],
            landmarks: [],
            aliases: {},
            cellPolygons: Object.fromEntries(
              region.cells.map((c) => [c.id, cellToBoundary(c.id, true) as LngLat[]]),
            ),
            provenance: {
              source: 'Server region pack',
              license: 'See region pack',
              retrieved: '',
              notes:
                'Server-supplied exercise region. This map does not include building geometry.',
            },
          },
    [region, local],
  );
  const [panel, setPanel] = useState<Panel>('response'),
    [selection, setSelection] = useState<Selection>(null),
    [focus, setFocus] = useState<CameraRequest>(null),
    [overview, setOverview] = useState(0),
    [flat, setFlat] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true),
    [present, setPresent] = useState(false),
    [layersOpen, setLayersOpen] = useState(false),
    [layers, setLayers] = useState<Layers>({
      buildings: true,
      hazard: true,
      units: true,
      grid: false,
      labels: true,
    });
  const [launcher, setLauncher] = useState(true),
    [scenarioId, setScenarioId] = useState(''),
    [role, setRole] = useState<Role>('admin'),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(null),
    [injectOpen, setInjectOpen] = useState(false),
    [sourceOpen, setSourceOpen] = useState(false);
  const metrics = useMetrics(),
    actions = useActions(),
    beat = useBeat(),
    director = useDemoDirector();
  const run = useCallback(async (task: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await task();
      if (success) setToast({ message: success, error: false });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  }, []);
  const actualRole = server ? (user?.role ?? 'observer') : role;
  const canOperate = can({ role: actualRole }, 'operate');
  const focusAt = useCallback((position: LngLat) => setFocus({ position, ticket: Date.now() }), []);
  const select = useCallback((s: Selection) => {
    setSelection(s);
    if (s) {
      setPanel('response');
      setRightOpen(true);
    }
  }, []);
  useEffect(() => {
    if (launcher && operation?.status === 'running') void run(() => control('pause'));
  }, [launcher, operation?.status, control, run]);
  useEffect(() => {
    if (scenarios.length && !scenarios.some((s) => s.id === scenarioId))
      setScenarioId(scenarios[0].id);
  }, [scenarios, scenarioId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest('input,textarea,select,button,a,[role="dialog"]') ||
        launcher ||
        injectOpen
      )
        return;
      if (e.code === 'Space' && operation && canOperate) {
        e.preventDefault();
        void run(() => control(operation.status === 'running' ? 'pause' : 'start'));
      }
      if (e.key.toLowerCase() === 'p') setPresent((p) => !p);
      if (e.key.toLowerCase() === 'r') setOverview((v) => v + 1);
      if (e.key === 'Escape') {
        setPresent(false);
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [launcher, injectOpen, operation, canOperate, control, run]);
  const lastBeat = useRef('');
  useEffect(() => {
    if (present && beat?.camera && beat.id !== lastBeat.current) {
      lastBeat.current = beat.id;
      focusAt(beat.camera.center);
    }
  }, [beat, present, focusAt]);
  const [accessImpact, setAccessImpact] = useState<AccessImpact | null>(null),
    [accessMode, setAccessMode] = useState<'before' | 'after'>('after');
  const props: PanelProps = {
    data,
    selection,
    select,
    focus: focusAt,
    run,
    role: actualRole,
    busy,
    compareImpact: setAccessImpact,
  };
  const pending = actions.filter((a) => a.status === 'awaiting_approval').length;
  const scenario = scenarios.find((s) => s.id === operation?.scenarioId),
    running = operation?.status === 'running';
  const launchSelected = () =>
    void run(async () => {
      setLauncher(false);
      await launch({ scenarioId, mode: 'exercise' });
      await control('start');
      setSelection(null);
      setPanel('response');
      setOverview((v) => v + 1);
    }, 'Exercise started · all actions remain in the sandbox');
  return (
    <main
      className={`app ${present ? 'presentation' : ''} ${!leftOpen ? 'left-collapsed' : ''} ${!rightOpen ? 'right-collapsed' : ''}`}
    >
      <MapScene
        data={data}
        layers={layers}
        selection={selection}
        select={select}
        focus={focus}
        overview={overview}
        flat={flat}
        accessImpact={accessImpact}
        accessMode={accessMode}
      />
      <div className="screen-shade" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bastion home">
          <Shield size={25} strokeWidth={1.7} />
          <span>
            BASTION<span className="brand-sub">REGIONAL COMMAND</span>
          </span>
        </a>
        <div className="exercise-mark">
          <span />
          EXERCISE<span className="exercise-sub">NO LIVE DISPATCH</span>
        </div>
        <div className="top-divider" />
        <div className="region-select">
          <MapPin size={15} />
          <select
            aria-label="Demo region"
            value={regionKey}
            disabled={server || busy}
            onChange={(e) => changeRegion(e.target.value as RegionKey)}
          >
            <option value="sunway">Sunway City, Selangor</option>
            <option value="srimuda">Taman Sri Muda, Selangor</option>
          </select>
        </div>
        <div className="top-spacer" />
        <span className="connection">
          <span
            className={`pulse-dot ${connection === 'mock' || connection === 'live' ? 'green' : ''}`}
          />
          {server ? `SERVER · ${connection.toUpperCase()}` : 'LOCAL ENGINE'}
        </span>
        <button className="new-exercise" onClick={() => setLauncher(true)}>
          <Plus size={14} />
          New exercise
        </button>
      </header>
      <section className="metric-bar" aria-label="Exercise situation metrics">
        <div className="mode-caption">
          <Radio size={15} />
          <span>
            {scenario?.hazard === 'earthquake' ? 'SEISMIC RESPONSE' : 'FLOOD RESPONSE'}
            <small>
              {running
                ? 'SCENARIO IN PROGRESS'
                : operation?.status === 'ended'
                  ? 'EXERCISE COMPLETE'
                  : 'READY WHEN YOU ARE'}
            </small>
          </span>
        </div>
        <Metric label="At risk · synthetic" value={metrics.peopleAtRisk} tone="red" />
        <Metric label="Active incidents" value={metrics.activeIncidents} />
        <Metric label="Units deployed" value={metrics.unitsDeployed} />
        <Metric label="People rescued" value={metrics.peopleRescued} tone="green" />
        <Metric label="Roads closed" value={metrics.roadsClosed} />
        <Metric label="Customers off grid" value={metrics.customersOut} tone="amber" />
      </section>
      <div className="map-heading">
        <div className="eyebrow">
          <span className="cross-mark">+</span> FIELD OF OPERATIONS /{' '}
          {regionKey === 'sunway' ? '01' : '02'}
        </div>
        <h1>{data.region.config.name}</h1>
        <p>
          {data.region.config.defaultCamera.center[1].toFixed(4)}° N &nbsp;{' '}
          {data.region.config.defaultCamera.center[0].toFixed(4)}° E{' '}
          <span>REAL STREET GEOMETRY</span>
        </p>
      </div>
      <aside
        className={`left-rail instrument ${leftOpen ? '' : 'closed'}`}
        aria-label="Decision stream"
      >
        <ActionFeed select={select} selection={selection} />
        <button
          className="rail-toggle left-toggle"
          aria-label={leftOpen ? 'Collapse decision stream' : 'Expand decision stream'}
          onClick={() => setLeftOpen((v) => !v)}
        >
          {leftOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </aside>
      <aside
        className={`right-rail instrument ${rightOpen ? '' : 'closed'}`}
        aria-label="Operations context"
      >
        <nav className="panel-tabs" aria-label="Operational tools">
          {(['response', 'recovery', 'utilities', 'briefing'] as Panel[]).map((p) => (
            <button
              key={p}
              aria-pressed={panel === p}
              onClick={() => {
                setPanel(p);
                if (p === 'utilities') setLayers((l) => ({ ...l, grid: true }));
              }}
            >
              {p === 'utilities' ? 'Grid' : p === 'briefing' ? 'Brief' : p}
            </button>
          ))}
        </nav>
        <div className="context-scroll">
          {panel === 'response' ? (
            <ResponsePanel {...props} />
          ) : panel === 'recovery' ? (
            <RecoveryPanel {...props} />
          ) : panel === 'utilities' ? (
            <UtilitiesPanel {...props} />
          ) : (
            <BriefingPanel {...props} />
          )}
        </div>
        <div className="persona">
          <Shield size={13} />
          <select
            aria-label="Exercise persona"
            value={actualRole}
            disabled={server}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {Object.entries(roleLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button
          className="rail-toggle right-toggle"
          aria-label={rightOpen ? 'Collapse context panel' : 'Expand context panel'}
          onClick={() => setRightOpen((v) => !v)}
        >
          {rightOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </aside>
      <div className="map-tools">
        <button
          title="Reset camera (R)"
          aria-label="Reset camera"
          onClick={() => setOverview((v) => v + 1)}
        >
          <Crosshair size={17} />
        </button>
        <button
          className={flat ? 'active' : ''}
          title="Toggle overhead view"
          aria-label="Toggle overhead view"
          onClick={() => setFlat((v) => !v)}
        >
          {flat ? '3D' : '2D'}
        </button>
        <button
          className={layersOpen ? 'active' : ''}
          aria-label="Map layers"
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen((v) => !v)}
        >
          <Layers3 size={17} />
        </button>
        <button
          title="Presentation mode (P)"
          aria-label="Presentation mode"
          onClick={() => setPresent((v) => !v)}
        >
          <Expand size={17} />
        </button>
      </div>
      {layersOpen && (
        <div className="layer-menu instrument">
          <div className="eyebrow">MAP LAYERS</div>
          {Object.entries(layers).map(([key, value]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={value}
                onChange={() => setLayers((l) => ({ ...l, [key]: !value }))}
              />
              <span>
                {key === 'hazard'
                  ? 'Exercise hazard'
                  : key === 'grid'
                    ? 'Illustrative grid'
                    : key === 'buildings'
                      ? 'Building extrusions'
                      : human(key)}
              </span>
            </label>
          ))}
        </div>
      )}
      {accessImpact && (
        <div className="access-compare instrument">
          <span>HOSPITAL ACCESS</span>
          <button
            className={accessMode === 'before' ? 'active' : ''}
            onClick={() => setAccessMode('before')}
          >
            Before
          </button>
          <button
            className={accessMode === 'after' ? 'active' : ''}
            onClick={() => setAccessMode('after')}
          >
            After clearance
          </button>
          <button aria-label="Close access comparison" onClick={() => setAccessImpact(null)}>
            <X size={13} />
          </button>
          <small>Green ≤15 min · amber &gt;15 min · red unreachable</small>
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="legend-hazard" />
          {scenario?.hazard === 'earthquake' ? 'Shaking intensity' : 'Modeled inundation'}
        </span>
        <span>
          <i className="legend-route" />
          Response route
        </span>
        <span>
          <i className="legend-closed" />
          Closed road
        </span>
      </div>
      <div className="map-credit">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
        <button onClick={() => setSourceOpen(true)}>
          Data & realism <ArrowRight size={11} />
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          className="beat-caption"
          key={beat?.id ?? 'ready'}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <div className="eyebrow">
            <span className="pulse-dot green" />
            {beat
              ? `CHAPTER ${String(director.current + 1).padStart(2, '0')}`
              : 'OPERATIONAL READINESS'}
          </div>
          <h2>{beat?.title ?? 'A region prepared to respond.'}</h2>
          <p>{beat?.caption ?? 'Start an exercise to see the response unfold.'}</p>
        </motion.div>
      </AnimatePresence>
      {pending > 0 && !rightOpen && (
        <button
          className="pending-floating"
          onClick={() => {
            select({
              type: 'action',
              id: actions.find((a) => a.status === 'awaiting_approval')!.id,
            });
          }}
        >
          {pending} {pending === 1 ? 'decision needs' : 'decisions need'} review{' '}
          <ArrowRight size={14} />
        </button>
      )}
      <footer className="timeline instrument">
        <div className="transport">
          <button
            className="play-button"
            disabled={!operation || busy || !canOperate || operation.status === 'ended'}
            aria-label={running ? 'Pause exercise' : 'Play exercise'}
            onClick={() => void run(() => control(running ? 'pause' : 'start'))}
          >
            {running ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <div className="clock">
            <b>{time(clock?.simTime ?? 0)}</b>
            <span>/ {time(clock?.durationSimSec ?? 380)} SIM TIME</span>
          </div>
          <select
            aria-label="Simulation speed"
            disabled={!canOperate || busy || !operation}
            value={clock?.speed || 5}
            onChange={(e) => void run(() => setSpeed(Number(e.target.value)))}
          >
            {[1, 5, 20, 60].map((s) => (
              <option value={s} key={s}>
                {s}×
              </option>
            ))}
          </select>
          <button
            title="Reset exercise"
            aria-label="Reset exercise"
            disabled={!canOperate || busy || !operation}
            onClick={() =>
              void run(async () => {
                await control('reset');
                setSelection(null);
              }, 'Exercise reset')
            }
          >
            <RotateCcw size={16} />
          </button>
        </div>
        <div className="timeline-story">
          <div className="timeline-progress">
            <i
              style={{
                width: `${Math.min(100, ((clock?.simTime ?? 0) / (clock?.durationSimSec ?? 380)) * 100)}%`,
              }}
            />
          </div>
          <div className="chapters">
            {director.steps.map((step, i) => (
              <button
                key={step.id}
                disabled={!canOperate || busy}
                className={(clock?.simTime ?? 0) >= step.simTime ? 'passed' : ''}
                onClick={() => {
                  director.goto(i);
                  if (step.camera) focusAt(step.camera.center);
                }}
                title={`${step.title} · ${time(step.simTime)} · rebuilds exercise at this chapter`}
              >
                <i />
                <span>
                  {i === 0
                    ? 'Detect'
                    : i === 1
                      ? 'Confirm'
                      : i === 2
                        ? 'Dispatch'
                        : i === 3
                          ? 'Protect'
                          : i === 4
                            ? 'Assess'
                            : i === 5
                              ? 'Restore'
                              : 'Reopen'}
                </span>
                <small>{time(step.simTime)}</small>
              </button>
            ))}
          </div>
        </div>
        <button
          className="inject-button"
          disabled={!canOperate || !operation}
          onClick={() => setInjectOpen(true)}
        >
          <SlidersHorizontal size={16} />
          <span>
            Inject
            <br />a disruption
          </span>
        </button>
      </footer>
      {present && (
        <button className="exit-presentation" onClick={() => setPresent(false)}>
          <Minus size={15} />
          Exit presentation · P
        </button>
      )}
      <Dialog.Root
        open={launcher && (!server || status === 'authenticated')}
        onOpenChange={setLauncher}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="launcher-scrim" />
          <Dialog.Content className="modal launcher">
            <div className="launcher-intro">
              <div className="eyebrow">
                <Shield size={17} /> BASTION / EXERCISE LAB
              </div>
              <Dialog.Title>
                Prepare for impact.
                <br />
                <em>Act with clarity.</em>
              </Dialog.Title>
              <Dialog.Description>
                A regional command table for the moments that matter. Simulate the impact,
                coordinate the response, restore access.
              </Dialog.Description>
              <div className="launcher-pillars">
                <span>01 SIMULATE</span>
                <ArrowRight size={14} />
                <span>02 ACT</span>
                <ArrowRight size={14} />
                <span>03 RESTORE</span>
              </div>
              <div className="launcher-source">
                <MapPin size={16} />
                <div>
                  <strong>Real places. Rehearsed response.</strong>
                  <p>OSM streets & footprints. Authored hazards, agency actions and population.</p>
                </div>
              </div>
            </div>
            <div className="launcher-options">
              <Tag tone="amber">TRAINING ENVIRONMENT</Tag>
              <h2>Choose your exercise</h2>
              {!server && (
                <label>
                  Operating region
                  <select
                    value={regionKey}
                    onChange={(e) => changeRegion(e.target.value as RegionKey)}
                  >
                    <option value="sunway">Sunway City · urban response</option>
                    <option value="srimuda">Taman Sri Muda · neighbourhood response</option>
                  </select>
                </label>
              )}
              <div className="scenario-options">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    className={scenarioId === s.id ? 'chosen' : ''}
                    onClick={() => setScenarioId(s.id)}
                  >
                    {s.hazard === 'flash_flood' ? <Waves size={25} /> : <Activity size={25} />}
                    <span>
                      <strong>
                        {s.hazard === 'flash_flood' ? 'Flash flood' : 'Earthquake stress test'}
                      </strong>
                      <small>
                        {s.hazard === 'flash_flood'
                          ? 'Rising water. Rescue. Access restored.'
                          : 'Hypothetical shaking. Collapse. Medical response.'}
                      </small>
                    </span>
                    <span className="radio-dot">{scenarioId === s.id && <Check size={12} />}</span>
                  </button>
                ))}
              </div>
              <p className="tiny">
                6:20 simulation · about 76 seconds at 5× speed
                <br />
                Works locally after the app loads · no map token needed
              </p>
              <button
                className="primary launch-button"
                disabled={!scenarioId || busy || !canOperate}
                onClick={launchSelected}
              >
                {busy ? 'Preparing region…' : 'Enter command'}
                <ArrowRight size={18} />
              </button>
              {error && <p className="error-text">{error.message}</p>}
              <p className="launcher-note">
                Sandbox only. No real emergency dispatch or power switching.
              </p>
            </div>
            <Dialog.Close className="modal-close" aria-label="Close exercise launcher">
              <X size={18} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {server && status !== 'authenticated' && (
        <Login login={login} busy={busy} run={run} error={error?.message} />
      )}
      <Dialog.Root open={injectOpen} onOpenChange={setInjectOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-scrim" />
          <Dialog.Content className="modal compact">
            <Dialog.Title>Change the situation.</Dialog.Title>
            <Dialog.Description>
              These disruptions change the exercise state immediately. Responders re-route when a
              road becomes impassable.
            </Dialog.Description>
            <InjectControls data={data} busy={busy} inject={inject} run={run} />
            <Dialog.Close className="modal-close" aria-label="Close disruption controls">
              <X size={18} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={sourceOpen} onOpenChange={setSourceOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-scrim" />
          <Dialog.Content className="modal compact provenance">
            <Dialog.Title>Know what you’re looking at.</Dialog.Title>
            <Dialog.Description>Transparency is part of the operating picture.</Dialog.Description>
            <section>
              <h4>Real geography</h4>
              <p>
                {data.region.edges.length.toLocaleString()} street segments and{' '}
                {data.surfaces.filter((s) => s.kind === 'building').length.toLocaleString()}{' '}
                building footprints. {data.provenance.source}, {data.provenance.license}.
              </p>
              <p className="tiny">
                Map snapshot: {data.provenance.retrieved?.slice(0, 10) || 'Server pack'}
              </p>
            </section>
            <section>
              <h4>Visual approximation</h4>
              <p>
                Flat terrain. Building heights use OSM tags where available and estimates elsewhere.
                Sunway Pyramid is a stylised landmark. Hazard depth is exaggerated visually.
              </p>
            </section>
            <section>
              <h4>Exercise data</h4>
              <p>
                Hazard coverage, incoming alerts, confidence, population, feeders, crews, facility
                operating status and shelter designations are authored for the demo. This is not a
                flood forecast or current emergency information.
              </p>
            </section>
            <section>
              <h4>Path to operational use</h4>
              <p>
                Requires verified sensor and agency feeds, calibrated hazard models, validated road
                restrictions, and approved dispatch and utility integrations. Satellite imagery
                alone cannot provide immediate flash-flood detection or safe switching decisions.
              </p>
            </section>
            <Dialog.Close className="modal-close" aria-label="Close data information">
              <X size={18} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AnimatePresence>
        {toast && (
          <motion.div
            className={`toast ${toast.error ? 'error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
            initial={{ opacity: 0, y: 12, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0 }}
          >
            {toast.error ? <X size={16} /> : <Check size={16} />}
            <span>{toast.message}</span>
            <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="exercise-stripe" />
    </main>
  );
}
function Metric({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`metric ${tone}`}>
      <b>{value.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}
function Login({
  login,
  run,
  busy,
  error,
}: {
  login: (email: string, password: string) => Promise<void>;
  run: PanelProps['run'];
  busy: boolean;
  error?: string;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  return (
    <div className="login-cover">
      <form
        className="modal compact"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => login(email, password));
        }}
      >
        <div className="eyebrow">BASTION / SERVER CONNECTION</div>
        <h2>Sign in to command.</h2>
        <p>Use your server account. This interface launches sandbox exercises.</p>
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          Sign in <ArrowRight size={16} />
        </button>
        {error && <p className="error-text">{error}</p>}
        <a href="/">Return to local demo</a>
      </form>
    </div>
  );
}
function InjectControls({
  data,
  busy,
  inject,
  run,
}: {
  data: LocalRegion;
  busy: boolean;
  inject: ReturnType<typeof useOperation>['inject'];
  run: PanelProps['run'];
}) {
  const [edgeId, setEdgeId] = useState(
      data.region.edges.find((e) => e.class === 'collector')?.id ?? data.region.edges[0].id,
    ),
    [facilityId, setFacilityId] = useState(
      data.region.facilities.find((f) => f.kind === 'hospital')!.id,
    );
  return (
    <>
      <label>
        Road segment
        <select value={edgeId} onChange={(e) => setEdgeId(e.target.value)}>
          {data.region.edges
            .filter((e) => e.class !== 'motorway')
            .slice(0, 500)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.id}
              </option>
            ))}
        </select>
      </label>
      <div className="button-row">
        <button
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                inject({
                  kind: 'set_road_status',
                  edgeIds: [edgeId],
                  status: 'blocked',
                  reason: 'Operator-injected debris',
                  estCrewHours: 2,
                }),
              'Road blocked; affected units will reroute',
            )
          }
        >
          <Plus size={14} />
          Block road
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                inject({
                  kind: 'set_road_status',
                  edgeIds: [edgeId],
                  status: 'open',
                  reason: 'Exercise road cleared',
                }),
              'Road reopened',
            )
          }
        >
          Reopen road
        </button>
      </div>
      <label>
        Critical facility
        <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
          {data.region.facilities
            .filter((f) => f.kind === 'hospital')
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
      </label>
      <button
        disabled={busy}
        onClick={() =>
          void run(
            () => inject({ kind: 'facility_power_loss', facilityId, backupFuelMin: 30 }),
            'Facility switched to 30 minutes of backup power',
          )
        }
      >
        <Zap size={14} />
        Inject power loss
      </button>
      <p className="tiny">
        <ArrowDown size={12} /> Changes appear in the audit trail and facility details.
      </p>
    </>
  );
}
