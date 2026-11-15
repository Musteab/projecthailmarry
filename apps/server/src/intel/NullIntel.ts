import type {
  Action,
  IncidentCandidate,
  IncidentKind,
  IntelContext,
  IntelPort,
  LngLat,
  RestorationAnalysis,
  Severity,
  Signal,
  TriageResult,
} from '@bastion/shared';
import { distanceM } from '../geo';
import { DEFAULT_CAPABILITIES } from '../sim/injects';

/**
 * A rule-based IntelPort with no model behind it. The server uses it when @bastion/intel is not
 * available, when it is slow or failing, and in tests. It is deterministic and synchronous, so
 * a run that uses it is reproducible step for step.
 */

const CLUSTER_RADIUS_M = 200;
const CLUSTER_WINDOW_SEC = 180;

/** Sources that describe a specific event at a specific place. The rest are context. */
const EVENT_SOURCES = new Set<Signal['source']>(['field_report', 'call_911', 'imagery', 'social']);

const KIND_RULES: { kind: IncidentKind; pattern: RegExp; severity: Severity; title: string }[] = [
  {
    kind: 'structure_collapse',
    pattern: /collaps|pancaked|trapped (under|in the rubble)|rubble/i,
    severity: 5,
    title: 'Structure collapse with people trapped',
  },
  {
    kind: 'water_rescue',
    pattern:
      /stranded|on (the|their|its) roof|on top of (our|the|a|their) (car|vehicle|house)|swept away|submerged|rising water|trapped by (the )?water|in (moving|the) water/i,
    severity: 4,
    title: 'Water rescue: people trapped by flood water',
  },
  {
    kind: 'medical',
    pattern:
      /chest pain|not breathing|unconscious|unresponsive|cardiac|heart attack|seizure|bleeding|short of breath|stroke|overdose|injur|dialysis/i,
    severity: 3,
    title: 'Medical emergency',
  },
  { kind: 'fire', pattern: /\bfire\b|smoke|flames|burning/i, severity: 4, title: 'Fire reported' },
  {
    kind: 'power_hazard',
    pattern: /power line|downed line|sparking|arcing|live wire/i,
    severity: 3,
    title: 'Electrical hazard',
  },
  {
    kind: 'road_blockage',
    pattern: /road (is )?blocked|debris (on|across)|tree down|impassable/i,
    severity: 2,
    title: 'Road blocked',
  },
  {
    kind: 'shelter_need',
    pattern: /displaced|evacuat|needs? shelter|nowhere to go/i,
    severity: 2,
    title: 'Residents need shelter',
  },
];

const VULNERABLE = /child|children|kids|baby|infant|elderly|wheelchair|pregnant/i;
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const PEOPLE =
  /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:more\s+)?(people|persons|adults|children|kids|residents|occupants|patients)/gi;

const textOf = (signal: Signal) => `${signal.title}. ${signal.body}`;

function classify(signal: Signal): (typeof KIND_RULES)[number] | undefined {
  const text = textOf(signal);
  return KIND_RULES.find((rule) => rule.pattern.test(text));
}

/** People mentioned in a signal: structured data first, then counted from the text. */
export function countPeople(signal: Signal): number | undefined {
  const detected = signal.data?.peopleDetected;
  if (typeof detected === 'number') return detected;
  let total = 0;
  for (const match of textOf(signal).matchAll(PEOPLE)) {
    total += NUMBER_WORDS[match[1]!.toLowerCase()] ?? Number(match[1]);
  }
  return total > 0 ? total : undefined;
}

interface Cluster {
  rule: (typeof KIND_RULES)[number];
  signals: Signal[];
  center: LngLat;
}

const RED_FLAGS_IMMEDIATE =
  /not breathing|unconscious|unresponsive|cardiac arrest|no pulse|drowning|choking/i;
const RED_FLAGS_EMERGENT =
  /chest pain|heart attack|stroke|short of breath|difficulty breathing|severe bleeding|seizure|crushing|overdose/i;
const MINOR = /sprain|minor|small cut|bruise|twisted/i;

export class NullIntel implements IntelPort {
  /** Groups signals that describe the same event and proposes one incident per group. */
  fuseSync(signals: Signal[], ctx: IntelContext): IncidentCandidate[] {
    const clusters: Cluster[] = [];
    for (const signal of signals) {
      if (!signal.position || !EVENT_SOURCES.has(signal.source)) continue;
      const rule = classify(signal);
      if (!rule) continue;
      const cluster = clusters.find(
        (candidate) =>
          candidate.rule.kind === rule.kind &&
          distanceM(candidate.center, signal.position!) <= CLUSTER_RADIUS_M &&
          Math.abs(candidate.signals[0]!.simTime - signal.simTime) <= CLUSTER_WINDOW_SEC,
      );
      if (cluster) cluster.signals.push(signal);
      else clusters.push({ rule, signals: [signal], center: signal.position });
    }

    return clusters.map(({ rule, signals: members }) => {
      // Position: the reliability-weighted centre of the reports.
      const weight = members.reduce((sum, s) => sum + s.reliability, 0) || 1;
      const position: LngLat = [
        members.reduce((sum, s) => sum + s.position![0] * s.reliability, 0) / weight,
        members.reduce((sum, s) => sum + s.position![1] * s.reliability, 0) / weight,
      ];
      // Confidence: independent reports each remove some of the remaining doubt.
      const doubt = members.reduce((left, s) => left * (1 - 0.8 * s.reliability), 1);
      const people = members
        .map(countPeople)
        .reduce<number | undefined>(
          (max, n) => (n === undefined ? max : Math.max(max ?? 0, n)),
          undefined,
        );
      const vulnerable = members.some((s) => VULNERABLE.test(textOf(s)));
      const severity = Math.min(
        5,
        rule.severity + (vulnerable || (people ?? 0) >= 3 ? 1 : 0),
      ) as Severity;

      const existing = ctx.incidents.find(
        (incident) =>
          incident.kind === rule.kind &&
          incident.status !== 'resolved' &&
          incident.status !== 'closed' &&
          distanceM(incident.position, position) <= CLUSTER_RADIUS_M,
      );
      const sources = [...new Set(members.map((s) => s.source.replace('_', ' ')))].join(', ');
      return {
        kind: rule.kind,
        title: rule.title,
        position,
        severity,
        confidence: Math.round((1 - doubt) * 100) / 100,
        ...(people === undefined ? {} : { peopleAffected: people }),
        summary: `${members.length} ${members.length === 1 ? 'report' : 'reports'} (${sources}) describe the same event${
          people ? `, about ${people} people involved` : ''
        }.`,
        sourceSignalIds: members.map((s) => s.id),
        requiredCapabilities: DEFAULT_CAPABILITIES[rule.kind],
        ...(existing ? { mergeWithIncidentId: existing.id } : {}),
      };
    });
  }

  /** A conservative keyword triage. Red-flag terms always win. */
  triageSync(call: Signal): TriageResult {
    const text = textOf(call);
    const firstSentence = call.body.split(/(?<=[.!?])\s/)[0]!.slice(0, 140);
    if (RED_FLAGS_IMMEDIATE.test(text)) {
      return {
        acuity: 1,
        category: 'Immediate life threat',
        chiefComplaint: firstSentence,
        recommendedUnit: 'als_ambulance',
        rationale: 'The caller describes an immediately life-threatening condition.',
      };
    }
    if (RED_FLAGS_EMERGENT.test(text)) {
      return {
        acuity: 2,
        category: 'Emergent',
        chiefComplaint: firstSentence,
        recommendedUnit: 'als_ambulance',
        rationale: 'The caller describes symptoms that need advanced life support quickly.',
      };
    }
    if (MINOR.test(text)) {
      return {
        acuity: 4,
        category: 'Less urgent',
        chiefComplaint: firstSentence,
        recommendedUnit: 'bls_ambulance',
        rationale: 'The caller describes a minor injury with no red-flag symptoms.',
      };
    }
    return {
      acuity: 3,
      category: 'Urgent',
      chiefComplaint: firstSentence,
      recommendedUnit: 'bls_ambulance',
      rationale: 'No red-flag symptoms were described; a basic life support unit is appropriate.',
    };
  }

  fuse(signals: Signal[], ctx: IntelContext): Promise<IncidentCandidate[]> {
    return Promise.resolve(this.fuseSync(signals, ctx));
  }

  triage(call: Signal): Promise<TriageResult> {
    return Promise.resolve(this.triageSync(call));
  }

  explain(action: Action): Promise<string> {
    const factors = action.explain.factors.map((f) => `${f.label}: ${f.value}`).join('; ');
    return Promise.resolve(
      factors ? `${action.explain.headline}. ${factors}.` : action.explain.headline,
    );
  }

  narrateRestoration(analysis: RestorationAnalysis): Promise<Record<string, string>> {
    return Promise.resolve(
      Object.fromEntries(analysis.options.map((option) => [option.id, option.rationale])),
    );
  }
}

/** Intel implementations that can also answer synchronously, which keeps a run reproducible. */
export interface SyncIntel {
  fuseSync(signals: Signal[], ctx: IntelContext): IncidentCandidate[];
  triageSync(call: Signal, ctx: IntelContext): TriageResult;
}

export function isSyncIntel(intel: IntelPort): intel is IntelPort & SyncIntel {
  return (
    typeof (intel as Partial<SyncIntel>).fuseSync === 'function' &&
    typeof (intel as Partial<SyncIntel>).triageSync === 'function'
  );
}
