import { createStore } from 'zustand/vanilla';
import { apiPaths, LoginResponseSchema, UserSchema } from '@bastion/shared';
import type {
  AccessImpact,
  ActionPayload,
  Briefing,
  ControlCommand,
  CopilotResponse,
  Inject,
  Mode,
  Operation,
  RegionStatic,
  Rule,
  ScenarioBeat,
  ScenarioSummary,
  UpdateRuleRequest,
  WorkOrder,
  WorkOrderStatus,
  WorldSnapshot,
} from '@bastion/shared';
import { createWorldStore } from './store';
import { createSession } from './session';
import type { SessionStorage } from './session';
import { ApiError, HttpWsTransport } from './transport';
import type { Method, Transport } from './transport';
import { MockTransport } from './transport/mock';

export type DemoStep = ScenarioBeat;
export interface BastionConfig {
  apiUrl?: string;
  wsUrl?: string;
  mock?: boolean;
}
export interface ClientOptions extends BastionConfig {
  transport?: Transport;
  storage?: SessionStorage;
}
interface DataState {
  region?: RegionStatic;
  regionLoading: boolean;
  error?: Error;
  scenarios: ScenarioSummary[];
  scenariosLoading: boolean;
  rules: Rule[];
  briefing?: Briefing;
  briefingLoading: boolean;
  history: { q: string; a: string }[];
  steps: DemoStep[];
  current: number;
}

export function createBastionClient(config: ClientOptions = {}) {
  const mock =
    config.mock ??
    (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_MOCK === '1';
  // Mock identities must never be restored as real server credentials.
  const session = createSession(
    mock ? { getItem: () => null, setItem: () => {}, removeItem: () => {} } : config.storage,
  );
  const world = createWorldStore();
  const transport =
    config.transport ??
    (mock ? new MockTransport() : new HttpWsTransport({ ...config, getToken: session.token }));
  const initialData = (): DataState => ({
    regionLoading: false,
    scenariosLoading: false,
    scenarios: [],
    rules: [],
    briefingLoading: false,
    history: [],
    steps: [],
    current: -1,
  });
  const data = createStore<DataState>()(initialData);
  let disconnect: (() => void) | undefined;
  let epoch = 0;
  let launchEpoch = 0;
  let started = false;
  let startRun = 0;
  const opId = () => {
    const id = world.getState().world.operation.id;
    if (!id) throw new Error('Launch an operation first');
    return id;
  };
  const request = async <T>(method: Method, path: string, body?: unknown): Promise<T> => {
    const generation = epoch;
    try {
      return await transport.request<T>(method, path, body);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && generation === epoch) logout();
      throw error;
    }
  };
  const refresh = async (id: string, generation = epoch) => {
    const snapshot = await request<WorldSnapshot>('GET', apiPaths.operation(id));
    if (generation === epoch && world.getState().world.operation.id === id)
      world.receive({ t: 'snapshot', world: snapshot });
  };
  const loadCatalogue = async (generation: number) => {
    data.setState({ scenariosLoading: true, error: undefined });
    try {
      const [scenarios, rules] = await Promise.all([
        request<ScenarioSummary[]>('GET', apiPaths.scenarios),
        request<Rule[]>('GET', apiPaths.rules),
      ]);
      if (generation !== epoch) return;
      data.setState({ scenarios, rules });
      if (scenarios[0]) {
        data.setState({ regionLoading: true });
        const region = await request<RegionStatic>(
          'GET',
          apiPaths.regionStatic(scenarios[0].regionId),
        );
        if (generation === epoch) data.setState({ region });
      }
    } finally {
      if (generation === epoch) data.setState({ scenariosLoading: false, regionLoading: false });
    }
  };
  const launch = async ({
    scenarioId,
    mode,
  }: {
    scenarioId: string;
    mode: Mode;
  }): Promise<Operation> => {
    const generation = epoch,
      ticket = ++launchEpoch;
    const scenario = data.getState().scenarios.find((s) => s.id === scenarioId);
    if (!scenario) throw new Error('Select a scenario from the loaded catalogue');
    const region = await request<RegionStatic>('GET', apiPaths.regionStatic(scenario.regionId));
    const operation = await request<Operation>('POST', apiPaths.operations, {
      regionId: scenario.regionId,
      scenarioId,
      mode,
    });
    const snapshot = await request<WorldSnapshot>('GET', apiPaths.operation(operation.id));
    if (generation !== epoch || ticket !== launchEpoch) return operation;
    disconnect?.();
    world.reset();
    data.setState({
      region,
      briefing: undefined,
      history: [],
      current: -1,
      steps: transport instanceof MockTransport ? transport.scenario.beats : [],
    });
    world.receive({ t: 'snapshot', world: snapshot });
    disconnect = transport.connect(
      operation.id,
      (message) => {
        if (generation !== epoch || ticket !== launchEpoch) return;
        world.receive(message);
        if (message.t === 'beat') {
          const steps = data.getState().steps;
          const index = steps.findIndex((step) => step.id === message.beat.id);
          data.setState({
            steps: index < 0 ? [...steps, message.beat] : steps,
            current: index < 0 ? steps.length : index,
          });
        }
      },
      (connection) => {
        if (generation === epoch && ticket === launchEpoch) world.setState({ connection });
      },
    );
    return operation;
  };
  const command = async (path: string, body?: unknown) => {
    const id = opId(),
      generation = epoch;
    await request('POST', path, body);
    await refresh(id, generation);
  };
  const control = async (commandName: ControlCommand) => {
    await command(apiPaths.operationControl(opId()), { command: commandName });
    if (commandName === 'reset') data.setState({ briefing: undefined, history: [], current: -1 });
  };
  const setSpeed = (speed: number) =>
    command(apiPaths.operationControl(opId()), { command: 'speed', speed });
  const inject = (input: Inject) => command(apiPaths.operationInjects(opId()), input);
  function logout() {
    epoch++;
    launchEpoch++;
    disconnect?.();
    disconnect = undefined;
    session.set();
    world.reset();
    data.setState(initialData(), true);
  }
  const login = async (email: string, password: string) => {
    logout();
    const generation = epoch;
    session.setState({ status: 'loading' });
    try {
      const value = LoginResponseSchema.parse(
        await request('POST', apiPaths.login, { email, password }),
      );
      if (generation !== epoch) return;
      session.set(value);
      await loadCatalogue(generation);
    } catch (error) {
      if (generation === epoch) {
        session.set();
        data.setState({ error: error instanceof Error ? error : new Error(String(error)) });
      }
      throw error;
    }
  };
  const actionCommands = {
    approve: (id: string) => command(apiPaths.actionApprove(id), {}),
    reject: (id: string, reason: string) => command(apiPaths.actionReject(id), { reason }),
    override: (id: string, reason: string, replacement?: ActionPayload) =>
      command(apiPaths.actionOverride(id), { reason, replacement }),
    create: (payload: ActionPayload) => command(apiPaths.operationActions(opId()), { payload }),
  };
  const restorationCommands = {
    analyze: () => command(apiPaths.restorationAnalyze(opId()), {}),
    loadImpact: (optionId: string) =>
      request<AccessImpact>('GET', apiPaths.restorationImpact(opId(), optionId)),
    createWorkOrder: async (optionId: string) => {
      const id = opId(),
        generation = epoch;
      const order = await request<WorkOrder>('POST', apiPaths.workOrders(id), { optionId });
      await refresh(id, generation);
      return order;
    },
    transition: (id: string, to: WorkOrderStatus) =>
      command(apiPaths.workOrderTransition(id), { to }),
  };
  const updateRule = async (id: string, patch: UpdateRuleRequest) => {
    const generation = epoch;
    const rule = await request<Rule>('PATCH', apiPaths.rule(id), patch);
    if (generation === epoch)
      data.setState((state) => ({ rules: state.rules.map((r) => (r.id === id ? rule : r)) }));
  };
  let briefingTicket = 0;
  const refreshBriefing = async () => {
    const id = opId(),
      generation = epoch,
      ticket = ++briefingTicket;
    data.setState({ briefingLoading: true });
    try {
      const briefing = await request<Briefing>('POST', apiPaths.intelBriefing(id), {});
      if (generation === epoch && opId() === id && ticket === briefingTicket)
        data.setState({ briefing });
    } finally {
      if (generation === epoch && ticket === briefingTicket)
        data.setState({ briefingLoading: false });
    }
  };
  const ask = async (question: string) => {
    const id = opId(),
      generation = epoch;
    const { answer } = await request<CopilotResponse>('POST', apiPaths.intelCopilot(id), {
      question,
    });
    if (generation === epoch && opId() === id)
      data.setState((state) => ({ history: [...state.history, { q: question, a: answer }] }));
    return answer;
  };
  const goto = (index: number) => {
    const steps = data.getState().steps;
    if (!Number.isInteger(index) || index < 0 || index >= steps.length) return;
    data.setState({ current: index });
    world.receive({ t: 'beat', beat: steps[index] });
  };
  const demoCommands = {
    goto,
    next: () => goto(data.getState().current + 1),
    reset: () => {
      data.setState({ current: -1 });
      world.setState({ beat: null });
    },
  };
  const start = async () => {
    if (started) return;
    started = true;
    const run = ++startRun;
    try {
      if (mock) {
        await login('demo@bastion.test', 'mock');
        if (!started || run !== startRun || !session.getState().value) return;
        await launch({ scenarioId: data.getState().scenarios[0].id, mode: 'exercise' });
        if (started && run === startRun) await control('start');
      } else if (session.token()) {
        const generation = epoch;
        session.setState({ status: 'loading' });
        const user = UserSchema.parse(await request('GET', apiPaths.me));
        if (generation !== epoch) return;
        session.set({ token: session.token()!, user });
        await loadCatalogue(generation);
      }
    } catch (error) {
      if (started && run === startRun)
        data.setState({
          regionLoading: false,
          scenariosLoading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
    }
  };
  const stop = () => {
    started = false;
    startRun++;
    epoch++;
    launchEpoch++;
    disconnect?.();
    disconnect = undefined;
  };
  return {
    world,
    data,
    session,
    transport,
    start,
    stop,
    login,
    logout,
    launch,
    control,
    setSpeed,
    inject,
    actionCommands,
    restorationCommands,
    updateRule,
    refreshBriefing,
    ask,
    demoCommands,
    onBeat: world.onBeat,
  };
}
export type BastionClient = ReturnType<typeof createBastionClient>;
