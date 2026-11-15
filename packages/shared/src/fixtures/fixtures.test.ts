import { describe, expect, it } from 'vitest';
import type { RegionStatic } from '../region';
import { RegionStaticSchema } from '../region';
import type { InjectKind } from '../scenario';
import { ScenarioSchema } from '../scenario';
import { HazardPhaseSchema, SignalSourceSchema } from '../world';
import { loadRegionMini, loadScenarioMini, MINI, MINI_REGION_ID } from './index';

/** Node ids reachable from `start`, ignoring the given edges. */
function reachable(region: RegionStatic, start: string, without = new Set<string>()): Set<string> {
  const neighbours = new Map<string, string[]>();
  for (const edge of region.edges) {
    if (without.has(edge.id)) continue;
    neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to]);
    neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from]);
  }
  const seen = new Set([start]);
  const queue = [start];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    for (const next of neighbours.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('region-mini', () => {
  const region = loadRegionMini();
  const nodeIds = new Set(region.nodes.map((node) => node.id));
  const edgeIds = new Set(region.edges.map((edge) => edge.id));
  const facilityIds = new Set(region.facilities.map((facility) => facility.id));
  const cellIds = new Set(region.cells.map((cell) => cell.id));

  it('matches the RegionStatic schema', () => {
    expect(() => RegionStaticSchema.parse(region)).not.toThrow();
    expect(region.config.id).toBe(MINI_REGION_ID);
  });

  it('has the documented shape', () => {
    expect(region.nodes).toHaveLength(42);
    expect(region.edges).toHaveLength(67);
    expect(region.bridges).toHaveLength(2);
    expect(region.units).toHaveLength(8);
    expect(region.grid.sections).toHaveLength(4);
    expect(region.facilities.filter((f) => f.kind === 'hospital')).toHaveLength(2);
    expect(region.facilities.filter((f) => f.kind === 'shelter')).toHaveLength(2);
    expect(region.cells.length).toBeGreaterThan(120);
    expect(region.cells.length).toBeLessThan(250);
  });

  it('has unique ids and no dangling references', () => {
    expect(nodeIds.size).toBe(region.nodes.length);
    expect(edgeIds.size).toBe(region.edges.length);
    expect(cellIds.size).toBe(region.cells.length);
    for (const edge of region.edges) {
      expect(nodeIds.has(edge.from) && nodeIds.has(edge.to), edge.id).toBe(true);
    }
    for (const facility of region.facilities) {
      expect(nodeIds.has(facility.nodeId), facility.id).toBe(true);
    }
    for (const unit of region.units) {
      expect(facilityIds.has(unit.homeFacilityId), unit.id).toBe(true);
    }
  });

  it('is one connected road network that the river splits when both bridges are out', () => {
    const start = region.nodes[0]!.id;
    expect(reachable(region, start).size).toBe(region.nodes.length);

    const bridgeEdges = new Set(region.bridges.flatMap((bridge) => bridge.edgeIds));
    expect(bridgeEdges.size).toBe(2);
    for (const id of bridgeEdges) {
      expect(region.edges.find((edge) => edge.id === id)?.bridgeId).toBeDefined();
    }
    const westBank = reachable(region, start, bridgeEdges);
    expect(westBank.size).toBe(18);
    expect(region.nodes.length - westBank.size).toBe(24);
  });

  it('puts one hospital on each bank', () => {
    const bridgeEdges = new Set(region.bridges.flatMap((bridge) => bridge.edgeIds));
    const westBank = reachable(region, region.nodes[0]!.id, bridgeEdges);
    const hospital = (id: string) => region.facilities.find((facility) => facility.id === id)!;
    expect(westBank.has(hospital(MINI.facilities.hospitalWest).nodeId)).toBe(true);
    expect(westBank.has(hospital(MINI.facilities.hospitalEast).nodeId)).toBe(false);
  });

  it('distributes exactly the configured population, with ground rising away from the water', () => {
    const total = region.cells.reduce((sum, cell) => sum + cell.population, 0);
    expect(total).toBe(region.config.population);
    const elevations = region.cells.map((cell) => cell.elevM);
    expect(Math.min(...elevations)).toBeLessThan(6);
    expect(Math.max(...elevations)).toBeGreaterThan(12);
  });

  it('has a valid grid tree over known cells and facilities', () => {
    const sectionIds = new Set(region.grid.sections.map((section) => section.id));
    for (const section of region.grid.sections) {
      expect(section.cellIds.length, section.id).toBeGreaterThan(0);
      expect(
        section.cellIds.every((id) => cellIds.has(id)),
        section.id,
      ).toBe(true);
      expect(
        section.criticalFacilityIds.every((id) => facilityIds.has(id)),
        section.id,
      ).toBe(true);
      expect(facilityIds.has(section.substationId), section.id).toBe(true);
      if (section.upstreamSectionId !== null) {
        expect(sectionIds.has(section.upstreamSectionId), section.id).toBe(true);
      }
    }
    expect(region.grid.sections.filter((s) => s.upstreamSectionId === null)).toHaveLength(2);
  });

  it('hands out independent copies', () => {
    const copy = loadRegionMini();
    copy.nodes.length = 0;
    expect(loadRegionMini().nodes).toHaveLength(42);
  });
});

describe('scenario-mini', () => {
  const region = loadRegionMini();
  const scenario = loadScenarioMini();

  it('matches the Scenario schema and targets region-mini', () => {
    expect(() => ScenarioSchema.parse(scenario)).not.toThrow();
    expect(scenario.regionId).toBe(region.config.id);
  });

  it('is ordered in time and fits inside its duration', () => {
    const times = scenario.timeline.map((event) => event.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times)).toBeLessThanOrEqual(scenario.durationSimSec);
    for (const beat of scenario.beats) {
      expect(beat.simTime).toBeLessThanOrEqual(scenario.durationSimSec);
    }
  });

  it('exercises every signal source, hazard phase and inject kind', () => {
    const sources = new Set<string>();
    const phases = new Set<string>();
    const injects = new Set<InjectKind>();
    for (const event of scenario.timeline) {
      if (event.type === 'signal') sources.add(event.signal.source);
      if (event.type === 'hazard_phase') phases.add(event.phase);
      if (event.type === 'inject') injects.add(event.inject.kind);
    }
    expect([...sources].sort()).toEqual([...SignalSourceSchema.options].sort());
    expect([...phases].sort()).toEqual([...HazardPhaseSchema.options].sort());
    expect([...injects].sort()).toEqual(
      [
        'damage_bridge',
        'facility_offline',
        'facility_power_loss',
        'grid_fault',
        'set_road_status',
        'spawn_incident',
        'unit_out_of_service',
      ].sort(),
    );
  });

  it('only refers to things that exist in region-mini', () => {
    const edgeIds = new Set(region.edges.map((edge) => edge.id));
    const facilityIds = new Set(region.facilities.map((facility) => facility.id));
    const unitIds = new Set(region.units.map((unit) => unit.id));
    const sectionIds = new Set(region.grid.sections.map((section) => section.id));
    const bridgeIds = new Set(region.bridges.map((bridge) => bridge.id));
    const hazardIds = new Set(scenario.hazards.map((hazard) => hazard.id));

    for (const event of scenario.timeline) {
      if (event.type === 'hazard_phase') expect(hazardIds.has(event.hazardId)).toBe(true);
      if (event.type !== 'inject') continue;
      const inject = event.inject;
      switch (inject.kind) {
        case 'set_road_status':
          expect(inject.edgeIds.every((id) => edgeIds.has(id))).toBe(true);
          break;
        case 'damage_bridge':
          expect(bridgeIds.has(inject.bridgeId)).toBe(true);
          break;
        case 'facility_power_loss':
        case 'facility_offline':
          expect(facilityIds.has(inject.facilityId)).toBe(true);
          break;
        case 'grid_fault':
          expect(sectionIds.has(inject.sectionId)).toBe(true);
          break;
        case 'unit_out_of_service':
          expect(unitIds.has(inject.unitId)).toBe(true);
          break;
        case 'spawn_incident':
          break;
      }
    }
  });
});
