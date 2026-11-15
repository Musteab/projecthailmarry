import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('server bootstrap', () => {
  it('answers the health check', async () => {
    const app = buildApp({ quiet: true });
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await app.close();
  });
});
