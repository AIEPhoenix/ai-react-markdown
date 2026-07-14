/**
 * Internal barrel for incremental (prefix-freeze) parsing. NOT re-exported
 * from the package barrel — consumers opt in via
 * `config.incrementalParseEnabled`, never by calling these directly.
 */

export { advanceIncrementalParse } from './advanceIncrementalParse';
export type { AdvanceOptions, AdvanceResult, IncrementalParseState, IncrementalStage } from './advanceIncrementalParse';
export { computeFreezeBoundary } from './computeFreezeBoundary';
export type { FreezeBoundaryOptions } from './computeFreezeBoundary';
export { attributeHastChildren } from './attributeHastChildren';
