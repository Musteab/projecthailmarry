import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { Unit } from '@bastion/shared';
import { createBastionClient } from '../runtime';
import { MockTransport } from '../transport/mock';
import { BastionProvider, useUnits, useWorld } from './index';

let dom: JSDOM;
let root: Root;
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

it('keeps the units selector reference stable for unrelated patches and re-renders on changed units', async () => {
  const client = createBastionClient({
    transport: new MockTransport(),
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const initial = new MockTransport().world;
  client.world.receive({ t: 'snapshot', world: initial });
  let renders = 0,
    selected: Unit[] = [];
  function Probe() {
    renders++;
    selected = useUnits();
    return null;
  }
  await act(async () =>
    root.render(createElement(BastionProvider, { client }, createElement(Probe))),
  );
  const before = selected,
    count = renders;
  await act(async () =>
    client.world.receive({
      t: 'tick',
      clock: { ...initial.clock, simTime: 10 },
      patch: { roads: { r: { status: 'blocked', closurePublished: false } } },
    }),
  );
  expect(selected).toBe(before);
  expect(renders).toBe(count);
  const unit = selected[0];
  await act(async () =>
    client.world.receive({
      t: 'tick',
      clock: initial.clock,
      patch: { units: { [unit.id]: { ...unit, heading: 123 } } },
    }),
  );
  expect(selected).not.toBe(before);
  expect(selected[0].heading).toBe(123);
  expect(renders).toBe(count + 1);
});

it('updates useWorld when the selector closure changes without a store update', async () => {
  const client = createBastionClient({
    transport: new MockTransport(),
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const initial = new MockTransport().world;
  client.world.receive({ t: 'snapshot', world: initial });
  const ids = Object.keys(initial.units);
  let selected: Unit | undefined;
  function Probe({ id }: { id: string }) {
    selected = useWorld((w) => w.units[id]);
    return null;
  }
  const render = (id: string) =>
    root.render(createElement(BastionProvider, { client }, createElement(Probe, { id })));
  await act(async () => render(ids[0]));
  expect(selected?.id).toBe(ids[0]);
  await act(async () => render(ids[1]));
  expect(selected?.id).toBe(ids[1]);
});
