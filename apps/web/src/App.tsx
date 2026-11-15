import { CLIENT_PACKAGE, CONTRACT_VERSION } from '@bastion/client';

/**
 * Bootstrap placeholder that proves the workspace is wired together.
 * Owner: Thant. Throw this away in THA-001/THA-002; nothing here is a design decision.
 */
export function App() {
  const mock = import.meta.env.VITE_MOCK === '1';

  return (
    <main>
      <h1>Bastion</h1>
      <p>Workspace scaffold is running.</p>
      <ul>
        <li>data layer: {CLIENT_PACKAGE}</li>
        <li>contracts: v{CONTRACT_VERSION}</li>
        <li>mode: {mock ? 'mock' : 'live'}</li>
      </ul>
    </main>
  );
}
