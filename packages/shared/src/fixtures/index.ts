/**
 * Test fixtures: a small synthetic region and a short scenario that exercises every event type.
 * Import from `@bastion/shared/fixtures`. Not for production code paths.
 */
import type { RegionStatic } from '../region';
import type { Scenario } from '../scenario';
import { regionMiniData } from './regionMini.data';
import { scenarioMini } from './scenarioMini';

export * from './miniGeometry';
export { SCENARIO_MINI_ID } from './scenarioMini';

/** A fresh copy of region-mini; safe to mutate. */
export function loadRegionMini(): RegionStatic {
  return structuredClone(regionMiniData);
}

/** A fresh copy of scenario-mini; safe to mutate. */
export function loadScenarioMini(): Scenario {
  return structuredClone(scenarioMini);
}
