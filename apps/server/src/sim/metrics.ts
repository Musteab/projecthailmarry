import type { Metrics } from '@bastion/shared';
import { isPassable } from '../routing/network';
import type { SystemFactory } from './runtime';

/** Water this deep, or shaking this strong, puts the people living in a cell at risk. */
export const AT_RISK = { floodDepthM: 0.3, shakeMMI: 7, windKph: 120 } as const;

/**
 * The last stage of the pipeline: recomputes the headline numbers from the world. Access
 * figures (isolated population, no hospital access) are filled in by the restoration engine.
 */
export const metricsSystem: SystemFactory = (rt) => {
  const population = new Map(rt.index.region.cells.map((cell) => [cell.id, cell.population]));

  return {
    name: 'metrics',
    update(runtime) {
      const { world } = runtime;

      let peopleAtRisk = 0;
      for (const [id, cell] of Object.entries(world.cells)) {
        if (
          (cell.floodDepthM ?? 0) >= AT_RISK.floodDepthM ||
          (cell.shakeMMI ?? 0) >= AT_RISK.shakeMMI ||
          (cell.windKph ?? 0) >= AT_RISK.windKph
        ) {
          peopleAtRisk += population.get(id) ?? 0;
        }
      }

      let activeIncidents = 0;
      for (const incident of Object.values(world.incidents)) {
        if (incident.status !== 'resolved' && incident.status !== 'closed') activeIncidents++;
      }

      let unitsDeployed = 0;
      for (const unit of Object.values(world.units)) {
        if (unit.status !== 'available' && unit.status !== 'out_of_service') unitsDeployed++;
      }

      let customersOut = 0;
      for (const section of Object.values(world.gridSections)) customersOut += section.customersOut;

      let roadsClosed = 0;
      for (const road of Object.values(world.roads)) if (!isPassable(road)) roadsClosed++;

      let sheltersOpen = 0;
      let shelterOccupancy = 0;
      for (const facility of Object.values(world.facilities)) {
        if (facility.activated) {
          sheltersOpen++;
          shelterOccupancy += facility.occupancy ?? 0;
        }
      }

      const metrics: Metrics = {
        ...world.metrics,
        peopleAtRisk,
        peopleRescued: runtime.stats.peopleRescued,
        activeIncidents,
        unitsDeployed,
        customersOut,
        roadsClosed,
        sheltersOpen,
        shelterOccupancy,
      };
      world.setMetrics(metrics);
    },
  };
};
