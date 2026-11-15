import type { IntelPort } from '@bastion/shared';
import { decisionSystem } from '../decision/dispatch';
import { protectiveSystem } from '../decision/protective';
import { createIntelSystem } from '../intel/bridge';
import { NullIntel } from '../intel/NullIntel';
import { hazardSystem } from './hazards/index';
import { metricsSystem } from './metrics';
import type { SystemFactory } from './runtime';
import { scenarioRunner } from './scenarioRunner';

/**
 * The per-step pipeline, in order:
 * scenario -> hazards -> intel and incidents -> grid -> dispatch decisions -> protective actions
 * -> action housekeeping -> units -> metrics.
 */
export function defaultSystems(intel: IntelPort = new NullIntel()): SystemFactory[] {
  return [
    scenarioRunner,
    hazardSystem,
    createIntelSystem(intel),
    (rt) => rt.grid.system(),
    decisionSystem,
    protectiveSystem,
    (rt) => rt.actions.system(),
    (rt) => rt.units.system(),
    metricsSystem,
  ];
}
