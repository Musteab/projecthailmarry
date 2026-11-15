import type { Incident, IncidentKind, Inject, RoadState, UnitKind } from '@bastion/shared';
import { badRequest } from '../errors';
import type { OperationRuntime } from './runtime';

/** The capability an incident needs when nothing more specific is known. */
export const DEFAULT_CAPABILITIES: Record<IncidentKind, UnitKind[]> = {
  water_rescue: ['swift_water'],
  medical: ['als_ambulance'],
  structure_collapse: ['usar'],
  fire: ['engine'],
  road_blockage: ['public_works'],
  power_hazard: ['utility_crew'],
  shelter_need: [],
  isolated_population: [],
};

const BRIDGE_DAMAGE = {
  restricted: { status: 'damaged', speedFactor: 0.4, repair: 'inspection', hours: 2, crews: 1 },
  closed: { status: 'closed', speedFactor: undefined, repair: 'inspection', hours: 3, crews: 1 },
  collapsed: {
    status: 'damaged',
    speedFactor: undefined,
    repair: 'bridge_repair',
    hours: 72,
    crews: 3,
  },
} as const;

const DEFAULT_BACKUP_FUEL_MIN = 120;

/**
 * Applies a what-if inject to a running operation. Used by scenario timelines and by the
 * inject endpoint. Throws a 400 when the inject names something the region does not have.
 */
export function applyInject(rt: OperationRuntime, inject: Inject): void {
  const { world, index } = rt;

  switch (inject.kind) {
    case 'set_road_status': {
      const edges = inject.edgeIds.map((edgeId) => {
        const edge = index.edgeById.get(edgeId);
        if (!edge) throw badRequest(`Unknown road edge "${edgeId}"`);
        return edge;
      });
      for (const edge of edges) {
        const state: RoadState | null =
          inject.status === 'open'
            ? null
            : { status: inject.status, reason: inject.reason, closurePublished: false };
        rt.setRoadState(edge.id, state);
      }
      const first = edges[0]!;
      const label = first.name ?? first.id;
      if (inject.status !== 'open' && inject.estCrewHours !== undefined) {
        rt.addRepairCandidate({
          kind: inject.status === 'blocked' ? 'debris_clearance' : 'washout_repair',
          label: `${inject.status === 'blocked' ? 'Clear debris on' : 'Repair'} ${label}`,
          edgeIds: inject.edgeIds,
          position: first.geometry[Math.floor(first.geometry.length / 2)]!,
          estCrewHours: inject.estCrewHours,
          crewsRequired: 1,
        });
      }
      rt.event({
        kind: 'road.status',
        severity: inject.status === 'open' ? 'info' : 'warn',
        title: `${label}: ${inject.status}`,
        detail: inject.reason,
        position: first.geometry[0]!,
        refs: { edgeId: first.id },
      });
      return;
    }

    case 'damage_bridge': {
      const bridge = index.bridgeById.get(inject.bridgeId);
      if (!bridge) throw badRequest(`Unknown bridge "${inject.bridgeId}"`);
      const damage = BRIDGE_DAMAGE[inject.severity];
      const reason = `${bridge.name} ${inject.severity} after structural damage`;
      for (const edgeId of bridge.edgeIds) {
        rt.setRoadState(edgeId, {
          status: damage.status,
          reason,
          closurePublished: false,
          ...(damage.speedFactor === undefined ? {} : { speedFactor: damage.speedFactor }),
        });
      }
      const firstEdge = index.edgeById.get(bridge.edgeIds[0]!)!;
      const position = firstEdge.geometry[Math.floor(firstEdge.geometry.length / 2)]!;
      rt.addRepairCandidate({
        kind: damage.repair,
        label: `${damage.repair === 'inspection' ? 'Inspect and reopen' : 'Repair'} ${bridge.name}`,
        edgeIds: [...bridge.edgeIds],
        position,
        estCrewHours: damage.hours,
        crewsRequired: damage.crews,
      });
      rt.event({
        kind: 'bridge.damaged',
        severity: inject.severity === 'restricted' ? 'warn' : 'critical',
        title: `${bridge.name} ${inject.severity}`,
        detail: reason,
        position,
        refs: { edgeId: firstEdge.id },
      });
      return;
    }

    case 'facility_power_loss': {
      const facility = index.facilityById.get(inject.facilityId);
      const state = world.facilities[inject.facilityId];
      if (!facility || !state) throw badRequest(`Unknown facility "${inject.facilityId}"`);
      world.setFacility(facility.id, {
        ...state,
        status: state.status === 'offline' ? 'offline' : 'degraded',
        power: 'backup',
        backupFuelMin: inject.backupFuelMin ?? DEFAULT_BACKUP_FUEL_MIN,
      });
      rt.event({
        kind: 'facility.power_loss',
        severity: facility.kind === 'hospital' ? 'critical' : 'warn',
        title: `${facility.name} lost grid power`,
        detail: `Running on backup power, about ${inject.backupFuelMin ?? DEFAULT_BACKUP_FUEL_MIN} minutes of fuel.`,
        position: facility.position,
        refs: { facilityId: facility.id },
      });
      return;
    }

    case 'facility_offline': {
      const facility = index.facilityById.get(inject.facilityId);
      const state = world.facilities[inject.facilityId];
      if (!facility || !state) throw badRequest(`Unknown facility "${inject.facilityId}"`);
      const { backupFuelMin: _fuel, ...rest } = state;
      world.setFacility(facility.id, { ...rest, status: 'offline', power: 'none' });
      rt.event({
        kind: 'facility.offline',
        severity: 'critical',
        title: `${facility.name} is offline`,
        position: facility.position,
        refs: { facilityId: facility.id },
      });
      return;
    }

    case 'grid_fault': {
      const section = index.sectionById.get(inject.sectionId);
      if (!section) throw badRequest(`Unknown grid section "${inject.sectionId}"`);
      world.setGridSection(section.id, {
        status: 'faulted',
        threatened: false,
        customersOut: section.customers,
      });
      rt.event({
        kind: 'grid.fault',
        severity: 'warn',
        title: `Fault on ${section.feederId} section ${section.id}`,
        detail: `${section.customers} customers without power.`,
        position: section.path[0]!,
        refs: { sectionId: section.id },
      });
      return;
    }

    case 'unit_out_of_service': {
      const unit = world.units[inject.unitId];
      if (!unit) throw badRequest(`Unknown unit "${inject.unitId}"`);
      const { assignment: _assignment, ...rest } = unit;
      world.setUnit({ ...rest, status: 'out_of_service' });
      rt.event({
        kind: 'unit.out_of_service',
        severity: 'info',
        title: `${unit.callsign} is out of service`,
        position: unit.position,
        refs: { unitId: unit.id },
      });
      return;
    }

    case 'spawn_incident': {
      const given = inject.incident;
      const incident: Incident = {
        status: 'confirmed',
        confidence: 1,
        sourceSignalIds: [],
        requiredCapabilities: DEFAULT_CAPABILITIES[given.kind],
        assignedUnitIds: [],
        ...given,
        id: world.nextId('inc'),
        cellId: given.cellId ?? index.nearestCellId(given.position),
        openedAt: rt.simTime,
      };
      world.setIncident(incident);
      rt.event({
        kind: 'incident.opened',
        severity: incident.severity >= 4 ? 'critical' : 'warn',
        title: incident.title,
        position: incident.position,
        refs: { incidentId: incident.id },
      });
      return;
    }
  }
}
