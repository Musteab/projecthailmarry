import { describe, expect, it } from 'vitest';
import { RegionStaticSchema, ScenarioSchema, ServerMessageSchema } from '@bastion/shared';
import { MockTransport } from '@bastion/client';
import { localScripts } from './scenarios';
import { regions } from './regions';

for (const [key, data] of Object.entries(regions))
  describe(`${key} local exercise`, () => {
    it('has contract-valid geography with connected facility references and bounded routes', () => {
      RegionStaticSchema.parse(data.region);
      const nodes = new Set(data.region.nodes.map((n) => n.id));
      for (const facility of data.region.facilities) expect(nodes.has(facility.nodeId)).toBe(true);
      for (const edge of data.region.edges) {
        expect(nodes.has(edge.from) && nodes.has(edge.to)).toBe(true);
        for (const [lon, lat] of edge.geometry) {
          expect(lon).toBeGreaterThanOrEqual(data.region.config.bbox[0]);
          expect(lon).toBeLessThanOrEqual(data.region.config.bbox[2]);
          expect(lat).toBeGreaterThanOrEqual(data.region.config.bbox[1]);
          expect(lat).toBeLessThanOrEqual(data.region.config.bbox[3]);
        }
      }
    });
    for (const script of localScripts(data))
      it(`${script.scenario.hazard}: dispatches on real roads, isolates power and reopens a repaired road`, async () => {
        ScenarioSchema.parse(script.scenario);
        const transport = new MockTransport({ region: data.region, scripts: [script] });
        transport.seek(70);
        ServerMessageSchema.parse({ t: 'snapshot', world: transport.world });
        const actions = Object.values(transport.world.actions);
        expect(actions.filter((a) => a.status === 'failed')).toEqual([]);
        expect(actions.find((a) => a.kind === 'dispatch_unit')?.status).toBe('executed');
        expect(actions.find((a) => a.kind === 'assign_ambulance')?.status).toBe('executed');
        expect(
          Object.values(transport.world.gridSections).every((g) => g.status === 'isolated'),
        ).toBe(true);
        const edges = new Set(data.region.edges.map((e) => e.id));
        for (const unit of Object.values(transport.world.units)) {
          for (const id of unit.assignment?.routeEdgeIds ?? []) {
            expect(edges.has(id)).toBe(true);
            expect(transport.world.roads[id]?.status ?? 'open').toBe('open');
          }
        }
        transport.seek(205);
        expect(transport.world.restoration?.options).toHaveLength(3);
        expect(transport.world.restoration!.options[0].score).toBeGreaterThan(0);
        const manual = await transport.request<{ id: string }>(
          'POST',
          `/api/operations/${transport.world.operation.id}/work-orders`,
          { optionId: transport.world.restoration!.recommendedOptionId },
        );
        await transport.request('POST', `/api/operations/${transport.world.operation.id}/control`, {
          command: 'start',
        });
        transport.advance(1);
        expect(Object.keys(transport.world.workOrders)).toEqual([manual.id]);
        transport.seek(350);
        const order = Object.values(transport.world.workOrders)[0];
        expect(order.status).toBe('reopened');
        expect(order.history.map((h) => h.status)).toEqual([
          'created',
          'assigned',
          'in_progress',
          'inspection',
          'reopened',
        ]);
        const candidate = transport.world.restoration!.candidates.find(
          (c) => c.id === order.candidateId,
        )!;
        expect(candidate.edgeIds.every((id) => !transport.world.roads[id])).toBe(true);
        expect(Object.values(transport.world.actions).filter((a) => a.status === 'failed')).toEqual(
          [],
        );
      });
  });
