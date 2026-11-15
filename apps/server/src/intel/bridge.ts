import type { IntelContext, IntelPort, Signal } from '@bastion/shared';
import { INTEL_TIMEOUT_MS } from '@bastion/shared';
import { applyCandidates, attachTriage } from '../incidents/manager';
import type { OperationRuntime, SystemFactory } from '../sim/runtime';
import { isSyncIntel, NullIntel } from './NullIntel';

/**
 * Sim seconds between a signal arriving and its fusion result taking effect. A fixed delay keeps
 * runs reproducible (the result lands on the same step whether the model answered in 2 ms or
 * 900 ms) and reads well on screen: the reports appear, then the incident forms.
 */
export const INTEL_LATENCY_SEC = 2;

export function buildIntelContext(rt: OperationRuntime): IntelContext {
  return {
    operation: rt.operation,
    clock: rt.world.clock,
    region: rt.index.region.config,
    incidents: Object.values(rt.world.incidents),
    hazards: [...rt.world.hazards],
    metrics: rt.world.metrics,
  };
}

/** Resolves with `promise`, or with `fallback()` if it is slow or rejects. Never rejects. */
function guarded<T>(promise: Promise<T>, fallback: () => T, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback()), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback());
      },
    );
  });
}

/**
 * The intel stage of the pipeline: sends new signals to fusion (and 911 calls to triage) without
 * ever waiting inside the step, and applies each result once its fixed delay has passed.
 */
export function createIntelSystem(
  intel: IntelPort,
  options: { timeoutMs?: number } = {},
): SystemFactory {
  const fallback = new NullIntel();
  const timeoutMs = options.timeoutMs ?? INTEL_TIMEOUT_MS;

  return () => {
    /** Results waiting for their time, in the order the requests were made. */
    const ready: { at: number; order: number; apply: () => void }[] = [];
    let order = 0;
    const schedule = (at: number, apply: () => void) => ready.push({ at, order: order++, apply });

    const request = (signals: Signal[], runtime: OperationRuntime) => {
      const ctx = buildIntelContext(runtime);
      const at = runtime.simTime + INTEL_LATENCY_SEC;
      const calls = signals.filter((signal) => signal.source === 'call_911');

      if (isSyncIntel(intel)) {
        const candidates = intel.fuseSync(signals, ctx);
        schedule(at, () => applyCandidates(runtime, candidates));
        for (const call of calls) {
          const triage = intel.triageSync(call, ctx);
          schedule(at, () => attachTriage(runtime, call.id, triage));
        }
        return;
      }

      // Reserve the order now so results apply in request order however late they arrive.
      const fuseSlot = order++;
      runtime.track(
        guarded(intel.fuse(signals, ctx), () => fallback.fuseSync(signals, ctx), timeoutMs).then(
          (candidates) => {
            ready.push({ at, order: fuseSlot, apply: () => applyCandidates(runtime, candidates) });
          },
        ),
      );
      for (const call of calls) {
        const slot = order++;
        runtime.track(
          guarded(intel.triage(call, ctx), () => fallback.triageSync(call), timeoutMs).then(
            (triage) => {
              ready.push({ at, order: slot, apply: () => attachTriage(runtime, call.id, triage) });
            },
          ),
        );
      }
    };

    return {
      name: 'intel',
      update(runtime) {
        if (runtime.newSignals.length > 0) request([...runtime.newSignals], runtime);

        if (ready.length === 0) return;
        const due = ready.filter((item) => item.at <= runtime.simTime);
        if (due.length === 0) return;
        due.sort((a, b) => a.at - b.at || a.order - b.order);
        for (const item of due) {
          ready.splice(ready.indexOf(item), 1);
          item.apply();
        }
      },
    };
  };
}
