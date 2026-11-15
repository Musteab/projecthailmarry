import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const cacheKey = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export class ResponseCache {
  constructor(readonly directory: string) {}
  async read<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    if (!/^[a-f0-9]{64}$/.test(key)) return undefined;
    try {
      return schema.parse(JSON.parse(await readFile(join(this.directory, `${key}.json`), 'utf8')));
    } catch {
      return undefined;
    }
  }
  async write(key: string, value: unknown) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cache key');
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${key}.json`),
      temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
