import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Crosshair,
  FileDown,
  Radio,
  ShieldCheck,
  Siren,
  X,
  Zap,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { motion } from 'motion/react';
import {
  useActionCommands,
  useActions,
  useBriefing,
  useCopilot,
  useFacilityStates,
  useGridSections,
  useIncidents,
  useOperation,
  useRestoration,
  useRestorationCommands,
  useRoadStates,
  useRules,
  useSignals,
  useTimeline,
  useUnits,
  useWorkOrders,
  useBastionClient,
} from '@bastion/client';
import { can } from '@bastion/shared';
import type {
  AccessImpact,
  Action,
  ActionPayload,
  LngLat,
  Role,
  WorkOrderStatus,
} from '@bastion/shared';
import type { LocalRegion } from '../data/regions';
import type { Selection } from './MapScene';

export type Panel = 'response' | 'recovery' | 'utilities' | 'briefing';
export type Run = (task: () => Promise<unknown>, success?: string) => Promise<void>;
export type PanelProps = {
  data: LocalRegion;
  selection: Selection;
  select: (selection: Selection) => void;
  focus: (p: LngLat) => void;
  run: Run;
  role: Role;
  busy: boolean;
  compareImpact: (impact: AccessImpact) => void;
};
export const human = (text: string) => text.replaceAll('_', ' ');
export const time = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty">
      <Radio size={24} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Tag({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function ActionFeed({ select, selection }: Pick<PanelProps, 'select' | 'selection'>) {
  const actions = useActions(),
    signals = useSignals();
  const pending = actions.filter((a) => a.status === 'awaiting_approval').length;
  const sorted = [...actions].sort(
    (a, b) =>
      Number(b.status === 'awaiting_approval') - Number(a.status === 'awaiting_approval') ||
      b.proposedAt - a.proposedAt,
  );
  return (
    <>
      <div className="rail-heading">
        <span>Decision stream</span>
        <Tag tone={pending ? 'amber' : ''}>{pending ? `${pending} TO REVIEW` : 'MONITORING'}</Tag>
      </div>
      <div className="feed-scroll">
        {!actions.length && (
          <Empty title="Listening to the region">
            Incoming exercise signals will appear here. Press play or jump to a chapter below.
          </Empty>
        )}
        {sorted.map((action) => (
          <motion.button
            layout
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            key={action.id}
            className={`decision ${selection?.id === action.id ? 'selected' : ''} ${action.status === 'awaiting_approval' ? 'pending' : ''}`}
            onClick={() => select({ type: 'action', id: action.id })}
          >
            <div className="decision-top">
              <span className={`authority-dot ${action.authority}`} />
              {human(action.authority)}
              <time>{time(action.proposedAt)}</time>
            </div>
            <h3>{action.explain.headline}</h3>
            <div className="decision-bottom">
              <span className={`status ${action.status}`}>
                {action.status === 'executed' ? (
                  <Check size={12} />
                ) : action.status === 'awaiting_approval' ? (
                  <ShieldCheck size={12} />
                ) : null}
                {human(action.status)}
              </span>
              <ArrowRight size={14} />
            </div>
          </motion.button>
        ))}
        <div className="subheading">
          Evidence received <span>{signals.length.toString().padStart(2, '0')}</span>
        </div>
        {[...signals]
          .reverse()
          .slice(0, 10)
          .map((signal) => (
            <article className="signal" key={signal.id}>
              <span className="tiny">
                {human(signal.source === 'call_911' ? 'emergency_call_999' : signal.source)} ·{' '}
                {time(signal.simTime)}
              </span>
              <p>{signal.title}</p>
            </article>
          ))}
      </div>
      <div className="rail-foot">
        <span className="pulse-dot green" />
        Deterministic exercise engine
      </div>
    </>
  );
}
function ActionDetail({ action, ...props }: PanelProps & { action: Action }) {
  const commands = useActionCommands(),
    [reason, setReason] = useState(''),
    [dialog, setDialog] = useState<'reject' | 'override' | null>(null),
    units = useUnits(),
    [replacementId, setReplacementId] = useState('');
  const allowed = can({ role: props.role }, 'approve', action.authority);
  const pending = ['awaiting_approval', 'proposed', 'approved'].includes(action.status),
    overridable = !['rejected', 'overridden', 'failed', 'expired'].includes(action.status);
  const payload = action.payload;
  let replacement: ActionPayload | undefined;
  if (payload.kind === 'dispatch_unit' || payload.kind === 'assign_ambulance')
    replacement = { ...payload, unitId: replacementId };
  else if (payload.kind === 'isolate_grid_section' || payload.kind === 'restore_grid_section')
    replacement = {
      ...payload,
      kind:
        payload.kind === 'isolate_grid_section' ? 'restore_grid_section' : 'isolate_grid_section',
    };
  return (
    <div className="detail-content">
      <div className="eyebrow">DECISION / {human(action.authority)}</div>
      <h2>{action.explain.headline}</h2>
      <div className="tag-row">
        <Tag tone="amber">SANDBOXED</Tag>
        <Tag tone={action.status === 'executed' ? 'green' : ''}>{human(action.status)}</Tag>
      </div>
      <section>
        <h4>Why this action</h4>
        {action.explain.factors.map((f, i) => (
          <div className="key-value" key={i}>
            <span>{f.label}</span>
            <b>{f.value}</b>
          </div>
        ))}
        <p className="muted">{action.explain.narrative}</p>
        <div className="confidence">
          <span>Scenario confidence</span>
          <strong>{Math.round(action.explain.confidence * 100)}%</strong>
        </div>
        <div className="meter">
          <i style={{ width: `${action.explain.confidence * 100}%` }} />
        </div>
        <p className="tiny">Authored scenario value · not a measured AI accuracy score</p>
      </section>
      {action.ruleId && (
        <section>
          <h4>Authority & rule</h4>
          <p>
            <ShieldCheck size={14} /> {action.ruleId}
          </p>
          <p className="muted">
            {action.decidedBy === 'auto'
              ? 'Executed under the configured exercise autonomy rule.'
              : 'Operator review applies to this decision.'}
          </p>
        </section>
      )}
      {action.explain.alternatives.length > 0 && (
        <section>
          <h4>Alternative considered</h4>
          {action.explain.alternatives.map((a, i) => (
            <div key={i}>
              <strong>{a.label}</strong>
              <p className="muted">{a.rejectedBecause}</p>
            </div>
          ))}
        </section>
      )}
      {action.rejectReason && <p className="notice">{action.rejectReason}</p>}
      <div className="actions-stack">
        {pending && (
          <button
            className="primary"
            disabled={!allowed || props.busy}
            onClick={() =>
              void props.run(
                () => commands.approve(action.id),
                'Action approved and applied to the exercise',
              )
            }
          >
            <Check size={16} />
            Approve action
          </button>
        )}
        {pending && (
          <button disabled={!allowed || props.busy} onClick={() => setDialog('reject')}>
            Reject with reason
          </button>
        )}
        {overridable && (
          <button disabled={!allowed || props.busy} onClick={() => setDialog('override')}>
            Override decision
          </button>
        )}
        {!allowed && (
          <p className="notice">
            Your {human(props.role)} persona cannot decide {human(action.authority)} actions.
          </p>
        )}
      </div>
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal-scrim" />
          <Dialog.Content className="modal compact">
            <Dialog.Title>
              {dialog === 'reject' ? 'Reject action' : 'Override decision'}
            </Dialog.Title>
            <Dialog.Description>
              Record the reason in the exercise audit trail. An override does not undo a completed
              action without a replacement.
            </Dialog.Description>
            <label>
              Reason
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain your operational decision"
              />
            </label>
            {dialog === 'override' &&
              (payload.kind === 'dispatch_unit' || payload.kind === 'assign_ambulance') && (
                <label>
                  Replacement crew (optional)
                  <select value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
                    <option value="">Record override only</option>
                    {units
                      .filter((u) => u.status === 'available')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.callsign} · {human(u.kind)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            {dialog === 'override' &&
              (payload.kind === 'isolate_grid_section' ||
                payload.kind === 'restore_grid_section') && (
                <p className="notice">
                  Replacement: {payload.kind === 'isolate_grid_section' ? 'restore' : 'isolate'}{' '}
                  this feeder in the exercise.
                </p>
              )}
            <button
              className="primary"
              disabled={reason.trim().length < 3 || props.busy}
              onClick={() =>
                void props.run(async () => {
                  if (dialog === 'reject') await commands.reject(action.id, reason);
                  else
                    await commands.override(
                      action.id,
                      reason,
                      replacement && (!('unitId' in replacement) || replacementId)
                        ? replacement
                        : undefined,
                    );
                  setDialog(null);
                  setReason('');
                }, 'Decision recorded')
              }
            >
              Record {dialog}
            </button>
            <Dialog.Close className="modal-close" aria-label="Close dialog">
              <X size={18} />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
export function ResponsePanel(props: PanelProps) {
  const incidents = useIncidents(),
    units = useUnits(),
    signals = useSignals(),
    actions = useActions(),
    facilityStates = useFacilityStates(),
    roads = useRoadStates(),
    grid = useGridSections(),
    commands = useActionCommands(),
    { clock } = useOperation();
  const [unitId, setUnitId] = useState('');
  const s = props.selection,
    action = s?.type === 'action' ? actions.find((a) => a.id === s.id) : undefined;
  if (action) return <ActionDetail key={action.id} {...props} action={action} />;
  const incident = s?.type === 'incident' ? incidents.find((i) => i.id === s.id) : undefined;
  if (incident)
    return (
      <div className="detail-content">
        <div className="eyebrow">INCIDENT / SEVERITY {incident.severity}</div>
        <h2>{incident.title}</h2>
        <div className="tag-row">
          <Tag tone="red">{human(incident.kind)}</Tag>
          <Tag>{human(incident.status)}</Tag>
        </div>
        <button className="text-button" onClick={() => props.focus(incident.position)}>
          <Crosshair size={14} />
          Locate on map
        </button>
        <p>{incident.aiSummary}</p>
        <section>
          <h4>Response requirements</h4>
          <div className="key-value">
            <span>People affected</span>
            <b>{incident.peopleAffected ?? 'Unconfirmed'}</b>
          </div>
          <div className="key-value">
            <span>Capability</span>
            <b>{incident.requiredCapabilities.map(human).join(', ')}</b>
          </div>
          {incident.triage && (
            <p className="notice">
              Triage {incident.triage.acuity} · {incident.triage.category}
              <br />
              {incident.triage.chiefComplaint}
            </p>
          )}
        </section>
        <section>
          <h4>Corroborating evidence</h4>
          {signals
            .filter((sig) => incident.sourceSignalIds.includes(sig.id))
            .map((sig) => (
              <article className="evidence" key={sig.id}>
                <span className="tiny">
                  {human(sig.source)} · {time(sig.simTime)}
                </span>
                <strong>{sig.title}</strong>
                <p>{sig.body}</p>
              </article>
            ))}
        </section>
        <section>
          <h4>Assigned units</h4>
          {incident.assignedUnitIds.map((id) => (
            <button
              className="entity-row"
              key={id}
              onClick={() => props.select({ type: 'unit', id })}
            >
              {units.find((u) => u.id === id)?.callsign ?? id}
              <ArrowRight size={14} />
            </button>
          ))}
          {!incident.assignedUnitIds.length && <p className="muted">No unit assigned yet.</p>}
        </section>
        {!['resolved', 'closed'].includes(incident.status) && (
          <section>
            <h4>Request another unit</h4>
            <select
              aria-label="Response unit"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
            >
              <option value="">Select available unit</option>
              {units
                .filter((u) => u.status === 'available')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.callsign} · {human(u.kind)}
                  </option>
                ))}
            </select>
            <button
              disabled={
                !unitId ||
                props.busy ||
                !can(
                  { role: props.role },
                  'approve',
                  incident.kind === 'medical' ? 'ems' : 'fire_rescue',
                )
              }
              onClick={() =>
                void props.run(
                  () =>
                    commands.create({
                      kind: incident.kind === 'medical' ? 'assign_ambulance' : 'dispatch_unit',
                      unitId,
                      incidentId: incident.id,
                    }),
                  'Dispatch proposal created; review it in the decision stream',
                )
              }
            >
              Propose dispatch <ArrowRight size={14} />
            </button>
          </section>
        )}
      </div>
    );
  const unit = s?.type === 'unit' ? units.find((u) => u.id === s.id) : undefined;
  if (unit)
    return (
      <div className="detail-content">
        <div className="eyebrow">RESPONSE ASSET</div>
        <h2>{unit.callsign}</h2>
        <Tag tone="green">{human(unit.status)}</Tag>
        <section>
          <div className="key-value">
            <span>Capability</span>
            <b>{human(unit.kind)}</b>
          </div>
          <div className="key-value">
            <span>Authority</span>
            <b>{human(unit.authority)}</b>
          </div>
          <div className="key-value">
            <span>ETA remaining</span>
            <b>
              {unit.assignment
                ? time(Math.max(0, unit.assignment.etaSimTime - (clock?.simTime ?? 0)))
                : '—'}
            </b>
          </div>
          <div className="key-value">
            <span>Street segments</span>
            <b>{unit.assignment?.routeEdgeIds.length ?? 0}</b>
          </div>
        </section>
        <button onClick={() => props.focus(unit.position)}>
          <Crosshair size={14} />
          Locate unit
        </button>
        <button
          disabled={props.busy || !can({ role: props.role }, 'approve', 'ema')}
          onClick={() =>
            void props.run(
              () => commands.create({ kind: 'recall_unit', unitId: unit.id }),
              'Recall proposal added for approval',
            )
          }
        >
          Propose recall
        </button>
        <p className="muted">
          Travel time uses the street graph and nominal speeds. It excludes traffic, turn
          restrictions and real flood conditions.
        </p>
      </div>
    );
  const facility =
    s?.type === 'facility' ? props.data.region.facilities.find((f) => f.id === s.id) : undefined;
  if (facility) {
    const state = facilityStates[facility.id];
    return (
      <div className="detail-content">
        <div className="eyebrow">FACILITY / {human(facility.kind)}</div>
        <h2>{facility.name}</h2>
        <Tag tone={state?.power === 'grid' ? 'green' : 'amber'}>
          {state?.power ?? 'unknown'} power
        </Tag>
        <section>
          <div className="key-value">
            <span>Status</span>
            <b>{state?.status ?? 'unknown'}</b>
          </div>
          <div className="key-value">
            <span>Backup remaining</span>
            <b>
              {state?.backupFuelMin === undefined ? '—' : `${Math.round(state.backupFuelMin)} min`}
            </b>
          </div>
          {facility.capacity && (
            <div className="key-value">
              <span>Exercise capacity</span>
              <b>
                {state?.occupancy ?? 0} / {facility.capacity}
              </b>
            </div>
          )}
        </section>
        <button onClick={() => props.focus(facility.position)}>
          <Crosshair size={14} />
          Locate facility
        </button>
        {facility.kind === 'shelter' && (
          <button
            disabled={
              !!state?.activated || props.busy || !can({ role: props.role }, 'approve', 'ema')
            }
            onClick={() =>
              void props.run(
                () => commands.create({ kind: 'activate_shelter', facilityId: facility.id }),
                'Shelter activation proposed',
              )
            }
          >
            Propose shelter activation
          </button>
        )}
        <p className="notice">
          Operational status, capacity and designation are exercise data. This does not indicate an
          official emergency shelter.
        </p>
      </div>
    );
  }
  const edge = s?.type === 'road' ? props.data.region.edges.find((e) => e.id === s.id) : undefined;
  if (edge)
    return (
      <div className="detail-content">
        <div className="eyebrow">ROAD SEGMENT / OPENSTREETMAP</div>
        <h2>{edge.name ?? edge.id}</h2>
        <Tag tone="red">{roads[edge.id]?.status ?? 'open'}</Tag>
        <p>{roads[edge.id]?.reason}</p>
        <div className="key-value">
          <span>Length</span>
          <b>{Math.round(edge.lengthM)} m</b>
        </div>
        <button onClick={() => props.focus(edge.geometry[0])}>
          <Crosshair size={14} />
          Locate road
        </button>
        <button
          disabled={props.busy || !can({ role: props.role }, 'approve', 'ema')}
          onClick={() =>
            void props.run(
              () =>
                commands.create({
                  kind: 'publish_road_closure',
                  edgeIds: [edge.id],
                  reason: 'Operator-confirmed exercise closure',
                }),
              'Closure proposal created',
            )
          }
        >
          Propose road closure
        </button>
      </div>
    );
  const section =
    s?.type === 'grid' ? props.data.region.grid.sections.find((g) => g.id === s.id) : undefined;
  if (section)
    return (
      <div className="detail-content">
        <div className="eyebrow">EXERCISE ELECTRICITY NETWORK</div>
        <h2>{section.id}</h2>
        <Tag tone="amber">{grid[section.id]?.status ?? 'energized'}</Tag>
        <p>
          {section.customers} synthetic customers · {section.criticalFacilityIds.length} critical
          facility
        </p>
        <button
          disabled={props.busy || !can({ role: props.role }, 'approve', 'utility')}
          onClick={() =>
            void props.run(
              () =>
                commands.create({
                  kind:
                    grid[section.id]?.status === 'energized'
                      ? 'isolate_grid_section'
                      : 'restore_grid_section',
                  sectionId: section.id,
                }),
              'Utility proposal added for approval',
            )
          }
        >
          Propose {grid[section.id]?.status === 'energized' ? 'isolation' : 'restoration'}
        </button>
        <p className="notice">
          Illustrative utility topology. No TNB or physical equipment connection.
        </p>
      </div>
    );
  return (
    <div className="detail-content">
      <div className="eyebrow">REGIONAL SITUATION</div>
      <h2>
        Eyes on the ground.
        <br />
        Decisions in motion.
      </h2>
      <p className="muted">Select a marker or decision to inspect evidence and take action.</p>
      <section>
        <h4>
          Incidents <span>{incidents.length}</span>
        </h4>
        {incidents.length ? (
          incidents.map((i) => (
            <button
              className="entity-row"
              key={i.id}
              onClick={() => {
                props.select({ type: 'incident', id: i.id });
                props.focus(i.position);
              }}
            >
              <Siren size={16} />
              <span>
                <b>{i.title}</b>
                <small>
                  {human(i.status)} · {i.peopleAffected} people
                </small>
              </span>
              <ArrowRight size={14} />
            </button>
          ))
        ) : (
          <p className="muted">No confirmed incidents yet.</p>
        )}
      </section>
      <section>
        <h4>
          Response fleet <span>{units.length}</span>
        </h4>
        {units.map((u) => (
          <button
            key={u.id}
            className="fleet-row"
            onClick={() => {
              props.select({ type: 'unit', id: u.id });
              props.focus(u.position);
            }}
          >
            <span className={`fleet-dot ${u.status === 'available' ? 'green' : 'amber'}`} />
            <b>{u.callsign}</b>
            <span>{human(u.status)}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
export function RecoveryPanel(props: PanelProps) {
  const analysis = useRestoration(),
    commands = useRestorationCommands(),
    orders = useWorkOrders(),
    [impact, setImpact] = useState<{
      cells: number;
      before: number | null;
      after: number | null;
    } | null>(null),
    allowed = can({ role: props.role }, 'restoration');
  const next: Partial<Record<WorkOrderStatus, WorkOrderStatus>> = {
    created: 'assigned',
    assigned: 'in_progress',
    in_progress: 'inspection',
    inspection: 'reopened',
    failed_inspection: 'in_progress',
  };
  return (
    <div className="detail-content">
      <div className="eyebrow">RESTORE / PRIORITIZE ACCESS</div>
      <h2>
        The next road
        <br />
        changes everything.
      </h2>
      <p className="muted">
        Compare clearance by modeled hospital access. Population and crew hours are synthetic;
        routes use OSM streets.
      </p>
      <button
        className="primary"
        disabled={!allowed || props.busy}
        onClick={() => void props.run(() => commands.analyze(), 'Recovery analysis updated')}
      >
        Analyze road access <ArrowRight size={15} />
      </button>
      {!analysis?.options.length && (
        <Empty title="No repairs ranked yet">
          Run the recovery chapter or close a road in the scenario controls, then analyze access.
        </Empty>
      )}
      {analysis?.options.map((option) => (
        <section className="recovery-option" key={option.id}>
          <div className="option-rank">
            {String(option.rank).padStart(2, '0')}
            <Tag tone={option.rank === 1 ? 'green' : ''}>
              {option.rank === 1 ? 'RECOMMENDED' : 'ALTERNATIVE'}
            </Tag>
          </div>
          <h3>{option.label}</h3>
          <div className="key-value">
            <span>People reconnected</span>
            <b>{option.impact.isolatedPopReconnected}</b>
          </div>
          <div className="key-value">
            <span>Mean hospital journey</span>
            <b>
              {option.impact.avgHospitalMinBefore?.toFixed(1) ?? '—'} →{' '}
              {option.impact.avgHospitalMinAfter?.toFixed(1) ?? '—'} min
            </b>
          </div>
          <div className="key-value">
            <span>Estimated crew time</span>
            <b>{option.estHours} h</b>
          </div>
          <button
            onClick={() =>
              void props.run(async () => {
                const value = await commands.loadImpact(option.id);
                setImpact({
                  cells: value.cells.length,
                  before: option.impact.avgHospitalMinBefore,
                  after: option.impact.avgHospitalMinAfter,
                });
                props.compareImpact(value);
                const candidate = analysis.candidates.find((c) =>
                  option.candidateIds.includes(c.id),
                );
                if (candidate) {
                  props.focus(candidate.position);
                }
              })
            }
          >
            Inspect access comparison
          </button>
          <button
            className="primary"
            disabled={
              !allowed ||
              props.busy ||
              orders.some((o) => o.optionId === option.id && o.status !== 'cancelled')
            }
            onClick={() =>
              void props.run(() => commands.createWorkOrder(option.id), 'Work order issued')
            }
          >
            Issue work order
          </button>
        </section>
      ))}
      {impact && (
        <p className="notice" role="status">
          Compared {impact.cells} cells: mean hospital time{' '}
          {impact.before?.toFixed(1) ?? 'unreachable'} → {impact.after?.toFixed(1) ?? 'unreachable'}{' '}
          minutes. Route estimates exclude traffic.
        </p>
      )}
      <section>
        <h4>
          Work orders <span>{orders.length}</span>
        </h4>
        {orders.map((order) => (
          <article className="work-order" key={order.id}>
            <Tag tone={order.status === 'reopened' ? 'green' : 'amber'}>{human(order.status)}</Tag>
            <h3>{order.title}</h3>
            <div className="meter">
              <i style={{ width: `${order.progress * 100}%` }} />
            </div>
            <ol>
              {order.history.map((h, i) => (
                <li key={i}>
                  {human(h.status)} <time>{time(h.at)}</time>
                </li>
              ))}
            </ol>
            {next[order.status] && (
              <button
                disabled={!allowed || props.busy}
                onClick={() =>
                  void props.run(
                    () => commands.transition(order.id, next[order.status]!),
                    'Work order advanced',
                  )
                }
              >
                {order.status === 'inspection'
                  ? 'Pass inspection & reopen'
                  : `Mark ${human(next[order.status]!)}`}
              </button>
            )}
            {order.status === 'inspection' && (
              <button
                disabled={!allowed || props.busy}
                onClick={() =>
                  void props.run(
                    () => commands.transition(order.id, 'failed_inspection'),
                    'Inspection failed; road remains closed',
                  )
                }
              >
                Fail inspection
              </button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
export function UtilitiesPanel(props: PanelProps) {
  const grid = useGridSections(),
    { rules, update } = useRules(),
    commands = useActionCommands();
  return (
    <div className="detail-content">
      <div className="eyebrow">UTILITY / PROTECT & RESTORE</div>
      <h2>
        Local protection.
        <br />
        Accountable control.
      </h2>
      <p className="notice">
        <Zap size={15} />
        Illustrative feeders only. No physical power switching.
      </p>
      <section>
        <h4>Network sections</h4>
        {props.data.region.grid.sections.map((s, i) => (
          <article className="grid-section" key={s.id}>
            <div className="key-value">
              <b>FEEDER {String(i + 1).padStart(2, '0')}</b>
              <Tag tone={grid[s.id]?.status === 'energized' ? 'green' : 'amber'}>
                {grid[s.id]?.status ?? 'energized'}
              </Tag>
            </div>
            <p>
              {grid[s.id]?.customersOut ?? 0} / {s.customers} exercise customers without grid power
            </p>
            <div className="button-row">
              <button
                onClick={() => {
                  props.select({ type: 'grid', id: s.id });
                  props.focus(s.path[0]);
                }}
              >
                Locate
              </button>
              <button
                disabled={props.busy || !can({ role: props.role }, 'approve', 'utility')}
                onClick={() =>
                  void props.run(
                    () =>
                      commands.create({
                        kind:
                          grid[s.id]?.status === 'energized'
                            ? 'isolate_grid_section'
                            : 'restore_grid_section',
                        sectionId: s.id,
                      }),
                    'Utility proposal created; review the decision stream',
                  )
                }
              >
                {grid[s.id]?.status === 'energized' ? 'Isolate' : 'Restore'}
              </button>
            </div>
          </article>
        ))}
      </section>
      <section>
        <h4>Autonomy rules</h4>
        {rules.map((rule) => (
          <article className="rule" key={rule.id}>
            <strong>{rule.name}</strong>
            <p className="muted">{rule.description}</p>
            <label>
              Execution policy
              <select
                value={rule.autonomy}
                disabled={props.busy || !can({ role: props.role }, 'rules', rule.authority)}
                onChange={(e) =>
                  void props.run(
                    () =>
                      update(rule.id, { autonomy: e.target.value as 'auto' | 'approve' | 'off' }),
                    'Rule policy updated',
                  )
                }
              >
                <option value="auto">Execute automatically</option>
                <option value="approve">Require approval</option>
                <option value="off">Disabled</option>
              </select>
            </label>
            <p className="tiny">
              {human(rule.authority)} · {rule.id}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
export function BriefingPanel({ run, busy }: PanelProps) {
  const { briefing, loading, refresh } = useBriefing(),
    { ask, history } = useCopilot(),
    [question, setQuestion] = useState(''),
    timeline = useTimeline(),
    client = useBastionClient();
  const download = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            mode: 'exercise',
            world: client.world.getState().world,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'bastion-exercise-audit.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="detail-content">
      <div className="eyebrow">BRIEF / SHARED SITUATIONAL AWARENESS</div>
      <h2>
        One clear picture.
        <br />
        Every decision traced.
      </h2>
      <p className="notice">
        Local scripted briefing. No live AI or external feeds are connected in this demo.
      </p>
      <button
        className="primary"
        disabled={loading || busy}
        onClick={() => void run(refresh, 'Situation briefing updated')}
      >
        {loading ? 'Preparing briefing…' : 'Refresh situation briefing'}
      </button>
      {briefing && (
        <section>
          <h3>{briefing.headline}</h3>
          <p>{briefing.situation}</p>
          <h4>Priorities</h4>
          {briefing.priorities.length ? (
            <ul>
              {briefing.priorities.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No pending approvals.</p>
          )}
        </section>
      )}
      <section>
        <h4>Exercise assistant</h4>
        {history.map((h, i) => (
          <article className="answer" key={i}>
            <strong>{h.q}</strong>
            <p>{h.a}</p>
          </article>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim())
              void run(async () => {
                await ask(question);
                setQuestion('');
              });
          }}
        >
          <label>
            Situation question
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What needs my attention?"
            />
          </label>
          <button disabled={!question.trim() || busy}>
            Ask exercise assistant <ArrowRight size={14} />
          </button>
        </form>
      </section>
      <section>
        <h4>
          Audit trail <span>{timeline.length}</span>
        </h4>
        <button onClick={download}>
          <FileDown size={14} />
          Export exercise log
        </button>
        {[...timeline]
          .reverse()
          .slice(0, 15)
          .map((event) => (
            <article key={event.id} className="signal">
              <time className="tiny">
                {time(event.simTime)} / {event.kind}
              </time>
              <p>{event.title}</p>
            </article>
          ))}
      </section>
    </div>
  );
}
