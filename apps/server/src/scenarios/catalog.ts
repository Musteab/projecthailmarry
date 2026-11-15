import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario, ScenarioSummary } from '@bastion/shared';
import { ScenarioSchema } from '@bastion/shared';
import { loadScenarioMini } from '@bastion/shared/fixtures';

export interface ScenarioProblem {
  file: string;
  problem: string;
}

/**
 * Every scenario the server can run: data/scenarios/*.json plus, outside production, the
 * scenario-mini fixture. A broken file is reported and skipped; it never stops the server.
 */
export class ScenarioCatalog {
  private readonly scenarios = new Map<string, Scenario>();
  readonly problems: ScenarioProblem[] = [];

  constructor(scenariosDir: string, includeFixtures: boolean) {
    const files = existsSync(scenariosDir)
      ? readdirSync(scenariosDir)
          .filter((file) => file.endsWith('.json'))
          .sort()
      : [];

    for (const file of files) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(scenariosDir, file), 'utf8'));
      } catch (error) {
        this.problems.push({ file, problem: `not valid JSON (${String(error)})` });
        continue;
      }
      const result = ScenarioSchema.safeParse(raw);
      if (!result.success) {
        const first = result.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        this.problems.push({ file, problem: `does not match the Scenario contract (${first})` });
        continue;
      }
      if (this.scenarios.has(result.data.id)) {
        this.problems.push({ file, problem: `duplicate scenario id "${result.data.id}"` });
        continue;
      }
      this.scenarios.set(result.data.id, result.data);
    }

    if (includeFixtures) {
      const fixture = loadScenarioMini();
      if (!this.scenarios.has(fixture.id)) this.scenarios.set(fixture.id, fixture);
    }
  }

  /** A fresh copy, so a running operation can never mutate the catalogue. */
  get(scenarioId: string): Scenario | undefined {
    const scenario = this.scenarios.get(scenarioId);
    return scenario ? structuredClone(scenario) : undefined;
  }

  summaries(): ScenarioSummary[] {
    return [...this.scenarios.values()].map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      hazard: scenario.hazard,
      regionId: scenario.regionId,
      description: scenario.description,
      durationSimSec: scenario.durationSimSec,
    }));
  }
}
