import type { Incident, IncidentCandidate, Severity, TriageResult } from '@bastion/shared';
import { distanceM } from '../geo';
import type { OperationRuntime } from '../sim/runtime';

/** An incident is confirmed at this confidence, or when two different kinds of source agree. */
export const CONFIRM_CONFIDENCE = 0.7;
const MERGE_RADIUS_M = 200;

const isOpen = (incident: Incident) =>
  incident.status !== 'resolved' && incident.status !== 'closed';

function distinctSources(rt: OperationRuntime, signalIds: string[]): number {
  const wanted = new Set(signalIds);
  const sources = new Set<string>();
  for (const signal of rt.world.signals) if (wanted.has(signal.id)) sources.add(signal.source);
  return sources.size;
}

function insideRegion(rt: OperationRuntime, [lng, lat]: [number, number]): boolean {
  const [west, south, east, north] = rt.index.region.config.bbox;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/**
 * Turns fusion results into incidents: merges a candidate into the open incident it describes,
 * or opens a new one, and confirms it once the evidence is strong enough. Candidates that point
 * outside the region or cite signals that do not exist are dropped.
 */
export function applyCandidates(rt: OperationRuntime, candidates: IncidentCandidate[]): void {
  const known = new Set(rt.world.signals.map((signal) => signal.id));

  for (const candidate of candidates) {
    const signalIds = candidate.sourceSignalIds.filter((id) => known.has(id));
    if (signalIds.length === 0 || !insideRegion(rt, candidate.position)) continue;

    const open = Object.values(rt.world.incidents).filter(isOpen);
    const existing =
      open.find((incident) => incident.id === candidate.mergeWithIncidentId) ??
      open.find(
        (incident) =>
          incident.kind === candidate.kind &&
          distanceM(incident.position, candidate.position) <= MERGE_RADIUS_M,
      );

    if (existing) {
      const sourceSignalIds = [...new Set([...existing.sourceSignalIds, ...signalIds])];
      if (sourceSignalIds.length === existing.sourceSignalIds.length) continue; // nothing new
      // Each independent report removes part of the remaining doubt.
      const confidence =
        Math.round((1 - (1 - existing.confidence) * (1 - candidate.confidence)) * 100) / 100;
      const confirmed =
        confidence >= CONFIRM_CONFIDENCE || distinctSources(rt, sourceSignalIds) >= 2;
      const becameConfirmed = existing.status === 'suspected' && confirmed;
      const people = Math.max(existing.peopleAffected ?? 0, candidate.peopleAffected ?? 0);
      const updated: Incident = {
        ...existing,
        severity: Math.max(existing.severity, candidate.severity) as Severity,
        confidence,
        sourceSignalIds,
        aiSummary: candidate.summary,
        status: becameConfirmed ? 'confirmed' : existing.status,
        ...(people > 0 ? { peopleAffected: people } : {}),
      };
      rt.world.setIncident(updated);
      rt.event({
        kind: becameConfirmed ? 'incident.confirmed' : 'incident.updated',
        severity: becameConfirmed && updated.severity >= 4 ? 'critical' : 'info',
        title: becameConfirmed
          ? `Confirmed: ${updated.title}`
          : `${updated.title}: ${sourceSignalIds.length} corroborating reports`,
        detail: candidate.summary,
        position: updated.position,
        refs: { incidentId: updated.id },
      });
      continue;
    }

    const confirmed =
      candidate.confidence >= CONFIRM_CONFIDENCE || distinctSources(rt, signalIds) >= 2;
    const incident: Incident = {
      id: rt.world.nextId('inc'),
      kind: candidate.kind,
      title: candidate.title,
      position: candidate.position,
      cellId: rt.index.nearestCellId(candidate.position),
      severity: candidate.severity,
      status: confirmed ? 'confirmed' : 'suspected',
      confidence: candidate.confidence,
      ...(candidate.peopleAffected === undefined
        ? {}
        : { peopleAffected: candidate.peopleAffected }),
      aiSummary: candidate.summary,
      sourceSignalIds: signalIds,
      requiredCapabilities: candidate.requiredCapabilities,
      assignedUnitIds: [],
      openedAt: rt.simTime,
    };
    rt.world.setIncident(incident);
    rt.event({
      kind: 'incident.opened',
      severity: incident.severity >= 4 ? 'critical' : 'warn',
      title: confirmed ? incident.title : `Unconfirmed: ${incident.title}`,
      detail: candidate.summary,
      position: incident.position,
      refs: { incidentId: incident.id },
    });
  }
}

/** Attaches a 911 triage result to the medical incident raised from that call. */
export function attachTriage(rt: OperationRuntime, signalId: string, triage: TriageResult): void {
  const incident = Object.values(rt.world.incidents).find(
    (candidate) => candidate.kind === 'medical' && candidate.sourceSignalIds.includes(signalId),
  );
  if (!incident || !isOpen(incident)) return;
  // Acuity 1 is the most urgent, severity 5 the most severe.
  const severity = Math.max(incident.severity, 6 - triage.acuity) as Severity;
  rt.world.setIncident({
    ...incident,
    triage,
    severity,
    requiredCapabilities: [triage.recommendedUnit],
  });
  rt.event({
    kind: 'incident.triaged',
    severity: triage.acuity <= 2 ? 'critical' : 'info',
    title: `Triage: acuity ${triage.acuity}, ${triage.category.toLowerCase()}`,
    detail: triage.rationale,
    position: incident.position,
    refs: { incidentId: incident.id },
  });
}
