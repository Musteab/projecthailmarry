import type { DecisionExplain, Facility, Incident, Unit, UnitKind } from '@bastion/shared';
import { distanceM } from '../geo';
import type { OperationRuntime, SystemFactory } from '../sim/runtime';

/** Matches the unit service: units answering a call drive faster than free flow. */
const RESPONSE_TIME_FACTOR = 0.7;
const TURNOUT_SEC = 15;
const MAX_ALTERNATIVES = 3;

/** Which unit kinds can cover a required capability. An ALS crew can take a BLS call. */
const ACCEPTABLE: Partial<Record<UnitKind, UnitKind[]>> = {
  bls_ambulance: ['bls_ambulance', 'als_ambulance'],
};
const AMBULANCES = new Set<UnitKind>(['als_ambulance', 'bls_ambulance']);

export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Higher goes first when two incidents want the same crew. */
export function priorityOf(incident: Incident, simTime: number): number {
  const acuity = incident.triage ? (6 - incident.triage.acuity) * 20 : 0;
  return (
    incident.severity * 100 +
    Math.min(incident.peopleAffected ?? 0, 20) * 2 +
    acuity +
    (simTime - incident.openedAt) / 30
  );
}

/** Hospitals that can take a patient now. */
export function functioningHospitals(rt: OperationRuntime): Facility[] {
  return rt.index.region.facilities.filter((facility) => {
    if (facility.kind !== 'hospital') return false;
    const state = rt.world.facilities[facility.id];
    return (
      Boolean(state) && state!.status !== 'offline' && state!.power !== 'none' && !state!.onDivert
    );
  });
}

interface Option {
  unit: Unit;
  /** seconds until on scene; Infinity when there is no open route */
  eta: number;
  distance: number;
}

/**
 * Decides who goes where. For every confirmed incident still missing a capability it finds the
 * capable unit that would arrive first over the roads that are actually open, lets higher
 * priority incidents choose first, and hands a proposal to the action pipeline with the reasons
 * and the alternatives it turned down. It runs again whenever the incidents, the available
 * units or the road network change, so a closed bridge changes the answer.
 */
export const decisionSystem: SystemFactory = () => {
  let lastSignature = '';
  let lastNetworkVersion = 0;
  const waitingNote = new Set<string>();

  return {
    name: 'decisions',
    update(rt) {
      const { world } = rt;
      const open = Object.values(world.incidents).filter(
        (incident) =>
          incident.status === 'confirmed' ||
          incident.status === 'assigned' ||
          incident.status === 'in_progress',
      );

      // What each incident still lacks, given the units already working it.
      const needs: { incident: Incident; capability: UnitKind }[] = [];
      for (const incident of open) {
        const covered = incident.assignedUnitIds.map((id) => world.units[id]?.kind);
        for (const capability of incident.requiredCapabilities) {
          const acceptable = ACCEPTABLE[capability] ?? [capability];
          if (covered.some((kind) => kind && acceptable.includes(kind))) continue;
          needs.push({ incident, capability });
        }
      }

      // The road network changed: what was the best choice may not be any more. Withdraw the
      // dispatch proposals still waiting for a decision and work them out again below.
      if (rt.network.version !== lastNetworkVersion) {
        lastNetworkVersion = rt.network.version;
        for (const action of Object.values(world.actions)) {
          if (action.status !== 'awaiting_approval') continue;
          if (action.kind !== 'dispatch_unit' && action.kind !== 'assign_ambulance') continue;
          rt.actions.withdraw(action.id, 'The road network changed; re-evaluated');
        }
      }

      const reserved = new Set<string>();
      for (const action of Object.values(world.actions)) {
        const p = action.payload;
        if (action.status === 'awaiting_approval' && 'unitId' in p) reserved.add(p.unitId);
      }

      // Skip the work when nothing that matters has changed since the last pass.
      const signature = [
        // Re-evaluate at least every half minute: priorities drift and cool-downs end.
        Math.floor(rt.simTime / 30),
        rt.network.version,
        needs
          .map((need) => `${need.incident.id}:${need.capability}:${need.incident.severity}`)
          .join(','),
        Object.values(world.units)
          .map((unit) => `${unit.id}:${unit.status}`)
          .join(','),
        [...reserved].join(','),
        functioningHospitals(rt)
          .map((hospital) => hospital.id)
          .join(','),
      ].join('|');
      if (signature === lastSignature) return;
      lastSignature = signature;
      if (needs.length === 0) return;

      needs.sort((a, b) => priorityOf(b.incident, rt.simTime) - priorityOf(a.incident, rt.simTime));
      const committed = new Map<string, Incident>();

      for (const { incident, capability } of needs) {
        const key = `dispatch:${incident.id}:${capability}`;
        if (rt.actions.waiting(key)) continue;

        const acceptable = ACCEPTABLE[capability] ?? [capability];
        const capable = Object.values(world.units).filter((unit) => acceptable.includes(unit.kind));
        // Seconds from every node to the incident, over the open network.
        const toIncident = rt.network.travelTimes([rt.index.nearestNodeId(incident.position)], {
          toward: true,
        });
        const options: Option[] = capable.map((unit) => {
          const node = rt.index.topology.requireNode(rt.index.nearestNodeId(unit.position));
          const drive = toIncident[node]!;
          return {
            unit,
            eta:
              drive === Infinity
                ? Infinity
                : drive * RESPONSE_TIME_FACTOR + (unit.status === 'available' ? TURNOUT_SEC : 0),
            distance: distanceM(unit.position, incident.position),
          };
        });

        const free = (option: Option) =>
          rt.units.isAvailable(option.unit) &&
          !reserved.has(option.unit.id) &&
          !committed.has(option.unit.id);
        const best = options
          .filter((option) => free(option) && option.eta !== Infinity)
          .sort((a, b) => a.eta - b.eta || a.unit.id.localeCompare(b.unit.id))[0];

        if (!best) {
          if (!waitingNote.has(key)) {
            waitingNote.add(key);
            const taken = options.find((option) => committed.has(option.unit.id));
            rt.event({
              kind: 'decision.waiting',
              severity: 'warn',
              title: `No ${capability.replace('_', ' ')} unit free for ${incident.title}`,
              detail: taken
                ? `${taken.unit.callsign} is committed to higher-priority ${committed.get(taken.unit.id)!.title}.`
                : 'Every capable unit is busy, out of service or cut off.',
              position: incident.position,
              refs: { incidentId: incident.id },
            });
          }
          continue;
        }
        waitingNote.delete(key);
        committed.set(best.unit.id, incident);

        const rejected = (option: Option): string => {
          const closer = option.distance < best.distance - 50;
          if (option.unit.status === 'out_of_service') return 'Out of service';
          if (committed.has(option.unit.id)) {
            return `Committed to higher-priority ${committed.get(option.unit.id)!.title}`;
          }
          if (reserved.has(option.unit.id)) return 'Held for a proposal awaiting approval';
          if (!rt.units.isAvailable(option.unit))
            return `Busy (${option.unit.status.replace('_', ' ')})`;
          if (option.eta === Infinity) {
            return closer
              ? 'Closer on the map, but no open route: roads or bridges on the way are closed'
              : 'No open route to the incident';
          }
          const slower = clock(option.eta - best.eta);
          return closer
            ? `Closer on the map, but the open route takes ${slower} longer`
            : `Would arrive ${slower} later`;
        };
        const alternatives = options
          .filter((option) => option.unit.id !== best.unit.id)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, MAX_ALTERNATIVES)
          .map((option) => ({
            label: option.unit.callsign,
            score: option.eta === Infinity ? 0 : Math.round((best.eta / option.eta) * 100) / 100,
            rejectedBecause: rejected(option),
          }));

        const ambulance = incident.kind === 'medical' && AMBULANCES.has(best.unit.kind);
        let hospital: Facility | undefined;
        if (ambulance) {
          const candidates = functioningHospitals(rt);
          const nearest = rt.network.nearest(
            rt.index.nearestNodeId(incident.position),
            candidates.map((candidate) => candidate.nodeId),
          );
          hospital = candidates.find((candidate) => candidate.nodeId === nearest?.nodeId);
        }

        const factors: DecisionExplain['factors'] = [
          { label: 'ETA', value: clock(best.eta), weight: 0.5 },
          { label: 'Capability', value: best.unit.kind.replace('_', ' '), weight: 0.2 },
          { label: 'Severity', value: `${incident.severity} of 5`, weight: 0.2 },
          ...(incident.peopleAffected
            ? [{ label: 'People involved', value: String(incident.peopleAffected) }]
            : []),
          ...(incident.triage
            ? [
                {
                  label: 'Triage',
                  value: `acuity ${incident.triage.acuity}: ${incident.triage.category}`,
                },
              ]
            : []),
          ...(hospital ? [{ label: 'Destination', value: hospital.name }] : []),
          ...(ambulance && !hospital
            ? [{ label: 'Destination', value: 'no functioning hospital is reachable' }]
            : []),
        ];

        rt.actions.propose({
          kind: ambulance ? 'assign_ambulance' : 'dispatch_unit',
          payload: ambulance
            ? {
                kind: 'assign_ambulance',
                unitId: best.unit.id,
                incidentId: incident.id,
                ...(hospital ? { hospitalId: hospital.id } : {}),
              }
            : { kind: 'dispatch_unit', unitId: best.unit.id, incidentId: incident.id },
          key,
          facts: {
            severity: incident.severity,
            confidence: incident.confidence,
            ...(incident.triage ? { acuity: incident.triage.acuity } : {}),
          },
          explain: {
            headline: `${best.unit.callsign} to ${incident.title}, ETA ${clock(best.eta)}`,
            factors,
            alternatives,
            confidence: incident.confidence,
          },
        });
      }
    },
  };
};
