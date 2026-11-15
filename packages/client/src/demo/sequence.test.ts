import { expect, it, vi } from 'vitest';
import { createDemoSequence } from './sequence';
it('runs ordered steps, preserves the failed step for retry, and rejects overlapping actions', async () => {
  let finish: () => void = () => {};
  const first = vi.fn(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const second = vi.fn(async () => {
    throw new Error('Wait for restoration');
  });
  const sequence = createDemoSequence([
    { id: 'a', title: 'Launch', run: first },
    { id: 'b', title: 'Recovery', run: second },
  ]);
  const pending = sequence.next();
  expect(await sequence.next()).toBe(false);
  expect(first).toHaveBeenCalledTimes(1);
  finish();
  expect(await pending).toBe(true);
  expect(sequence.store.getState().current).toBe(0);
  expect(await sequence.next()).toBe(false);
  expect(sequence.store.getState()).toMatchObject({
    current: 0,
    error: 'Wait for restoration',
    busy: false,
  });
  second.mockResolvedValueOnce(undefined as never);
  expect(await sequence.next()).toBe(true);
  expect(sequence.store.getState().current).toBe(1);
  sequence.reset();
  expect(sequence.store.getState().current).toBe(-1);
  expect(await sequence.goto(99)).toBe(false);
});

it('keeps the same operation when switching to the recovery persona', async () => {
  const { createBastionClient } = await import('../runtime');
  const client = createBastionClient({ mock: true });
  await client.start();
  try {
    const id = client.world.getState().world.operation.id;
    expect(id).not.toBe('');
    expect(await client.stageDirector.goto(3)).toBe(true);
    expect(client.world.getState().world.operation.id).toBe(id);
  } finally {
    client.stop();
  }
});
