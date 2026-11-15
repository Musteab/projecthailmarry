import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
export interface ImageInput {
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
}
export interface LLMRequest<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  images?: ImageInput[];
  timeoutMs: number;
  signal?: AbortSignal;
}
export interface LLMProvider {
  completeJson<T>(request: LLMRequest<T>): Promise<T>;
}
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  constructor(
    apiKey: string,
    private usage?: (value: Usage) => void,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }
  async completeJson<T>(request: LLMRequest<T>): Promise<T> {
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, request.timeoutMs))])
      : AbortSignal.timeout(Math.max(1, request.timeoutMs));
    const content: Anthropic.MessageParam['content'] = [
      ...(request.images ?? []).map((image) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: image.mediaType, data: image.data },
      })),
      { type: 'text' as const, text: request.user },
    ];
    const response = await this.client.messages.parse(
      {
        model: request.model,
        max_tokens: 1800,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
        output_config: { format: zodOutputFormat(request.schema) },
      },
      { signal, timeout: request.timeoutMs, maxRetries: 0 },
    );
    try {
      this.usage?.({
        model: request.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    } catch {
      /* Logging must not affect response. */
    }
    return request.schema.parse(response.parsed_output);
  }
}
export class FakeProvider implements LLMProvider {
  calls: LLMRequest<unknown>[] = [];
  constructor(
    private respond: (request: LLMRequest<unknown>, attempt: number) => unknown | Promise<unknown>,
  ) {}
  async completeJson<T>(request: LLMRequest<T>): Promise<T> {
    this.calls.push(request);
    return request.schema.parse(await this.respond(request, this.calls.length));
  }
}
