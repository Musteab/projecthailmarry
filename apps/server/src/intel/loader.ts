import type { IntelHost, IntelPort } from '@bastion/shared';
import type { FastifyPluginAsync } from 'fastify';
import { NullIntel } from './NullIntel';

export interface LoadedIntel {
  port: IntelPort;
  /** the Fastify plugin from @bastion/intel that mounts /api/intel/* and /public/* */
  plugin?: FastifyPluginAsync<{ host: IntelHost }>;
  /** where the port came from, for the boot log */
  source: 'package' | 'fallback';
  note?: string;
}

/**
 * Loads @bastion/intel if it is ready. The package is owned by another developer and lands on
 * its own schedule, so anything short of a working `createIntel` falls back to the rule-based
 * NullIntel and the server boots regardless.
 */
export async function loadIntel(env: Record<string, string | undefined>): Promise<LoadedIntel> {
  const fallback = (note: string): LoadedIntel => ({
    port: new NullIntel(),
    source: 'fallback',
    note,
  });
  try {
    const module = (await import('@bastion/intel')) as {
      createIntel?: (config: Record<string, string | undefined>) => IntelPort;
      intelPlugin?: FastifyPluginAsync<{ host: IntelHost }>;
    };
    if (typeof module.createIntel !== 'function') {
      return fallback('@bastion/intel does not export createIntel yet');
    }
    return {
      port: module.createIntel(env),
      ...(typeof module.intelPlugin === 'function' ? { plugin: module.intelPlugin } : {}),
      source: 'package',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fallback(`@bastion/intel failed to load: ${reason}`);
  }
}
