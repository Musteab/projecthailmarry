import type { IntelPort } from '@bastion/shared';
import { createIntelSystem } from '../intel/bridge';
import { NullIntel } from '../intel/NullIntel';
import { hazardSystem } from './hazards/index';
import { metricsSystem } from './metrics';
import type { SystemFactory } from './runtime';
import { scenarioRunner } from './scenarioRunner';

/**
 * The per-step pipeline, in order:
 * scenario -> hazards -> intel and incidents -> units -> metrics.
 * Decisions, actions and the grid are added by later tasks, before units.
 */
export function defaultSystems(intel: IntelPort = new NullIntel()): SystemFactory[] {
  return [
    scenarioRunner,
    hazardSystem,
    createIntelSystem(intel),
    (rt) => rt.units.system(),
    metricsSystem,
  ];
}
