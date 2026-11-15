import { createStore } from 'zustand/vanilla';
export interface DemoActionStep {
  id: string;
  title: string;
  run: () => Promise<unknown>;
}
export function createDemoSequence(steps: DemoActionStep[]) {
  const store = createStore<{ current: number; busy: boolean; error?: string }>(() => ({
    current: -1,
    busy: false,
  }));
  const goto = async (index: number) => {
    if (store.getState().busy || !Number.isInteger(index) || index < 0 || index >= steps.length)
      return false;
    store.setState({ busy: true, error: undefined });
    try {
      await steps[index].run();
      store.setState({ current: index });
      return true;
    } catch (error) {
      store.setState({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      store.setState({ busy: false });
    }
  };
  return {
    store,
    steps: steps.map(({ id, title }) => ({ id, title })),
    goto,
    next: () => goto(store.getState().current + 1),
    reset: () => {
      if (!store.getState().busy) store.setState({ current: -1, error: undefined });
    },
  };
}
export type DemoSequence = ReturnType<typeof createDemoSequence>;
const registered = new WeakMap<DemoSequence, { count: number; stop: () => void }>();
export function registerDemoHotkeys(sequence: DemoSequence) {
  if (typeof window === 'undefined') return () => {};
  let entry = registered.get(sequence);
  if (!entry) {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat ||
        target?.closest?.('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (event.code === 'KeyN') {
        event.preventDefault();
        void sequence.next();
      }
      if (event.code === 'KeyR') {
        event.preventDefault();
        sequence.reset();
      }
      if (/^Digit[1-8]$/.test(event.code)) {
        event.preventDefault();
        void sequence.goto(Number(event.code.slice(-1)) - 1);
      }
    };
    window.addEventListener('keydown', key);
    entry = { count: 0, stop: () => window.removeEventListener('keydown', key) };
    registered.set(sequence, entry);
  }
  entry.count++;
  return () => {
    if (--entry!.count === 0) {
      entry!.stop();
      registered.delete(sequence);
    }
  };
}
