import type { HazardSpec } from '@bastion/shared';
import type { System, SystemFactory } from '../runtime';
import { createEarthquakeSystem } from './earthquake';
import { createFloodSystem } from './flood';
import { createWindstormSystem } from './windstorm';

/**
 * Runs the hazard models the scenario asks for. Each model turns its hazard spec into per-cell
 * intensity and into damage (flooded or blocked roads, bridge states, facility power, incidents).
 */
export const hazardSystem: SystemFactory = (rt) => {
  const specs = rt.scenario?.hazards ?? [];
  const of = <K extends HazardSpec['kind']>(kind: K) =>
    specs.filter((spec): spec is Extract<HazardSpec, { kind: K }> => spec.kind === kind);

  const models: System[] = [];
  const floods = of('flash_flood');
  if (floods.length > 0) models.push(createFloodSystem(rt, floods));
  const quakes = of('earthquake');
  if (quakes.length > 0) models.push(createEarthquakeSystem(rt, quakes));
  const winds = [...of('tornado'), ...of('hurricane')];
  if (winds.length > 0) models.push(createWindstormSystem(rt, winds));

  return {
    name: 'hazards',
    update(runtime, dt) {
      for (const model of models) model.update(runtime, dt);
    },
  };
};
