import type { LngLat, RepairCandidate, User, WorkOrder, WorkOrderStatus } from '@bastion/shared';
import { conflict, notFound } from '../errors';
import type { OperationRuntime, System } from '../sim/runtime';

/**
 * Sim seconds of work per crew-hour. Repairs are time-compressed so a two-hour clearance
 * finishes on stage; public works can change it with the `workSecondsPerCrewHour` rule param.
 */
const DEFAULT_SEC_PER_CREW_HOUR = 30;
const INSPECTION_SEC = 20;
/** Where a repair resumes after a failed inspection. */
const REWORK_FROM = 0.7;

/** Steps a person may take by hand. Everything else happens as the work progresses. */
const MANUAL: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  created: ['cancelled'],
  assigned: ['cancelled'],
  in_progress: ['inspection', 'cancelled'],
  inspection: ['reopened', 'failed_inspection'],
  failed_inspection: ['in_progress', 'cancelled'],
  reopened: [],
  cancelled: [],
};

/**
 * Turns a chosen restoration option into tracked work: a public-works crew is sent to the site,
 * the repair progresses, it is inspected, and the road reopens on the map. Reopening changes the
 * road network, which makes the restoration engine re-rank what is left.
 */
export class WorkOrderService {
  private readonly inspectionUntil = new Map<string, number>();

  /** Progress between the 5% steps that are sent to clients. */
  private readonly exactProgress = new Map<string, number>();

  constructor(private readonly rt: OperationRuntime) {}

  private secPerCrewHour(): number {
    const value = this.rt.actions.ruleFor('create_work_order', 'public_works')?.params
      .workSecondsPerCrewHour;
    return typeof value === 'number' && value > 0 ? value : DEFAULT_SEC_PER_CREW_HOUR;
  }

  private move(
    order: WorkOrder,
    status: WorkOrderStatus,
    by: string,
    patch: Partial<WorkOrder> = {},
  ) {
    const next: WorkOrder = {
      ...order,
      ...patch,
      status,
      history: [...order.history, { status, at: this.rt.simTime, by }],
    };
    this.rt.world.setWorkOrder(next);
    this.rt.audit({
      simTime: this.rt.simTime,
      actor: by,
      verb: 'work_order.transitioned',
      detail: `${order.title}: ${order.status} -> ${status}`,
    });
    return next;
  }

  /** Creates one work order per repair in the option. Returns a failure reason on error. */
  createFromOption(optionId: string, by: string): WorkOrder[] | string {
    const { rt } = this;
    const option = rt.restoration.option(optionId);
    if (!option) return `Unknown restoration option "${optionId}"`;
    const active = Object.values(rt.world.workOrders).filter(
      (order) => order.status !== 'reopened' && order.status !== 'cancelled',
    );
    const orders: WorkOrder[] = [];
    for (const candidateId of option.candidateIds) {
      const candidate = rt.repairCandidates.get(candidateId);
      if (!candidate) return `Repair "${candidateId}" no longer exists`;
      if (active.some((order) => order.candidateId === candidateId)) {
        return `There is already a work order for ${candidate.label}`;
      }
      const order: WorkOrder = {
        id: rt.world.nextId('wo'),
        operationId: rt.operation.id,
        optionId,
        candidateId,
        title: candidate.label,
        status: 'created',
        assignedUnitIds: [],
        progress: 0,
        history: [{ status: 'created', at: rt.simTime, by }],
      };
      rt.world.setWorkOrder(order);
      rt.audit({
        simTime: rt.simTime,
        actor: by,
        verb: 'work_order.created',
        detail: order.title,
      });
      rt.event({
        kind: 'work_order.created',
        severity: 'info',
        title: `Work order issued: ${order.title}`,
        position: candidate.position,
      });
      orders.push(order);
    }
    return orders;
  }

  /** A step taken by a coordinator. Throws 409 when the order is not in a state that allows it. */
  transition(workOrderId: string, to: WorkOrderStatus, user: User): WorkOrder {
    const order = this.rt.world.workOrders[workOrderId];
    if (!order) throw notFound(`Work order "${workOrderId}"`);
    if (!MANUAL[order.status].includes(to)) {
      throw conflict(
        `A work order that is ${order.status.replace('_', ' ')} cannot be moved to ${to.replace('_', ' ')}`,
        {
          status: order.status,
          allowed: MANUAL[order.status],
        },
      );
    }
    switch (to) {
      case 'cancelled':
        for (const unitId of order.assignedUnitIds) this.rt.units.release(unitId);
        this.inspectionUntil.delete(order.id);
        return this.move(order, 'cancelled', user.id, { assignedUnitIds: [] });
      case 'inspection':
        this.inspectionUntil.set(order.id, this.rt.simTime + INSPECTION_SEC);
        return this.move(order, 'inspection', user.id, { progress: 1 });
      case 'reopened':
        return this.reopen(order, user.id);
      case 'failed_inspection':
        this.inspectionUntil.delete(order.id);
        this.exactProgress.set(order.id, REWORK_FROM);
        return this.move(order, 'failed_inspection', user.id, { progress: REWORK_FROM });
      case 'in_progress':
        return this.move(order, 'in_progress', user.id);
      default:
        throw conflict(`Cannot move a work order to ${to}`);
    }
  }

  private reopen(order: WorkOrder, by: string): WorkOrder {
    const { rt } = this;
    const candidate = rt.repairCandidates.get(order.candidateId);
    if (candidate) {
      for (const edgeId of candidate.edgeIds) rt.setRoadState(edgeId, null);
      rt.repairCandidates.delete(candidate.id);
    }
    for (const unitId of order.assignedUnitIds) rt.units.release(unitId);
    this.inspectionUntil.delete(order.id);
    rt.event({
      kind: 'work_order.reopened',
      severity: 'info',
      title: `Reopened: ${order.title}`,
      ...(candidate
        ? { position: candidate.position, refs: { edgeId: candidate.edgeIds[0]! } }
        : {}),
    });
    return this.move(order, 'reopened', by, { progress: 1, assignedUnitIds: [] });
  }

  /** The nearest free public-works crew that can drive to the site. */
  private pickCrew(candidate: RepairCandidate): { unitId: string; site: LngLat } | undefined {
    const { rt } = this;
    const { topology } = rt.index;
    // The blocked road itself cannot be driven, so the crew works from whichever end of it
    // they can actually reach.
    const ends = [
      ...new Set(
        candidate.edgeIds.flatMap((edgeId) => {
          const edge = rt.index.edgeById.get(edgeId);
          return edge ? [edge.from, edge.to] : [];
        }),
      ),
    ];
    if (ends.length === 0) return undefined;
    const toSite = rt.network.travelTimes(ends, { toward: true });

    let best: { unitId: string; node: string; seconds: number } | undefined;
    for (const unit of Object.values(rt.world.units)) {
      if (unit.kind !== 'public_works' || !rt.units.isAvailable(unit)) continue;
      const node = rt.index.nearestNodeId(unit.position);
      const seconds = toSite[topology.requireNode(node)]!;
      if (seconds === Infinity) continue;
      if (!best || seconds < best.seconds) best = { unitId: unit.id, node, seconds };
    }
    if (!best) return undefined;
    const end = rt.network.nearest(best.node, ends);
    if (!end) return undefined;
    return {
      unitId: best.unitId,
      site: topology.nodes[topology.requireNode(end.nodeId)]!.position,
    };
  }

  system(): System {
    return {
      name: 'work-orders',
      update: (rt, dt) => {
        for (const order of Object.values(rt.world.workOrders)) {
          const candidate = rt.repairCandidates.get(order.candidateId);
          switch (order.status) {
            case 'created': {
              if (!candidate) break;
              const crew = this.pickCrew(candidate);
              if (!crew || !rt.units.sendToSite(crew.unitId, order.id, crew.site)) break;
              this.move(order, 'assigned', 'platform', { assignedUnitIds: [crew.unitId] });
              break;
            }
            case 'assigned': {
              const [crew] = order.assignedUnitIds;
              const unit = crew ? rt.world.units[crew] : undefined;
              // The crew was pulled away or lost its route: look for another one.
              if (
                !unit ||
                (unit.assignment?.targetId !== order.id && !rt.units.isOnSite(unit.id))
              ) {
                this.move(order, 'created', 'platform', { assignedUnitIds: [] });
                break;
              }
              if (rt.units.isOnSite(unit.id)) this.move(order, 'in_progress', 'platform');
              break;
            }
            case 'in_progress': {
              const total = Math.max(1, (candidate?.estCrewHours ?? 1) * this.secPerCrewHour());
              const current = this.exactProgress.get(order.id) ?? order.progress;
              const progress = Math.min(1, Math.max(current, order.progress) + dt / total);
              this.exactProgress.set(order.id, progress);
              if (progress >= 1) {
                this.inspectionUntil.set(order.id, rt.simTime + INSPECTION_SEC);
                this.move(order, 'inspection', 'platform', { progress: 1 });
              } else if (Math.floor(progress * 20) !== Math.floor(order.progress * 20)) {
                rt.world.setWorkOrder({ ...order, progress: Math.round(progress * 100) / 100 });
              }
              break;
            }
            case 'inspection': {
              const until = this.inspectionUntil.get(order.id);
              if (until !== undefined && rt.simTime >= until) this.reopen(order, 'platform');
              break;
            }
            default:
              break;
          }
        }
      },
    };
  }
}
