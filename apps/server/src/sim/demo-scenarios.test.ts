import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, Rule, Scenario } from '@bastion/shared';
import { WorldSnapshotSchema } from '@bastion/shared';
import { describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../config';
import { DEFAULT_RULES } from '../db/seed';
import type { RegionIndex } from '../region/index';
import { RegionRegistry } from '../region/pack';
import { ScenarioCatalog } from '../scenarios/catalog';
import { OperationRuntime } from './runtime';
import { defaultSystems } from './systems';

/**
 * The two stage-demo scenarios, played headless on the real region pack with the rule-based
 * intel. These tests guard the demo itself: that it plays, that it plays the same way every
 * time, and that the beats of the story happen. They assert the story, not exact numbers, so
 * the scenario files can keep being tuned.
 *
 * Skipped when the region pack or a scenario file is not in the repository.
 */
// A full scenario is 900 to 1500 sim steps on a 14,000-node network: seconds, not milliseconds.
vi.setConfig({ testTimeout: 120_000 });

const DATA = join(REPO_ROOT, 'data');
const FLOOD = 'flash-flood-johnson-creek';
const QUAKE = 'earthquake-portland-hills';
const available =
  existsSync(join(DATA, 'regions', 'portland', 'region.json')) &&
  existsSync(join(DATA, 'scenarios', `${FLOOD}.json`)) &&
  existsSync(join(DATA, 'scenarios', `${QUAKE}.json`));

const RULES: Rule[] = DEFAULT_RULES.map((rule) => ({
  ...rule,
  updatedAt: '2026-11-15T00:00:00.000Z',
}));
/** Wall-clock milliseconds one sim step may take, so a 60x run still fits its tick. */
const STEP_BUDGET_MS = 50;

interface Played {
  scenario: Scenario;
  rt: OperationRuntime;
  stepMs: number[];
  largestPatchBytes: number;
  peak: { atRisk: number; roadsClosed: number; customersOut: number; wetCells: number };
}

describe.runIf(available)('stage demo scenarios on the Portland pack', () => {
  const catalog = new ScenarioCatalog(join(DATA, 'scenarios'), false);
  const regions = new RegionRegistry(join(DATA, 'regions'), false);
  let portland: RegionIndex;
  const cache = new Map<string, Played>();

  function play(id: string): Played {
    const scenario = catalog.get(id)!;
    portland ??= regions.index(scenario.regionId)!;
    const rt = new OperationRuntime({
      operation: {
        id: `op-${id}`,
        regionId: scenario.regionId,
        scenarioId: id,
        mode: 'exercise',
        name: scenario.name,
        status: 'running',
        createdBy: 'user-operator',
        createdAt: '2026-11-15T12:00:00.000Z',
      },
      index: portland,
      scenario,
      systems: defaultSystems(),
    });
    rt.actions.setRules(RULES);

    const played: Played = {
      scenario,
      rt,
      stepMs: [],
      largestPatchBytes: 0,
      peak: { atRisk: 0, roadsClosed: 0, customersOut: 0, wetCells: 0 },
    };
    while (!rt.finished) {
      const started = performance.now();
      rt.step();
      played.stepMs.push(performance.now() - started);
      played.largestPatchBytes = Math.max(
        played.largestPatchBytes,
        JSON.stringify(rt.world.drainPatch()).length,
      );
      const { metrics } = rt.world;
      played.peak.atRisk = Math.max(played.peak.atRisk, metrics.peopleAtRisk);
      played.peak.roadsClosed = Math.max(played.peak.roadsClosed, metrics.roadsClosed);
      played.peak.customersOut = Math.max(played.peak.customersOut, metrics.customersOut);
      if (rt.simTime % 30 === 0) {
        played.peak.wetCells = Math.max(
          played.peak.wetCells,
          Object.values(rt.world.cells).filter((cell) => cell.floodDepthM).length,
        );
      }
    }
    return played;
  }
  const once = (id: string) => cache.get(id) ?? cache.set(id, play(id)).get(id)!;
  const actions = (played: Played, kind: Action['kind'], status: Action['status'] = 'executed') =>
    Object.values(played.rt.world.actions).filter((a) => a.kind === kind && a.status === status);
  const events = (played: Played, kind: string) =>
    played.rt.world.timeline.filter((event) => event.kind === kind);

  it('both scenario files load cleanly and target the region pack', () => {
    expect(catalog.problems).toEqual([]);
    const ids = catalog.summaries().map((summary) => summary.id);
    expect(ids).toEqual(expect.arrayContaining([FLOOD, QUAKE]));
    for (const id of [FLOOD, QUAKE]) expect(catalog.get(id)!.regionId).toBe('portland');
  });

  it('an undamaged Portland reports nobody cut off', () => {
    once(FLOOD);
    const rt = new OperationRuntime({
      operation: {
        id: 'op-calm',
        regionId: 'portland',
        scenarioId: null,
        mode: 'exercise',
        name: 'calm',
        status: 'running',
        createdBy: 'u',
        createdAt: '2026-11-15T12:00:00.000Z',
      },
      index: portland,
      scenario: null,
      systems: defaultSystems(),
    });
    rt.actions.setRules(RULES);
    expect(rt.restoration.analyze().baseline).toEqual({
      isolatedPop: 0,
      noHospitalAccessPop: 0,
      noShelterAccessPop: 0,
    });
  });

  describe.each([FLOOD, QUAKE])('%s', (id) => {
    it('plays to the end without a subsystem fault and stays a valid snapshot', () => {
      const played = once(id);
      expect(played.rt.simTime).toBe(played.scenario.durationSimSec);
      expect(events(played, 'engine.error')).toEqual([]);
      expect(() => WorldSnapshotSchema.parse(played.rt.world.toSnapshot())).not.toThrow();
    });

    it('plays identically every time', () => {
      const first = JSON.stringify(once(id).rt.world.toSnapshot());
      expect(JSON.stringify(play(id).rt.world.toSnapshot())).toBe(first);
    });

    it('stays inside the step and patch budgets', () => {
      const played = once(id);
      const sorted = [...played.stepMs].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
      expect(p95).toBeLessThan(STEP_BUDGET_MS);
      expect(played.largestPatchBytes).toBeLessThan(256 * 1024);
    });

    it('ends with a recommended repair that gives people their access back', () => {
      const { restoration } = once(id).rt.world;
      expect(restoration).not.toBeNull();
      const top = restoration!.options.find(
        (option) => option.id === restoration!.recommendedOptionId,
      )!;
      expect(top).toBeDefined();
      expect(top.impact.hospitalAccessPop + top.impact.isolatedPopReconnected).toBeGreaterThan(0);
      expect(top.rationale.length).toBeGreaterThan(20);
    });
  });

  it('flood: water rises, a fused rescue is dispatched and resolved, the grid is isolated', () => {
    const played = once(FLOOD);
    const { world } = played.rt;
    expect(played.peak.wetCells).toBeGreaterThan(50);
    expect(played.peak.atRisk).toBeGreaterThan(0);
    expect(played.peak.roadsClosed).toBeGreaterThan(5);

    // Several signals became one water rescue, and a swift-water crew dealt with it.
    const rescues = Object.values(world.incidents).filter((i) => i.kind === 'water_rescue');
    expect(rescues).toHaveLength(1);
    expect(rescues[0]!.sourceSignalIds.length).toBeGreaterThanOrEqual(2);
    expect(['resolved', 'closed']).toContain(rescues[0]!.status);
    const dispatch = actions(played, 'dispatch_unit').find(
      (a) => (a.payload as { incidentId: string }).incidentId === rescues[0]!.id,
    )!;
    expect(dispatch).toMatchObject({ decidedBy: 'auto', authority: 'fire_rescue' });
    expect(dispatch.explain.alternatives.length).toBeGreaterThan(0);
    // The crew works through flooded streets instead of being cut off by them.
    expect(events(played, 'unit.route_failed')).toEqual([]);

    // The medical call was triaged and an ambulance sent to a hospital.
    const medical = Object.values(world.incidents).find((i) => i.kind === 'medical')!;
    expect(medical.triage).toBeDefined();
    const ambulance = actions(played, 'assign_ambulance')[0]!;
    expect((ambulance.payload as { hospitalId?: string }).hospitalId).toBeDefined();

    // The utility isolated at least one section under its own rule.
    const isolations = actions(played, 'isolate_grid_section');
    expect(isolations.length).toBeGreaterThan(0);
    expect(isolations.every((a) => a.authority === 'utility' && a.decidedBy === 'auto')).toBe(true);
    expect(played.peak.customersOut).toBeGreaterThan(0);

    // Closures are published in batches, not one notice per road.
    const closures = actions(played, 'publish_road_closure');
    expect(closures.length).toBeGreaterThan(0);
    expect(closures.length).toBeLessThan(40);

    // The water is gone by the end; what remains is the debris.
    expect(Object.values(world.cells).filter((cell) => cell.floodDepthM).length).toBe(0);
    expect(Object.values(world.roads).some((road) => road.status === 'blocked')).toBe(true);
  });

  it('earthquake: bridges and hospitals are hit and the response adapts', () => {
    const played = once(QUAKE);
    const { world } = played.rt;
    expect(Object.values(world.cells).some((cell) => (cell.shakeMMI ?? 0) > 0)).toBe(true);

    // At least one bridge is not plainly open.
    const bridgeEdges = new Set(portland.region.bridges.flatMap((bridge) => bridge.edgeIds));
    expect(Object.keys(world.roads).some((edgeId) => bridgeEdges.has(edgeId))).toBe(true);

    // A hospital in trouble stops receiving ambulances.
    const diverted = Object.entries(world.facilities).filter(([, f]) => f.onDivert);
    expect(diverted.length).toBeGreaterThan(0);
    expect(actions(played, 'divert_hospital').length).toBeGreaterThan(0);
    const ambulance = actions(played, 'assign_ambulance')[0];
    if (ambulance) {
      const destination = (ambulance.payload as { hospitalId?: string }).hospitalId;
      expect(diverted.map(([id]) => id)).not.toContain(destination);
    }

    // Collapses get urban search and rescue.
    const collapses = Object.values(world.incidents).filter((i) => i.kind === 'structure_collapse');
    expect(collapses.length).toBeGreaterThan(0);
    expect(actions(played, 'dispatch_unit').length).toBeGreaterThan(0);
    for (const collapse of collapses.filter((c) => c.assignedUnitIds.length > 0)) {
      expect(world.units[collapse.assignedUnitIds[0]!]!.kind).toBe('usar');
    }
  });

  it('the two acts lead to different roads being reopened first', () => {
    const top = (id: string) => {
      const { restoration } = once(id).rt.world;
      return restoration!.options.find((option) => option.id === restoration!.recommendedOptionId)!
        .label;
    };
    expect(top(FLOOD)).not.toBe(top(QUAKE));
  });
});
