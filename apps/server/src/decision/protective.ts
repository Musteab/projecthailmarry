import type { Facility, LngLat } from '@bastion/shared';
import { distanceM } from '../geo';
import { isPassable } from '../routing/network';
import { AT_RISK } from '../sim/metrics';
import type { SystemFactory } from '../sim/runtime';
import { functioningHospitals } from './dispatch';

const DEFAULT_DISPLACED_THRESHOLD = 100;
/** Closures that appear within this many sim seconds are published together. */
const CLOSURE_BATCH_SEC = 30;
/** People arriving at an open shelter per sim second. */
const SHELTER_INTAKE_PER_SEC = 4;

/**
 * Protective actions other than dispatch: publishing confirmed road closures, diverting
 * ambulances from a hospital that has lost power, and opening shelters. Each is proposed to the
 * action pipeline, where the owning agency's rule decides whether it happens automatically.
 */
export const protectiveSystem: SystemFactory = (rt) => {
  const shelters = rt.index.region.facilities.filter((facility) => facility.kind === 'shelter');
  const population = new Map(rt.index.region.cells.map((cell) => [cell.id, cell]));
  let closuresPendingSince: number | null = null;

  return {
    name: 'protective',
    update(runtime, dt) {
      const { world } = runtime;

      // --- road closures: tell the public about roads that are actually impassable ---------
      const unpublished = Object.entries(world.roads)
        .filter(([, road]) => !road.closurePublished && !isPassable(road))
        .map(([edgeId]) => edgeId);
      // Roads close one after another as the water spreads. Wait a little so they go out as
      // one notice rather than a stream of them.
      if (unpublished.length === 0) closuresPendingSince = null;
      else closuresPendingSince ??= runtime.simTime;
      if (
        unpublished.length > 0 &&
        runtime.simTime - (closuresPendingSince ?? runtime.simTime) >= CLOSURE_BATCH_SEC
      ) {
        closuresPendingSince = null;
        const reasons = [...new Set(unpublished.map((id) => world.roads[id]!.status))].join(', ');
        const first = runtime.index.edgeById.get(unpublished[0]!)!;
        runtime.actions.propose({
          kind: 'publish_road_closure',
          payload: {
            kind: 'publish_road_closure',
            edgeIds: unpublished,
            reason: `Road ${reasons}`,
          },
          key: 'closure:unpublished',
          facts: { confidence: 1, severity: 3 },
          explain: {
            headline:
              unpublished.length === 1
                ? `Publish closure of ${first.name ?? first.id} (${reasons})`
                : `Publish ${unpublished.length} road closures (${reasons})`,
            factors: [
              { label: 'Segments', value: String(unpublished.length) },
              { label: 'Cause', value: reasons },
              { label: 'Source', value: 'confirmed by the hazard model and field reports' },
            ],
            alternatives: [],
            confidence: 1,
          },
        });
      }

      // --- hospital diversion: stop sending patients to a hospital in trouble --------------
      for (const hospital of runtime.index.region.facilities) {
        if (hospital.kind !== 'hospital') continue;
        const state = world.facilities[hospital.id];
        if (!state || state.onDivert) continue;
        const troubled = state.status === 'offline' || state.power !== 'grid';
        if (!troubled) continue;
        const others = functioningHospitals(runtime).filter((other) => other.id !== hospital.id);
        const nearestOther = others.sort(
          (a, b) =>
            distanceM(a.position, hospital.position) - distanceM(b.position, hospital.position),
        )[0];
        runtime.actions.propose({
          kind: 'divert_hospital',
          payload: {
            kind: 'divert_hospital',
            facilityId: hospital.id,
            ...(nearestOther ? { toFacilityId: nearestOther.id } : {}),
          },
          key: `divert:${hospital.id}`,
          facts: { severity: 4, confidence: 1 },
          explain: {
            headline: `Divert ambulances from ${hospital.name}`,
            factors: [
              {
                label: 'Reason',
                value:
                  state.status === 'offline'
                    ? 'hospital is offline'
                    : `on ${state.power === 'backup' ? 'backup power' : 'no power'}${
                        state.backupFuelMin === undefined
                          ? ''
                          : `, ${state.backupFuelMin} min of fuel`
                      }`,
              },
              {
                label: 'Patients go to',
                value: nearestOther?.name ?? 'no other hospital available',
              },
            ],
            alternatives: [
              {
                label: 'Keep receiving patients',
                score: 0.2,
                rejectedBecause: 'Capacity and care are limited without grid power',
              },
            ],
            confidence: 1,
          },
        });
      }

      // --- shelters ------------------------------------------------------------------------
      const needs = Object.values(world.incidents).filter(
        (incident) =>
          incident.kind === 'shelter_need' &&
          incident.status !== 'resolved' &&
          incident.status !== 'closed',
      );
      let displaced = needs.reduce((sum, incident) => sum + (incident.peopleAffected ?? 0), 0);
      let centre: LngLat | undefined = needs[0]?.position;
      for (const [cellId, state] of Object.entries(world.cells)) {
        if ((state.floodDepthM ?? 0) < AT_RISK.floodDepthM * 2) continue; // homes actually flooded
        const cell = population.get(cellId);
        if (!cell) continue;
        displaced += cell.population;
        centre ??= cell.center;
      }

      const open = shelters.filter((shelter) => world.facilities[shelter.id]?.activated);
      const capacityLeft = open.reduce(
        (sum, shelter) =>
          sum +
          Math.max(0, (shelter.capacity ?? 0) - (world.facilities[shelter.id]?.occupancy ?? 0)),
        0,
      );
      const sheltered = open.reduce(
        (sum, shelter) => sum + (world.facilities[shelter.id]?.occupancy ?? 0),
        0,
      );
      const rule = runtime.actions.ruleFor('activate_shelter', 'ema');
      const threshold =
        typeof rule?.params.displacedThreshold === 'number'
          ? rule.params.displacedThreshold
          : DEFAULT_DISPLACED_THRESHOLD;
      const unmet = displaced - sheltered;

      if (centre && unmet >= threshold && capacityLeft < unmet) {
        const from = runtime.index.nearestNodeId(centre);
        const candidates = shelters.filter((shelter) => {
          const state = world.facilities[shelter.id];
          return state && !state.activated && state.status !== 'offline';
        });
        const reach = (shelter: Facility) => runtime.network.secondsBetween(from, shelter.nodeId);
        const ranked = candidates
          .map((shelter) => ({ shelter, seconds: reach(shelter) }))
          .filter((entry) => entry.seconds !== Infinity)
          .sort((a, b) => a.seconds - b.seconds);
        const chosen = ranked[0];
        if (chosen) {
          runtime.actions.propose({
            kind: 'activate_shelter',
            payload: { kind: 'activate_shelter', facilityId: chosen.shelter.id },
            key: `shelter:${chosen.shelter.id}`,
            facts: { severity: 3, confidence: 0.9 },
            explain: {
              headline: `Activate shelter: ${chosen.shelter.name}`,
              factors: [
                { label: 'People needing shelter', value: String(unmet) },
                { label: 'Capacity', value: String(chosen.shelter.capacity ?? 'unknown') },
                {
                  label: 'Drive from the affected area',
                  value: `${Math.round(chosen.seconds / 60)} min`,
                },
              ],
              alternatives: ranked.slice(1, 3).map((entry) => ({
                label: entry.shelter.name,
                score: Math.round((chosen.seconds / entry.seconds) * 100) / 100,
                rejectedBecause: `${Math.round((entry.seconds - chosen.seconds) / 60)} min farther by open roads`,
              })),
              confidence: 0.9,
            },
          });
        }
      }

      // People arrive at open shelters; a need is met once there is room for it.
      let arriving = Math.min(Math.max(0, unmet), SHELTER_INTAKE_PER_SEC * dt);
      for (const shelter of open) {
        if (arriving <= 0) break;
        const state = world.facilities[shelter.id]!;
        const room = (shelter.capacity ?? 0) - (state.occupancy ?? 0);
        const taken = Math.min(room, arriving);
        if (taken <= 0) continue;
        world.setFacility(shelter.id, { ...state, occupancy: (state.occupancy ?? 0) + taken });
        arriving -= taken;
      }
      if (open.length > 0) {
        for (const incident of needs) {
          if (sheltered >= (incident.peopleAffected ?? 0)) {
            world.setIncident({ ...incident, status: 'resolved', resolvedAt: runtime.simTime });
          }
        }
      }
    },
  };
};
