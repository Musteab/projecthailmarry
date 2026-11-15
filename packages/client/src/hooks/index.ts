import { createContext, createElement, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ScenarioBeat, WorldSnapshot } from '@bastion/shared';
import { createBastionClient } from '../runtime';
import type { BastionClient, BastionConfig } from '../runtime';

const Context = createContext<BastionClient | null>(null);
/** Configuration is captured on mount. Remount with a new key to change backend or mode. */
export function BastionProvider({ config = {}, children, client: supplied }: {
  config?: BastionConfig; children?: ReactNode; client?: BastionClient;
}) {
  const [client] = useState(() => supplied ?? createBastionClient(config));
  useEffect(() => { void client.start(); return client.stop; }, [client]);
  return createElement(Context.Provider, { value: client }, children);
}
export function useBastionClient() {
  const client = useContext(Context);
  if (!client) throw new Error('Bastion hooks must be used inside BastionProvider');
  return client;
}
export function useWorld<T>(selector: (world: WorldSnapshot) => T): T {
  const client = useBastionClient();
  return useStore(client.world, useShallow(state => selector(state.world)));
}
export const useUnits = () => useWorld(w => Object.values(w.units));
export const useIncidents = () => useWorld(w => Object.values(w.incidents));
export const useSignals = () => useWorld(w => w.signals);
export const useActions = () => useWorld(w => Object.values(w.actions));
export const useTimeline = () => useWorld(w => w.timeline);
export const useMetrics = () => useWorld(w => w.metrics);
export const useCells = () => useWorld(w => w.cells);
export const useRoadStates = () => useWorld(w => w.roads);
export const useFacilityStates = () => useWorld(w => w.facilities);
export const useGridSections = () => useWorld(w => w.gridSections);
export const useHazards = () => useWorld(w => w.hazards);
export const useRestoration = () => useWorld(w => w.restoration);
export const useWorkOrders = () => useWorld(w => Object.values(w.workOrders));
export function useBeat() { return useStore(useBastionClient().world, state => state.beat); }
/** Imperative consumers can also use client.onBeat(callback). */
export function useOnBeat(callback: (beat: ScenarioBeat) => void) {
  const client = useBastionClient(); useEffect(() => client.onBeat(callback), [client, callback]);
}
export function useSession() {
  const client = useBastionClient();
  return useStore(client.session, useShallow(state => ({ status: state.status, user: state.value?.user,
    login: client.login, logout: client.logout, can: client.session.can })));
}
export function useRegion() {
  return useStore(useBastionClient().data, useShallow(state => ({ region: state.region, loading: state.regionLoading, error: state.error })));
}
export function useScenarios() {
  return useStore(useBastionClient().data, useShallow(state => ({ scenarios: state.scenarios, loading: state.scenariosLoading })));
}
export function useOperation() {
  const client = useBastionClient();
  return useStore(client.world, useShallow(state => ({ operation: state.world.operation.id ? state.world.operation : undefined,
    clock: state.world.operation.id ? state.world.clock : undefined, connection: state.connection,
    launch: client.launch, control: client.control, setSpeed: client.setSpeed, inject: client.inject })));
}
export function useActionCommands() { return useBastionClient().actionCommands; }
export function useRestorationCommands() { return useBastionClient().restorationCommands; }
export function useRules() {
  const client = useBastionClient();
  return useStore(client.data, useShallow(state => ({ rules: state.rules, update: client.updateRule })));
}
export function useBriefing() {
  const client = useBastionClient();
  return useStore(client.data, useShallow(state => ({ briefing: state.briefing, loading: state.briefingLoading, refresh: client.refreshBriefing })));
}
export function useCopilot() {
  const client = useBastionClient();
  return useStore(client.data, useShallow(state => ({ ask: client.ask, history: state.history })));
}
export function useDemoDirector() {
  const client = useBastionClient();
  return useStore(client.data, useShallow(state => ({ steps: state.steps, current: state.current, ...client.demoCommands })));
}
