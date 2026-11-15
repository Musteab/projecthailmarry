import type { GridSection } from '@bastion/shared';
import type { OperationRuntime, System } from '../sim/runtime';

/** Used when the utility has no rule on file. */
const DEFAULTS = { floodDepthM: 0.5, shakeMMI: 8, leadTimeMin: 5, clearForMin: 10 };
const BACKUP_FUEL_MIN = { hospital: 240, other: 120 };
/** A section is flagged as threatened once the water reaches this share of the trip depth. */
const THREAT_SHARE = 0.5;
/** The platform switches when the trip depth is this close, so it acts before the water does. */
const ACT_WITHIN_SEC = 15;
/** How long a window the rise rate is measured over. */
const TREND_WINDOW_SEC = 10;
/** Forecasts need at least this share of the trip depth, so a first puddle does not count. */
const FORECAST_SHARE = 0.25;

const minutes = (seconds: number) =>
  seconds === Infinity ? 'not rising' : `${Math.max(1, Math.round(seconds / 60))} min`;

/**
 * The distribution grid as a tree of sections per feeder. Watches the hazard at each section's
 * equipment, proposes isolation under the utility's rule, and works out the consequences:
 * everything downstream of an open section is dark, and critical facilities on a dark section
 * fall back to their generators until the fuel runs out.
 */
export class GridService {
  private readonly sections: GridSection[];
  private readonly children = new Map<string, string[]>();
  /** Sections opened on purpose (by an isolate action), as opposed to dark because upstream is. */
  private readonly opened = new Set<string>();
  /** Facilities this service put on backup, so it can put them back. */
  private readonly onBackup = new Set<string>();
  /** Depth sampled every few seconds, to measure how fast the water is rising. */
  private readonly trend = new Map<string, { at: number; depth: number; risePerSec: number }>();
  private readonly clearSince = new Map<string, number>();

  constructor(private readonly rt: OperationRuntime) {
    // Parents before children, so one pass settles the whole tree.
    const byId = rt.index.sectionById;
    const depthOf = (section: GridSection): number =>
      section.upstreamSectionId ? 1 + depthOf(byId.get(section.upstreamSectionId)!) : 0;
    this.sections = [...rt.index.region.grid.sections].sort((a, b) => depthOf(a) - depthOf(b));
    for (const section of this.sections) {
      if (!section.upstreamSectionId) continue;
      const siblings = this.children.get(section.upstreamSectionId) ?? [];
      siblings.push(section.id);
      this.children.set(section.upstreamSectionId, siblings);
    }
  }

  private params() {
    const isolate = this.rt.actions.ruleFor('isolate_grid_section', 'utility')?.params ?? {};
    const restore = this.rt.actions.ruleFor('restore_grid_section', 'utility')?.params ?? {};
    const num = (value: unknown, fallback: number) =>
      typeof value === 'number' ? value : fallback;
    return {
      floodDepthM: num(isolate.floodDepthM, DEFAULTS.floodDepthM),
      shakeMMI: num(isolate.shakeMMI, DEFAULTS.shakeMMI),
      leadTimeSec: num(isolate.leadTimeMin, DEFAULTS.leadTimeMin) * 60,
      clearForSec: num(restore.clearForMin, DEFAULTS.clearForMin) * 60,
    };
  }

  /** Deepest water and strongest shaking anywhere along the section. */
  private hazardAt(section: GridSection): { depth: number; mmi: number } {
    let depth = 0;
    let mmi = 0;
    for (const cellId of section.cellIds) {
      const cell = this.rt.world.cells[cellId];
      if (!cell) continue;
      depth = Math.max(depth, cell.floodDepthM ?? 0);
      mmi = Math.max(mmi, cell.shakeMMI ?? 0);
    }
    return { depth, mmi };
  }

  private downstream(sectionId: string): GridSection[] {
    const found: GridSection[] = [];
    const visit = (id: string) => {
      for (const child of this.children.get(id) ?? []) {
        found.push(this.rt.index.sectionById.get(child)!);
        visit(child);
      }
    };
    visit(sectionId);
    return found;
  }

  /**
   * Settles the tree after any change: a section is live only if it is closed and everything
   * upstream of it is live. Then moves critical facilities between grid and backup power.
   */
  private settle(): void {
    const { world, index } = this.rt;
    const live = new Set<string>();

    for (const section of this.sections) {
      const state = world.gridSections[section.id]!;
      const fed = !section.upstreamSectionId || live.has(section.upstreamSectionId);
      const closed = state.status !== 'faulted' && !this.opened.has(section.id);
      if (fed && closed) {
        live.add(section.id);
        if (state.status !== 'energized' || state.customersOut !== 0) {
          world.setGridSection(section.id, { ...state, status: 'energized', customersOut: 0 });
        }
      } else if (state.status === 'energized' || state.customersOut !== section.customers) {
        world.setGridSection(section.id, {
          status: state.status === 'faulted' ? 'faulted' : 'isolated',
          threatened: false,
          customersOut: section.customers,
        });
      }
    }

    for (const section of this.sections) {
      for (const facilityId of section.criticalFacilityIds) {
        const facility = index.facilityById.get(facilityId);
        const state = world.facilities[facilityId];
        if (!facility || !state) continue;
        const hasPower = live.has(section.id);
        if (!hasPower && state.power === 'grid') {
          const fuel =
            facility.kind === 'hospital' ? BACKUP_FUEL_MIN.hospital : BACKUP_FUEL_MIN.other;
          this.onBackup.add(facilityId);
          world.setFacility(facilityId, {
            ...state,
            power: 'backup',
            backupFuelMin: fuel,
            status: state.status === 'offline' ? 'offline' : 'degraded',
          });
          this.rt.event({
            kind: 'facility.power_loss',
            severity: facility.kind === 'hospital' ? 'critical' : 'warn',
            title: `${facility.name} is on backup power`,
            detail: `Its feeder section is de-energized. About ${fuel} minutes of fuel.`,
            position: facility.position,
            refs: { facilityId, sectionId: section.id },
          });
        } else if (hasPower && this.onBackup.has(facilityId) && state.power !== 'grid') {
          this.onBackup.delete(facilityId);
          const { backupFuelMin: _fuel, ...rest } = state;
          world.setFacility(facilityId, { ...rest, power: 'grid', status: 'normal' });
        }
      }
    }
  }

  /** Executor of `isolate_grid_section`. Returns a failure reason, or null on success. */
  isolate(sectionId: string): string | null {
    const state = this.rt.world.gridSections[sectionId];
    if (!state || !this.rt.index.sectionById.has(sectionId)) return 'Unknown grid section';
    if (state.status !== 'energized') return `The section is already ${state.status}`;
    this.opened.add(sectionId);
    this.clearSince.delete(sectionId);
    this.settle();
    return null;
  }

  /** Executor of `restore_grid_section`. */
  restore(sectionId: string): string | null {
    const section = this.rt.index.sectionById.get(sectionId);
    const state = this.rt.world.gridSections[sectionId];
    if (!section || !state) return 'Unknown grid section';
    if (state.status === 'faulted') return 'The section is faulted and needs repair first';
    if (!this.opened.has(sectionId)) return 'The section was not isolated by a switching action';
    this.opened.delete(sectionId);
    this.settle();
    return null;
  }

  system(): System {
    return {
      name: 'grid',
      update: (rt) => {
        const { world } = rt;
        const rule = this.params();
        this.settle(); // picks up faults injected since the last step

        // Generators burn fuel; a facility with none left goes offline.
        if (rt.simTime % 60 === 0) {
          for (const [facilityId, state] of Object.entries(world.facilities)) {
            if (state.power !== 'backup' || state.backupFuelMin === undefined) continue;
            const left = state.backupFuelMin - 1;
            if (left > 0) {
              world.setFacility(facilityId, { ...state, backupFuelMin: left });
              continue;
            }
            const { backupFuelMin: _fuel, ...rest } = state;
            world.setFacility(facilityId, { ...rest, power: 'none', status: 'offline' });
            const facility = rt.index.facilityById.get(facilityId);
            rt.event({
              kind: 'facility.offline',
              severity: 'critical',
              title: `${facility?.name ?? facilityId} has run out of generator fuel`,
              ...(facility ? { position: facility.position } : {}),
              refs: { facilityId },
            });
          }
        }

        for (const section of this.sections) {
          const state = world.gridSections[section.id]!;
          const { depth, mmi } = this.hazardAt(section);
          // Reported depths move in small jumps, so the rate is measured over a window.
          let trend = this.trend.get(section.id);
          if (!trend) {
            trend = { at: rt.simTime, depth, risePerSec: 0 };
            this.trend.set(section.id, trend);
          } else if (rt.simTime - trend.at >= TREND_WINDOW_SEC) {
            trend.risePerSec = (depth - trend.depth) / (rt.simTime - trend.at);
            trend.at = rt.simTime;
            trend.depth = depth;
          }

          if (state.status === 'energized') {
            const { risePerSec } = trend;
            const secondsToTrip =
              depth >= rule.floodDepthM
                ? 0
                : risePerSec > 0
                  ? (rule.floodDepthM - depth) / risePerSec
                  : Infinity;
            const shaking = mmi >= rule.shakeMMI;
            const forecast =
              depth >= rule.floodDepthM * FORECAST_SHARE && secondsToTrip <= rule.leadTimeSec;
            const threatened = shaking || forecast || depth >= rule.floodDepthM * THREAT_SHARE;
            if (threatened !== state.threatened) {
              world.setGridSection(section.id, { ...state, threatened });
            }
            // Within the lead time a section is only flagged. It is switched when the water
            // has reached the trip depth or is seconds away from it.
            const imminent =
              depth >= rule.floodDepthM * FORECAST_SHARE && secondsToTrip <= ACT_WITHIN_SEC;
            if (!(shaking || imminent || depth >= rule.floodDepthM)) continue;

            const affected = [section, ...this.downstream(section.id)];
            const customers = affected.reduce((sum, s) => sum + s.customers, 0);
            const critical = affected
              .flatMap((s) => s.criticalFacilityIds)
              .map((id) => rt.index.facilityById.get(id)?.name)
              .filter((name): name is string => Boolean(name));
            rt.actions.propose({
              kind: 'isolate_grid_section',
              payload: { kind: 'isolate_grid_section', sectionId: section.id },
              key: `isolate:${section.id}`,
              explain: {
                headline: shaking
                  ? `Isolate ${section.feederId} section ${section.id}: severe shaking (MMI ${mmi.toFixed(1)})`
                  : `Isolate ${section.feederId} section ${section.id}: water at equipment ${depth.toFixed(2)} m`,
                factors: [
                  {
                    label: 'Water at equipment',
                    value: `${depth.toFixed(2)} m (trips at ${rule.floodDepthM} m)`,
                  },
                  { label: 'Time to trip depth', value: minutes(secondsToTrip) },
                  { label: 'Customers de-energized', value: String(customers) },
                  {
                    label: 'Critical facilities affected',
                    value:
                      critical.length > 0
                        ? `${critical.join(', ')} (switch to backup power)`
                        : 'none',
                  },
                ],
                alternatives: [
                  {
                    label: 'Leave energized',
                    score: 0.1,
                    rejectedBecause: shaking
                      ? 'Damaged equipment could be live and start fires'
                      : 'Equipment would be submerged while live',
                  },
                ],
                confidence: shaking || depth >= rule.floodDepthM ? 0.95 : 0.75,
              },
            });
            continue;
          }

          // Opened on purpose: offer to restore once the threat has stayed away long enough.
          if (!this.opened.has(section.id)) continue;
          const clear = depth < rule.floodDepthM * FORECAST_SHARE && mmi < rule.shakeMMI;
          if (!clear) {
            this.clearSince.delete(section.id);
            continue;
          }
          const since = this.clearSince.get(section.id) ?? rt.simTime;
          this.clearSince.set(section.id, since);
          if (rt.simTime - since < rule.clearForSec) continue;
          rt.actions.propose({
            kind: 'restore_grid_section',
            payload: { kind: 'restore_grid_section', sectionId: section.id },
            key: `restore:${section.id}`,
            explain: {
              headline: `Re-energize ${section.feederId} section ${section.id}: the threat has cleared`,
              factors: [
                { label: 'Water at equipment', value: `${depth.toFixed(2)} m` },
                { label: 'Clear for', value: minutes(rt.simTime - since) },
                { label: 'Customers restored', value: String(section.customers) },
              ],
              alternatives: [],
              confidence: 0.8,
            },
          });
        }
      },
    };
  }
}
