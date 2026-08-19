/**
 * Barrel for incremental (prefix-freeze) parsing. Re-exported from the
 * package root (`advanceIncrementalParse` and friends are public engine
 * API for framework adapters); the React renderer itself opts in via the
 * resolved `incrementalParse` value and never calls these directly.
 */

export { advanceIncrementalParse } from './advanceIncrementalParse';
export type { AdvanceOptions, AdvanceResult, IncrementalParseState, IncrementalStage } from './advanceIncrementalParse';
export { computeFreezeBoundary } from './computeFreezeBoundary';
export type { FreezeBoundaryOptions } from './computeFreezeBoundary';
export { attributeHastChildren } from './attributeHastChildren';
