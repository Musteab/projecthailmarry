import type { HazardPhase, TimelineEvent } from '@bastion/shared';
import type { SystemFactory } from './runtime';

const PHASE_SEVERITY: Record<HazardPhase, TimelineEvent['severity']> = {
  forecast: 'warn',
  active: 'critical',
  receding: 'info',
  ended: 'info',
};

/**
 * Plays the scenario's screenplay: fires every timeline event and beat whose time has come,
 * in the order they were written.
 */
export const scenarioRunner: SystemFactory = (rt) => {
  // Stable sort: events sharing a time keep their order in the file.
  const events = (rt.scenario?.timeline ?? [])
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.at - b.event.at || a.order - b.order)
    .map(({ event }) => event);
  const beats = [...(rt.scenario?.beats ?? [])].sort((a, b) => a.simTime - b.simTime);
  let nextEvent = 0;
  let nextBeat = 0;

  return {
    name: 'scenario',
    update(runtime) {
      while (nextEvent < events.length && events[nextEvent]!.at <= runtime.simTime) {
        const event = events[nextEvent++]!;
        switch (event.type) {
          case 'signal':
            runtime.ingestSignal(event.signal);
            break;
          case 'inject':
            runtime.applyInject(event.inject);
            break;
          case 'hazard_phase': {
            const hazard = runtime.world.hazards.find(({ id }) => id === event.hazardId);
            if (!hazard) throw new Error(`Scenario refers to unknown hazard "${event.hazardId}"`);
            runtime.world.setHazards(
              runtime.world.hazards.map((item) =>
                item.id === event.hazardId ? { ...item, phase: event.phase } : item,
              ),
            );
            runtime.event({
              kind: 'hazard.phase',
              severity: PHASE_SEVERITY[event.phase],
              title: `${hazard.label}: ${event.phase}`,
            });
            break;
          }
        }
      }
      while (nextBeat < beats.length && beats[nextBeat]!.simTime <= runtime.simTime) {
        runtime.emitBeat(beats[nextBeat++]!);
      }
    },
  };
};
