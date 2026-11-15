import type { Incident, IncidentKind, LngLat, Unit } from '@bastion/shared';
import { pointAlong } from '../geo';
import type { Route } from '../routing/network';
import type { OperationRuntime, System } from '../sim/runtime';

/** Seconds between the order and the wheels turning, for a unit waiting at its station. */
const TURNOUT_SEC = 15;
/** Units answering a call drive faster than free-flow traffic. */
const RESPONSE_TIME_FACTOR = 0.7;
const MIN_LEG_SEC = 5;

/** Base seconds on scene by incident kind, scaled by severity. */
const SCENE_SEC: Record<IncidentKind, number> = {
  water_rescue: 150,
  medical: 90,
  structure_collapse: 420,
  fire: 300,
  road_blockage: 300,
  power_hazard: 240,
  shelter_need: 120,
  isolated_population: 180,
};
const RESCUE_KINDS = new Set<IncidentKind>(['water_rescue', 'structure_collapse', 'fire']);

type Phase = 'to_scene' | 'on_scene' | 'transporting' | 'to_site' | 'on_site' | 'returning';

interface Task {
  phase: Phase;
  incidentId?: string;
  hospitalId?: string;
  /** node the current leg ends at */
  destinationNodeId: string;
  sceneUntil?: number;
}

export function sceneDurationSec(incident: Pick<Incident, 'kind' | 'severity'>): number {
  return Math.round(SCENE_SEC[incident.kind] * (0.7 + 0.15 * incident.severity));
}

/**
 * Moves units through the world: turnout, driving a route, working a scene, transporting a
 * patient, returning home. The decision engine and work orders tell it where to send a unit;
 * it owns everything that happens after that, including re-routing when a road closes.
 */
export class UnitService {
  private readonly tasks = new Map<string, Task>();
  private checkedNetworkVersion = 0;

  constructor(private readonly rt: OperationRuntime) {}

  /** Whether the unit is free to take an assignment. */
  isAvailable(unit: Unit): boolean {
    return unit.status === 'available' || unit.status === 'returning';
  }

  private startLeg(
    unit: Unit,
    task: Task,
    target: { type: 'incident' | 'work_order' | 'facility'; id: string; position: LngLat },
    options: { turnout: boolean; urgent: boolean; status: Unit['status'] },
  ): Route | null {
    const { rt } = this;
    const route = rt.network.route(rt.index.nearestNodeId(unit.position), task.destinationNodeId);
    if (!route) return null;

    const departedSimTime = rt.simTime + (options.turnout ? TURNOUT_SEC : 0);
    const seconds = Math.max(
      MIN_LEG_SEC,
      route.seconds * (options.urgent ? RESPONSE_TIME_FACTOR : 1),
    );
    rt.world.setUnit({
      ...unit,
      status: options.status,
      assignment: {
        targetType: target.type,
        targetId: target.id,
        destination: target.position,
        // Start where the unit actually is and end at the target itself, so nothing teleports.
        route: [unit.position, ...route.geometry, target.position],
        routeEdgeIds: route.edgeIds,
        departedSimTime,
        etaSimTime: Math.round(departedSimTime + seconds),
      },
    });
    this.tasks.set(unit.id, task);
    return route;
  }

  /**
   * Sends a unit to an incident. `hospitalId` is where an ambulance takes the patient afterwards.
   * Returns the route, or null if the unit is busy or cannot reach the incident.
   */
  dispatchToIncident(unitId: string, incidentId: string, hospitalId?: string): Route | null {
    const { rt } = this;
    const unit = rt.world.units[unitId];
    const incident = rt.world.incidents[incidentId];
    if (!unit || !incident || !this.isAvailable(unit)) return null;

    const route = this.startLeg(
      unit,
      {
        phase: 'to_scene',
        incidentId,
        ...(hospitalId ? { hospitalId } : {}),
        destinationNodeId: rt.index.nearestNodeId(incident.position),
      },
      { type: 'incident', id: incidentId, position: incident.position },
      { turnout: unit.status === 'available', urgent: true, status: 'dispatched' },
    );
    if (!route) return null;

    rt.world.setIncident({
      ...incident,
      assignedUnitIds: [...new Set([...incident.assignedUnitIds, unitId])],
      status:
        incident.status === 'suspected' || incident.status === 'confirmed'
          ? 'assigned'
          : incident.status,
    });
    rt.event({
      kind: 'unit.dispatched',
      severity: 'info',
      title: `${unit.callsign} dispatched to ${incident.title}`,
      position: unit.position,
      refs: { unitId, incidentId },
    });
    return route;
  }

  /** Sends a unit to a work site (a road repair). It stays there until `release` is called. */
  sendToSite(unitId: string, workOrderId: string, position: LngLat): Route | null {
    const unit = this.rt.world.units[unitId];
    if (!unit || !this.isAvailable(unit)) return null;
    return this.startLeg(
      unit,
      { phase: 'to_site', destinationNodeId: this.rt.index.nearestNodeId(position) },
      { type: 'work_order', id: workOrderId, position },
      { turnout: unit.status === 'available', urgent: false, status: 'dispatched' },
    );
  }

  /** True once a unit sent with `sendToSite` has arrived. */
  isOnSite(unitId: string): boolean {
    return this.tasks.get(unitId)?.phase === 'on_site';
  }

  /** Ends whatever the unit is doing and sends it home. */
  release(unitId: string): void {
    const unit = this.rt.world.units[unitId];
    if (!unit || unit.status === 'out_of_service') return;
    const task = this.tasks.get(unitId);
    if (task?.incidentId) this.detachFromIncident(unitId, task.incidentId);
    this.sendHome(unit);
  }

  private detachFromIncident(unitId: string, incidentId: string): void {
    const incident = this.rt.world.incidents[incidentId];
    if (!incident) return;
    const assignedUnitIds = incident.assignedUnitIds.filter((id) => id !== unitId);
    const stillWorked = assignedUnitIds.length > 0;
    this.rt.world.setIncident({
      ...incident,
      assignedUnitIds,
      status:
        !stillWorked && (incident.status === 'assigned' || incident.status === 'in_progress')
          ? 'confirmed'
          : incident.status,
    });
  }

  private makeAvailable(unit: Unit, position: LngLat): void {
    const { assignment: _done, ...rest } = unit;
    this.rt.world.setUnit({ ...rest, position, status: 'available' });
    this.tasks.delete(unit.id);
  }

  private sendHome(unit: Unit): void {
    const home = this.rt.index.facilityById.get(unit.homeFacilityId)!;
    const started = this.startLeg(
      unit,
      { phase: 'returning', destinationNodeId: home.nodeId },
      { type: 'facility', id: home.id, position: home.position },
      { turnout: false, urgent: false, status: 'returning' },
    );
    // Cut off from its station: stay put and stay usable.
    if (!started) this.makeAvailable(unit, unit.position);
  }

  private resolveIncident(incident: Incident, finalStatus: 'resolved' | 'closed'): void {
    const { rt } = this;
    rt.world.setIncident({ ...incident, status: finalStatus, resolvedAt: rt.simTime });
    if (RESCUE_KINDS.has(incident.kind)) rt.stats.peopleRescued += incident.peopleAffected ?? 1;
    rt.event({
      kind: 'incident.resolved',
      severity: 'info',
      title: `Resolved: ${incident.title}`,
      position: incident.position,
      refs: { incidentId: incident.id },
    });
  }

  private arrive(unit: Unit, task: Task): void {
    const { rt } = this;
    const at = unit.assignment!.destination;

    switch (task.phase) {
      case 'to_scene': {
        const incident = task.incidentId ? rt.world.incidents[task.incidentId] : undefined;
        if (!incident || incident.status === 'resolved' || incident.status === 'closed') {
          this.sendHome({ ...unit, position: at });
          return;
        }
        rt.world.setUnit({ ...unit, position: at, status: 'on_scene' });
        task.phase = 'on_scene';
        task.sceneUntil = rt.simTime + sceneDurationSec(incident);
        if (incident.status !== 'in_progress') {
          rt.world.setIncident({ ...incident, status: 'in_progress' });
        }
        rt.event({
          kind: 'unit.on_scene',
          severity: 'info',
          title: `${unit.callsign} on scene: ${incident.title}`,
          position: at,
          refs: { unitId: unit.id, incidentId: incident.id },
        });
        return;
      }
      case 'to_site':
        rt.world.setUnit({ ...unit, position: at, status: 'on_scene' });
        task.phase = 'on_site';
        return;
      case 'transporting': {
        const incident = task.incidentId ? rt.world.incidents[task.incidentId] : undefined;
        if (incident && incident.status !== 'closed') this.resolveIncident(incident, 'closed');
        this.sendHome({ ...unit, position: at });
        return;
      }
      case 'returning':
        this.makeAvailable(unit, at);
        return;
      default:
        return;
    }
  }

  private finishScene(unit: Unit, task: Task): void {
    const { rt } = this;
    const incident = task.incidentId ? rt.world.incidents[task.incidentId] : undefined;
    const hospital = task.hospitalId ? rt.index.facilityById.get(task.hospitalId) : undefined;

    if (incident && incident.kind === 'medical' && hospital) {
      const started = this.startLeg(
        unit,
        { ...task, phase: 'transporting', destinationNodeId: hospital.nodeId },
        { type: 'facility', id: hospital.id, position: hospital.position },
        { turnout: false, urgent: true, status: 'transporting' },
      );
      if (started) {
        rt.event({
          kind: 'unit.transporting',
          severity: 'info',
          title: `${unit.callsign} transporting to ${hospital.name}`,
          position: unit.position,
          refs: { unitId: unit.id, incidentId: incident.id, facilityId: hospital.id },
        });
        return;
      }
    }
    if (incident) {
      const others = incident.assignedUnitIds.some((id) => {
        const other = this.tasks.get(id);
        return id !== unit.id && (other?.phase === 'on_scene' || other?.phase === 'to_scene');
      });
      if (!others && incident.status !== 'resolved' && incident.status !== 'closed') {
        this.resolveIncident(incident, 'resolved');
      }
    }
    this.sendHome(unit);
  }

  /** A road on the way closed: find another way, or give the assignment up. */
  private reroute(unit: Unit, task: Task): void {
    const { rt } = this;
    const assignment = unit.assignment!;
    const restarted = this.startLeg(
      unit,
      task,
      { type: assignment.targetType, id: assignment.targetId, position: assignment.destination },
      {
        turnout: false,
        urgent: task.phase === 'to_scene' || task.phase === 'transporting',
        status: unit.status,
      },
    );
    if (restarted) return;

    rt.event({
      kind: 'unit.route_failed',
      severity: 'warn',
      title: `${unit.callsign} cannot reach its destination: every route is closed`,
      position: unit.position,
      refs: { unitId: unit.id, ...(task.incidentId ? { incidentId: task.incidentId } : {}) },
    });
    if (task.incidentId && task.phase === 'to_scene') {
      this.detachFromIncident(unit.id, task.incidentId);
    }
    this.makeAvailable(unit, unit.position);
  }

  /** The pipeline stage that advances every unit by one step. */
  system(): System {
    return {
      name: 'units',
      update: (rt) => {
        const now = rt.simTime;
        const networkChanged = rt.network.version !== this.checkedNetworkVersion;
        this.checkedNetworkVersion = rt.network.version;

        for (const id of Object.keys(rt.world.units)) {
          const task = this.tasks.get(id);
          if (!task) continue;
          let unit = rt.world.units[id]!;

          if (unit.status === 'out_of_service') {
            if (task.incidentId) this.detachFromIncident(id, task.incidentId);
            this.tasks.delete(id);
            continue;
          }
          if (task.phase === 'on_site') continue;
          if (task.phase === 'on_scene') {
            if (now >= (task.sceneUntil ?? 0)) this.finishScene(unit, task);
            continue;
          }

          // Driving legs.
          const assignment = unit.assignment;
          if (!assignment) {
            this.tasks.delete(id);
            continue;
          }
          if (
            networkChanged &&
            assignment.routeEdgeIds.some((edgeId) => !rt.network.isEdgePassable(edgeId))
          ) {
            this.reroute(unit, task);
            continue;
          }
          if (now < assignment.departedSimTime) continue;
          if (now >= assignment.etaSimTime) {
            this.arrive(unit, task);
            continue;
          }
          const fraction =
            (now - assignment.departedSimTime) /
            (assignment.etaSimTime - assignment.departedSimTime);
          const { position, heading } = pointAlong(assignment.route, fraction);
          unit = {
            ...unit,
            position,
            heading: Math.round(heading),
            status: unit.status === 'dispatched' ? 'en_route' : unit.status,
          };
          rt.world.setUnit(unit);
        }
      },
    };
  }
}
