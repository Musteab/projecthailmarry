import { createStore } from 'zustand/vanilla';
import { applyWorldPatch, makeEmptyWorld } from '@bastion/shared';
import type { ScenarioBeat, ServerMessage, WorldSnapshot } from '@bastion/shared';
import { anchorClock } from '../helpers';
import type { Connection } from '../transport';

export const emptyWorld = () =>
  makeEmptyWorld({
    id: '',
    regionId: '',
    scenarioId: null,
    mode: 'exercise',
    name: '',
    status: 'ready',
    createdBy: '',
    createdAt: '',
  });

export function createWorldStore() {
  const store = createStore<{
    world: WorldSnapshot;
    beat: ScenarioBeat | null;
    connection: Connection;
    error?: Error;
  }>()(() => ({ world: emptyWorld(), beat: null, connection: 'idle' }));
  const listeners = new Set<(beat: ScenarioBeat) => void>();
  return Object.assign(store, {
    receive(message: ServerMessage, nowMs = Date.now()) {
      if (message.t === 'error') {
        store.setState({ error: new Error(message.message) });
        return;
      }
      if (message.t === 'beat') {
        store.setState({ beat: message.beat });
        for (const callback of listeners) callback(message.beat);
        return;
      }
      if (message.t === 'snapshot') {
        store.setState({
          world: { ...message.world, clock: anchorClock(message.world.clock, nowMs) },
          beat: null,
          error: undefined,
        });
      } else {
        store.setState(({ world }) => ({
          world: applyWorldPatch(world, message.patch, anchorClock(message.clock, nowMs)),
        }));
      }
    },
    onBeat(callback: (beat: ScenarioBeat) => void) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    reset() {
      store.setState({ world: emptyWorld(), beat: null, error: undefined, connection: 'idle' });
    },
  });
}
