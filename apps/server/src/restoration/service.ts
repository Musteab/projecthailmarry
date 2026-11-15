import type {
  AccessImpact,
  RepairCandidate,
  RestorationAnalysis,
  RestorationOption,
} from '@bastion/shared';
import { notFound } from '../errors';
import { RoadNetwork } from '../routing/network';
import type { OperationRuntime, System } from '../sim/runtime';

/** Used when public works has no rule on file. */
const DEFAULTS = {
  accessThresholdMin: 15,
  hospitalWeight: 1,
  shelterWeight: 0.5,
  isolationWeight: 1.5,
};
/** Sim seconds the road network must stay unchanged before the analysis is redone. */
const SETTLE_SEC = 4;
const MAX_CANDIDATES = 30;
/** Pairs are tried among this many of the best single repairs. */
const PAIR_POOL = 5;
/** Weight of a person-minute of travel saved, next to a person regaining access outright. */
const MINUTE_SAVED_WEIGHT = 0.02;

interface Access {
  /** minutes from each cell to the nearest functioning hospital / open shelter; Infinity = none */
  hospital: Float64Array;
  shelter: Float64Array;
}

const people = (n: number) =>
  `${Math.round(n).toLocaleString('en-US')} ${Math.round(n) === 1 ? 'resident' : 'residents'}`;
const mins = (value: number | null) => (value === null ? 'n/a' : `${value.toFixed(1)} min`);

/**
 * Ranks repairs by who regains access. For the damaged road network as it stands it works out
 * how long each populated cell needs to reach a functioning hospital and a shelter, then asks
 * the same question again for each repair as if it were already done. The repair that gives the
 * most people their access back per crew-hour comes first.
 */
export class RestorationService {
  private readonly impacts = new Map<string, AccessImpact>();
  private readonly cellNode: Int32Array;
  private readonly population: Float64Array;
  /**
   * Cells that could reach a hospital / a shelter on the undamaged network. Map data has
   * dead ends that reach nothing even on a good day; those are not the disaster's doing and
   * must not be counted as people cut off.
   */
  private reference: { hospital: Uint8Array; shelter: Uint8Array } | undefined;
  private lastSignature = '';
  private dirtySince: number | null = null;

  constructor(private readonly rt: OperationRuntime) {
    const { region, topology, nodeIdByCell } = rt.index;
    this.cellNode = Int32Array.from(region.cells, (cell) =>
      topology.requireNode(nodeIdByCell.get(cell.id)!),
    );
    this.population = Float64Array.from(region.cells, (cell) => cell.population);
  }

  private params() {
    const p = this.rt.actions.ruleFor('create_work_order', 'public_works')?.params ?? {};
    const num = (value: unknown, fallback: number) =>
      typeof value === 'number' ? value : fallback;
    return {
      accessThresholdMin: num(p.accessThresholdMin, DEFAULTS.accessThresholdMin),
      hospitalWeight: num(p.hospitalWeight, DEFAULTS.hospitalWeight),
      shelterWeight: num(p.shelterWeight, DEFAULTS.shelterWeight),
      isolationWeight: num(p.isolationWeight, DEFAULTS.isolationWeight),
    };
  }

  private destinations(): { hospitals: string[]; shelters: string[] } {
    const { world, index } = this.rt;
    const usable = (id: string) => {
      const state = world.facilities[id];
      return Boolean(state) && state!.status !== 'offline' && state!.power !== 'none';
    };
    const hospitals = index.region.facilities.filter(
      (f) => f.kind === 'hospital' && usable(f.id) && !world.facilities[f.id]!.onDivert,
    );
    const shelters = index.region.facilities.filter((f) => f.kind === 'shelter' && usable(f.id));
    // Once shelters have been opened, only open ones count; before that, any usable shelter.
    const open = shelters.filter((f) => world.facilities[f.id]!.activated);
    return {
      hospitals: hospitals.map((f) => f.nodeId),
      shelters: (open.length > 0 ? open : shelters).map((f) => f.nodeId),
    };
  }

  /** Travel minutes from every cell to the nearest destination of each kind, right now. */
  private access(dest: { hospitals: string[]; shelters: string[] }): Access {
    const { network } = this.rt;
    const perCell = (nodes: string[]) => {
      const byNode = nodes.length > 0 ? network.travelTimes(nodes, { toward: true }) : null;
      return Float64Array.from(this.cellNode, (node) => (byNode ? byNode[node]! / 60 : Infinity));
    };
    return { hospital: perCell(dest.hospitals), shelter: perCell(dest.shelters) };
  }

  private servedBeforeDamage(): { hospital: Uint8Array; shelter: Uint8Array } {
    if (this.reference) return this.reference;
    const { region, topology } = this.rt.index;
    const pristine = new RoadNetwork(topology);
    const reachable = (kind: 'hospital' | 'shelter') => {
      const nodes = region.facilities.filter((f) => f.kind === kind).map((f) => f.nodeId);
      const byNode = nodes.length > 0 ? pristine.travelTimes(nodes, { toward: true }) : null;
      return Uint8Array.from(this.cellNode, (node) =>
        byNode && byNode[node] !== Infinity ? 1 : 0,
      );
    };
    this.reference = { hospital: reachable('hospital'), shelter: reachable('shelter') };
    return this.reference;
  }

  /** Candidates that still need doing: at least one of their edges is impassable. */
  private openCandidates(): RepairCandidate[] {
    const { rt } = this;
    return [...rt.repairCandidates.values()]
      .filter((candidate) => candidate.edgeIds.some((edgeId) => !rt.network.isEdgePassable(edgeId)))
      .sort((a, b) => a.estCrewHours - b.estCrewHours || a.id.localeCompare(b.id))
      .slice(0, MAX_CANDIDATES);
  }

  /** Runs the analysis now and publishes it to the world. */
  analyze(): RestorationAnalysis {
    const { rt } = this;
    const rule = this.params();
    const limit = rule.accessThresholdMin;
    const dest = this.destinations();
    const before = this.access(dest);
    const cells = rt.index.region.cells;
    const pop = this.population;
    const lacks = (minutes: number) => minutes > limit;
    const served = this.servedBeforeDamage();

    let noHospital = 0;
    let noShelter = 0;
    let isolated = 0;
    for (let i = 0; i < cells.length; i++) {
      if (served.hospital[i] && lacks(before.hospital[i]!)) noHospital += pop[i]!;
      if (served.shelter[i] && lacks(before.shelter[i]!)) noShelter += pop[i]!;
      if (
        (served.hospital[i] || served.shelter[i]) &&
        before.hospital[i] === Infinity &&
        before.shelter[i] === Infinity
      ) {
        isolated += pop[i]!;
      }
    }

    const candidates = this.openCandidates();
    this.impacts.clear();

    const evaluate = (group: RepairCandidate[]): RestorationOption => {
      const after = rt.network.withUnblocked(
        group.flatMap((candidate) => candidate.edgeIds),
        () => this.access(dest),
      );
      let hospitalPop = 0;
      let shelterPop = 0;
      let reconnected = 0;
      let minutesSaved = 0;
      let beforeSum = 0;
      let afterSum = 0;
      let beforeWeight = 0;
      let afterWeight = 0;
      const changed: AccessImpact['cells'] = [];

      for (let i = 0; i < cells.length; i++) {
        const b = before.hospital[i]!;
        const a = after.hospital[i]!;
        const p = pop[i]!;
        if (lacks(b) && !lacks(a)) hospitalPop += p;
        if (lacks(before.shelter[i]!) && !lacks(after.shelter[i]!)) shelterPop += p;
        if (
          b === Infinity &&
          before.shelter[i] === Infinity &&
          (a !== Infinity || after.shelter[i] !== Infinity)
        ) {
          reconnected += p;
        }
        if (b !== Infinity) {
          beforeSum += b * p;
          beforeWeight += p;
        }
        if (a !== Infinity) {
          afterSum += a * p;
          afterWeight += p;
        }
        if (b !== Infinity && a < b) minutesSaved += (b - a) * p;
        if (a !== b) {
          changed.push({
            cellId: cells[i]!.id,
            beforeMin: b === Infinity ? null : Math.round(b * 10) / 10,
            afterMin: a === Infinity ? null : Math.round(a * 10) / 10,
          });
        }
      }

      const estHours = group.reduce((sum, candidate) => sum + candidate.estCrewHours, 0);
      const benefit =
        rule.hospitalWeight * hospitalPop +
        rule.shelterWeight * shelterPop +
        rule.isolationWeight * reconnected +
        MINUTE_SAVED_WEIGHT * minutesSaved;
      const id = `opt-${group.map((candidate) => candidate.id).join('+')}`;
      const avgBefore = beforeWeight > 0 ? Math.round((beforeSum / beforeWeight) * 10) / 10 : null;
      const avgAfter = afterWeight > 0 ? Math.round((afterSum / afterWeight) * 10) / 10 : null;
      const label = group.map((candidate) => candidate.label).join(' and ');

      const gains: string[] = [];
      if (hospitalPop > 0)
        gains.push(`puts ${people(hospitalPop)} back within ${limit} minutes of a hospital`);
      if (reconnected > 0) gains.push(`reconnects ${people(reconnected)} who are cut off entirely`);
      if (shelterPop > 0) gains.push(`restores shelter access for ${people(shelterPop)}`);
      if (gains.length === 0 && minutesSaved > 0) {
        gains.push(
          `shortens the average trip to hospital from ${mins(avgBefore)} to ${mins(avgAfter)}`,
        );
      }
      const rationale =
        gains.length > 0
          ? `${label} ${gains.join(', ')}. About ${estHours} crew-hours.`
          : `${label} does not change who can reach a hospital or shelter. About ${estHours} crew-hours.`;

      this.impacts.set(id, { optionId: id, cells: changed });
      return {
        id,
        candidateIds: group.map((candidate) => candidate.id),
        label,
        rank: 0,
        score: Math.round((benefit / Math.max(0.25, estHours)) * 100) / 100,
        estHours,
        impact: {
          hospitalAccessPop: Math.round(hospitalPop),
          shelterAccessPop: Math.round(shelterPop),
          isolatedPopReconnected: Math.round(reconnected),
          avgHospitalMinBefore: avgBefore,
          avgHospitalMinAfter: avgAfter,
          facilitiesReconnected: [],
        },
        rationale,
      };
    };

    const singles = candidates.map((candidate) => ({ candidate, option: evaluate([candidate]) }));
    const options = singles.map((single) => single.option);

    // Two repairs that only pay off together (both ends of a cut-off street, say).
    const pool = [...singles].sort((a, b) => b.option.score - a.option.score).slice(0, PAIR_POOL);
    const benefitOf = (option: RestorationOption) => option.score * Math.max(0.25, option.estHours);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const pair = evaluate([pool[i]!.candidate, pool[j]!.candidate]);
        const apart = benefitOf(pool[i]!.option) + benefitOf(pool[j]!.option);
        if (benefitOf(pair) > apart * 1.15 + 1) options.push(pair);
        else this.impacts.delete(pair.id);
      }
    }

    options.sort(
      (a, b) => b.score - a.score || a.estHours - b.estHours || a.id.localeCompare(b.id),
    );
    options.forEach((option, index) => (option.rank = index + 1));

    const analysis: RestorationAnalysis = {
      computedAt: rt.simTime,
      accessThresholdMin: limit,
      baseline: {
        isolatedPop: Math.round(isolated),
        noHospitalAccessPop: Math.round(noHospital),
        noShelterAccessPop: Math.round(noShelter),
      },
      candidates,
      options,
      recommendedOptionId: options[0] && options[0].score > 0 ? options[0].id : null,
    };
    rt.world.setRestoration(analysis);
    rt.world.setMetrics({
      ...rt.world.metrics,
      isolatedPop: analysis.baseline.isolatedPop,
      noHospitalAccessPop: analysis.baseline.noHospitalAccessPop,
    });
    return analysis;
  }

  /** Per-cell travel time to hospital before and after an option, for the map. */
  impact(optionId: string): AccessImpact {
    const impact = this.impacts.get(optionId);
    if (!impact) throw notFound(`Restoration option "${optionId}"`);
    return impact;
  }

  option(optionId: string): RestorationOption | undefined {
    return this.rt.world.restoration?.options.find((option) => option.id === optionId);
  }

  /** Redoes the analysis a few seconds after the roads, hospitals or shelters last changed. */
  system(): System {
    return {
      name: 'restoration',
      update: (rt) => {
        const dest = this.destinations();
        const signature = [
          rt.network.version,
          rt.repairCandidates.size,
          dest.hospitals.join(','),
          dest.shelters.join(','),
        ].join('|');
        if (signature !== this.lastSignature) {
          this.lastSignature = signature;
          this.dirtySince = rt.simTime;
        }
        if (this.dirtySince === null || rt.simTime - this.dirtySince < SETTLE_SEC) return;
        this.dirtySince = null;
        // Nothing is damaged and nothing was analysed before: there is nothing to say.
        if (
          rt.repairCandidates.size === 0 &&
          Object.keys(rt.world.roads).length === 0 &&
          !rt.world.restoration
        ) {
          return;
        }
        this.analyze();
      },
    };
  }
}
