import { BriefingSchema, CopilotResponseSchema } from '@bastion/shared';
import type { WorldSnapshot, RegionStatic, EntityRefs } from '@bastion/shared';
import type { IntelService } from '../port/service';
import { grounded, NARRATIVE_PROMPT } from '../narrative';
export function compactWorld(world: WorldSnapshot) {
  return {
    mode: world.operation.mode,
    simTime: world.clock.simTime,
    metrics: world.metrics,
    hazards: world.hazards,
    incidents: Object.values(world.incidents).slice(-30),
    actions: Object.values(world.actions)
      .slice(-30)
      .map((a) => ({ id: a.id, status: a.status, payload: a.payload, explain: a.explain })),
    facilities: world.facilities,
    gridSections: world.gridSections,
    timeline: world.timeline.slice(-25),
    restoration: world.restoration,
  };
}
export function validRefs(
  refs: EntityRefs[] | undefined,
  world: WorldSnapshot,
  region: RegionStatic,
) {
  return (
    !refs ||
    refs.every((ref) =>
      Object.entries(ref).every(([key, id]) => {
        switch (key) {
          case 'incidentId':
            return !!world.incidents[id];
          case 'actionId':
            return !!world.actions[id];
          case 'unitId':
            return !!world.units[id];
          case 'edgeId':
            return region.edges.some((e) => e.id === id);
          case 'facilityId':
            return region.facilities.some((f) => f.id === id);
          case 'sectionId':
            return region.grid.sections.some((s) => s.id === id);
          default:
            return false;
        }
      }),
    )
  );
}
export async function briefing(service: IntelService, world: WorldSnapshot) {
  const input = compactWorld(world);
  const pending = Object.values(world.actions).filter((a) => a.status === 'awaiting_approval');
  return service.run(
    'briefing',
    'briefing-v1',
    service.deepModel,
    NARRATIVE_PROMPT,
    input,
    grounded(BriefingSchema, input),
    () => ({
      generatedAt: world.clock.simTime,
      headline: `${world.metrics.activeIncidents} active incidents`,
      situation: `${world.metrics.peopleAtRisk} people at risk; ${world.metrics.unitsDeployed} units deployed.`,
      priorities: pending.map((a) => a.explain.headline).slice(0, 5),
      risks: world.hazards.filter((h) => h.phase === 'active').map((h) => h.label),
      recommendedActions: pending.map((a) => `Review: ${a.explain.headline}`).slice(0, 5),
    }),
  );
}
export async function copilot(
  service: IntelService,
  world: WorldSnapshot,
  region: RegionStatic,
  question: string,
) {
  const summary = compactWorld(world);
  const action =
    Object.values(world.actions).find((a) => question.includes(a.id)) ??
    Object.values(world.actions).at(-1);
  return service.run(
    'copilot',
    'copilot-v1',
    service.deepModel,
    NARRATIVE_PROMPT,
    { summary, question },
    grounded(CopilotResponseSchema, summary).refine(
      (v) => validRefs(v.refs, world, region),
      'Unknown entity reference',
    ),
    () => ({
      answer: action
        ? `${action.explain.headline}. ${action.explain.factors.map((f) => `${f.label}: ${f.value}`).join('; ')}`
        : 'No recorded decision is available to explain. Review the current incidents and agency rules.',
      refs: action ? [{ actionId: action.id }] : [],
    }),
  );
}
