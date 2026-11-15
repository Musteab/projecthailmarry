import { z } from 'zod';
import { gridDisk, latLngToCell } from 'h3-js';
import { IncidentCandidateSchema } from '@bastion/shared';
import type {
  IncidentCandidate,
  IncidentKind,
  IntelContext,
  Signal,
  UnitKind,
} from '@bastion/shared';
import type { IntelService } from '../port/service';
import { FUSION_PROMPT, FUSION_VERSION } from './prompt';
export const fusionSchema = z.object({
  candidates: z.array(
    IncidentCandidateSchema.extend({
      position: z.array(z.number()).length(2),
      severity: z.number(),
      confidence: z.number(),
    }),
  ),
});
export function normalizeCandidate(
  candidate: z.infer<typeof fusionSchema>['candidates'][number],
): IncidentCandidate {
  return IncidentCandidateSchema.parse({
    ...candidate,
    severity: Math.max(1, Math.min(5, Math.round(candidate.severity))),
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
  });
}
const text = (s: Signal) => `${s.title} ${s.body}`;
export function classify(s: Signal): IncidentKind | undefined {
  const t = text(s);
  if (/chest pain|cardiac|not breathing|unconscious|injur|bleed|medical/i.test(t)) return 'medical';
  if (/collaps|rubble|structural damage/i.test(t)) return 'structure_collapse';
  if (/trapp|strand|water rescue/i.test(t)) return 'water_rescue';
  if (/downed wire|electric shock|grid fault/i.test(t)) return 'power_hazard';
  if (/road blocked|debris|road closure/i.test(t)) return 'road_blockage';
  if (/shelter|displaced/i.test(t)) return 'shelter_need';
  if (/building fire|smoke and flames/i.test(t)) return 'fire';
  return undefined;
}
const capabilities: Record<IncidentKind, UnitKind[]> = {
  medical: ['als_ambulance'],
  water_rescue: ['swift_water'],
  structure_collapse: ['usar'],
  power_hazard: ['utility_crew'],
  road_blockage: ['public_works'],
  shelter_need: [],
  isolated_population: ['police'],
  fire: ['engine'],
};
function inside(p: [number, number], ctx: IntelContext) {
  const [w, s, e, n] = ctx.region.bbox;
  return p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
}
function nearby(a: [number, number], b: [number, number]) {
  return gridDisk(latLngToCell(a[1], a[0], 9), 2).includes(latLngToCell(b[1], b[0], 9));
}
const contradicts = (s: Signal) =>
  s.data?.contradicts === true ||
  /no (?:one|people) (?:is |are )?trapped|false report|all clear/i.test(text(s));
export function clusterSignals(signals: Signal[], ctx: IntelContext): Signal[][] {
  const groups: Signal[][] = [];
  const unique = [...new Map(signals.map((s) => [s.id, s])).values()];
  for (const s of unique.sort((a, b) => a.simTime - b.simTime || a.id.localeCompare(b.id))) {
    if (!s.position || !inside(s.position, ctx) || !classify(s)) continue;
    const group = groups.find(
      (g) =>
        classify(g[0]) === classify(s) &&
        s.simTime - g[0].simTime <= 120 &&
        nearby(g[0].position!, s.position!),
    );
    if (group) group.push(s);
    else groups.push([s]);
  }
  return groups;
}
export function fallbackCluster(group: Signal[], ctx: IntelContext): IncidentCandidate | undefined {
  const supports = group.filter((s) => !contradicts(s));
  if (!supports.length || supports.every((s) => s.reliability < 0.6)) return undefined;
  const anchor = [...supports].sort(
    (a, b) => b.reliability - a.reliability || a.id.localeCompare(b.id),
  )[0];
  const kind = classify(anchor)!;
  const independent = new Set(supports.filter((s) => s.reliability >= 0.6).map((s) => s.source))
    .size;
  const confidence = Math.max(
    0,
    Math.min(0.98, anchor.reliability + 0.06 * (independent - 1)) -
      0.15 * (group.length - supports.length),
  );
  const existing = ctx.incidents.find(
    (i) =>
      i.kind === kind &&
      !['resolved', 'closed'].includes(i.status) &&
      nearby(i.position, anchor.position!),
  );
  return {
    kind,
    title: anchor.title,
    position: anchor.position!,
    severity: ['water_rescue', 'medical', 'structure_collapse', 'fire'].includes(kind) ? 4 : 3,
    confidence,
    summary: `${supports.length} reports support ${kind.replaceAll('_', ' ')}: ${supports.map((s) => s.id).join(', ')}.${group.length > supports.length ? ' Conflicting evidence lowers confidence.' : ''}`,
    sourceSignalIds: group.map((s) => s.id),
    requiredCapabilities: capabilities[kind],
    ...(existing ? { mergeWithIncidentId: existing.id } : {}),
  };
}
export function guardCandidates(
  candidates: IncidentCandidate[],
  groups: Signal[][],
  ctx: IntelContext,
): IncidentCandidate[] {
  return groups.flatMap((group) => {
    const baseline = fallbackCluster(group, ctx);
    if (!baseline) return [];
    const ids = new Set(group.map((s) => s.id));
    const candidate = candidates.find(
      (c) =>
        c.kind === baseline.kind &&
        c.sourceSignalIds.some((id) => ids.has(id)) &&
        c.sourceSignalIds.every((id) => ids.has(id)) &&
        inside(c.position, ctx) &&
        nearby(c.position, baseline.position),
    );
    if (!candidate) return [baseline];
    // Ground identity, capability, corroboration and merge targets in code even for cached output.
    return [
      {
        ...candidate,
        position: baseline.position,
        sourceSignalIds: baseline.sourceSignalIds,
        confidence: Math.min(candidate.confidence, baseline.confidence),
        severity: Math.max(baseline.severity, candidate.severity) as IncidentCandidate['severity'],
        requiredCapabilities: baseline.requiredCapabilities,
        mergeWithIncidentId: baseline.mergeWithIncidentId,
        peopleAffected: undefined,
      },
    ];
  });
}
export async function fuse(service: IntelService, signals: Signal[], ctx: IntelContext) {
  const groups = clusterSignals(signals, ctx);
  if (!groups.length) return [];
  const input = {
    clusters: groups,
    region: ctx.region,
    incidents: ctx.incidents,
    hazards: ctx.hazards,
  };
  const response = await service.run(
    'fusion',
    FUSION_VERSION,
    service.fastModel,
    FUSION_PROMPT,
    input,
    fusionSchema,
    () => ({
      candidates: groups.flatMap((g) => {
        const c = fallbackCluster(g, ctx);
        return c ? [c] : [];
      }),
    }),
  );
  return guardCandidates(response.candidates.map(normalizeCandidate), groups, ctx);
}
