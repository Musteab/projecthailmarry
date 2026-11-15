import { createStore } from 'zustand/vanilla';
import { can, LoginResponseSchema } from '@bastion/shared';
import type { Authority, LoginResponse, PermissionVerb } from '@bastion/shared';

export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const KEY = 'bastion.session';
export function browserSessionStorage(): SessionStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
export function createSession(storage: SessionStorage | undefined = browserSessionStorage()) {
  let saved: LoginResponse | undefined;
  try {
    saved = LoginResponseSchema.parse(JSON.parse(storage?.getItem(KEY) ?? 'null'));
  } catch {
    /* expired or unavailable storage */
  }
  const store = createStore<{
    status: 'anonymous' | 'loading' | 'authenticated';
    value?: LoginResponse;
  }>()(() => ({ status: saved ? 'authenticated' : 'anonymous', value: saved }));
  const set = (value?: LoginResponse) => {
    store.setState({ status: value ? 'authenticated' : 'anonymous', value });
    try {
      if (value) storage?.setItem(KEY, JSON.stringify(value));
      else storage?.removeItem(KEY);
    } catch {
      /* memory-only session */
    }
  };
  return Object.assign(store, {
    set,
    token: () => store.getState().value?.token,
    can: (verb: PermissionVerb, authority?: Authority) => {
      const user = store.getState().value?.user;
      return !!user && can(user, verb, authority);
    },
  });
}
