import { hazardSystem } from './hazards/index';
import type { SystemFactory } from './runtime';
import { scenarioRunner } from './scenarioRunner';

/**
 * The per-step pipeline, in order. Each later task adds its system here:
 * scenario -> hazards -> grid -> incidents -> decisions -> actions -> units -> metrics.
 */
export function defaultSystems(): SystemFactory[] {
  return [scenarioRunner, hazardSystem];
}
