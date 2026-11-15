/**
 * @bastion/shared: the contracts every workstream builds against.
 *
 * Owner: Dominic. Additive-only after the contract freeze: new optional fields and new exports
 * are fine; renaming, removing or changing the meaning of anything needs all three developers.
 * Every schema is `XSchema` with an inferred type `X`.
 *
 * Test fixtures (region-mini, scenario-mini) are exported from `@bastion/shared/fixtures`.
 */

/** Bump the minor version for additive changes, the major for breaking ones. */
export const CONTRACT_VERSION = '1.2.0';

export * from './primitives';
export * from './region';
export * from './world';
export * from './actions';
export * from './restoration';
export * from './scenario';
export * from './protocol';
export * from './api';
export * from './intel';
export * from './permissions';
