import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { AnthropicProvider } from '../llm';
import type { LLMProvider, ImageInput } from '../llm';
import { ResponseCache, cacheKey } from '../cache';
import { withFallback } from '../fallback';
export type IntelMode = 'off' | 'cache' | 'live';
export interface IntelLog {
  task: string;
  model: string;
  durationMs: number;
  source: 'off' | 'cache' | 'live' | 'fallback';
  inputTokens?: number;
  outputTokens?: number;
}
export interface IntelConfig {
  mode?: IntelMode;
  apiKey?: string;
  fastModel?: string;
  deepModel?: string;
  cacheDir?: string;
  timeoutMs?: number;
  provider?: LLMProvider;
  log?: (entry: IntelLog) => void;
}
export class IntelService {
  readonly mode: IntelMode;
  readonly fastModel: string;
  readonly deepModel: string;
  readonly cache: ResponseCache;
  readonly provider?: LLMProvider;
  readonly timeoutMs: number;
  constructor(private config: IntelConfig = {}) {
    const envMode = process.env.INTEL_MODE;
    this.mode = config.mode ?? (envMode === 'live' || envMode === 'cache' ? envMode : 'off');
    this.fastModel = config.fastModel ?? process.env.INTEL_MODEL_FAST ?? 'claude-sonnet-5-5';
    this.deepModel = config.deepModel ?? process.env.INTEL_MODEL_DEEP ?? 'claude-fable-5-2';
    this.cache = new ResponseCache(
      config.cacheDir ??
        fileURLToPath(new URL('../../../../data/fixtures/ai-cache/', import.meta.url)),
    );
    const key = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.provider =
      config.provider ??
      (this.mode === 'live' && key
        ? new AnthropicProvider(key, (usage) => {
            try {
              config.log?.({ task: 'usage', durationMs: 0, source: 'live', ...usage });
            } catch {
              /* Ignore telemetry failures. */
            }
          })
        : undefined);
    this.timeoutMs = Math.max(1, Math.min(3500, config.timeoutMs ?? 3500));
  }
  async run<T>(
    task: string,
    version: string,
    model: string,
    system: string,
    input: unknown,
    schema: z.ZodType<T>,
    fallback: () => T,
    images?: ImageInput[],
  ): Promise<T> {
    const start = Date.now();
    let source: IntelLog['source'] = 'fallback';
    const safe = () => schema.parse(fallback());
    const result = await withFallback(
      async (signal) => {
        if (this.mode === 'off') {
          source = 'off';
          return safe();
        }
        const key = cacheKey({ task, version, model, system, input, images });
        const saved = await this.cache.read(key, schema);
        if (saved !== undefined) {
          source = 'cache';
          return saved;
        }
        if (this.mode === 'cache' || !this.provider) return safe();
        let last: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (signal.aborted) break;
          try {
            const value = schema.parse(
              await this.provider.completeJson({
                model,
                system,
                user: JSON.stringify(input),
                schema,
                images,
                signal,
                timeoutMs: Math.max(1, this.timeoutMs - (Date.now() - start)),
              }),
            );
            if (signal.aborted) return safe();
            await this.cache.write(key, value).catch(() => {});
            source = 'live';
            return value;
          } catch (error) {
            last = error;
          }
        }
        throw last;
      },
      safe,
      this.timeoutMs,
    );
    try {
      this.config.log?.({ task, model, durationMs: Date.now() - start, source });
    } catch {
      /* Ignore telemetry failures. */
    }
    return result;
  }
}
