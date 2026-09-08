'use client';

/**
 * Shared control rows for the streaming benchmark stories. Every comparison
 * page renders the same scenario selector and payload-scale selector; each
 * page used to hand-write its own copy, and they drifted (one page showed
 * raw scenario KEYS where the others showed the 'A. …' labels). Per-page
 * toggles that belong on the payload row (spy/registry/defs/…) are passed
 * as children so the row layout stays uniform without this module having to
 * know every page's toggle set.
 *
 * @module stories/streaming/ComparisonControls
 */

import type { ReactNode } from 'react';
import { SCENARIO_KEYS, type ScenarioConfig, type ScenarioKey } from './scenarios';
import type { ControlStyles } from './theme';
import { PAYLOAD_SCALES, type PayloadScale } from './useComparisonRuns';

/** Scenario selector — one button per scenario, label shown, description as
 *  the hover title. */
export const ScenarioRow = ({
  scenarios,
  scenario,
  onSelect,
  disabled,
  controls,
}: {
  scenarios: Record<string, ScenarioConfig>;
  scenario: ScenarioKey;
  onSelect: (key: ScenarioKey) => void;
  disabled: boolean;
  controls: ControlStyles;
}) => (
  <div style={controls.buttonRow}>
    {SCENARIO_KEYS.map((key) => (
      <button
        key={key}
        disabled={disabled}
        onClick={() => onSelect(key)}
        style={scenario === key ? controls.primaryButton : controls.baseButton}
        title={scenarios[key].description}
      >
        {scenarios[key].label}
      </button>
    ))}
  </div>
);

/** Payload-scale selector plus the chars/blocks readout. Page-specific
 *  toggle buttons arrive as children and continue the same row after a
 *  separator dot. */
export const PayloadScaleRow = ({
  payloadScale,
  onSelect,
  payloadChars,
  payloadBlocks,
  disabled,
  controls,
  children,
}: {
  payloadScale: PayloadScale;
  onSelect: (scale: PayloadScale) => void;
  payloadChars: number;
  payloadBlocks: number;
  disabled: boolean;
  controls: ControlStyles;
  children?: ReactNode;
}) => (
  <div style={controls.buttonRow}>
    <span style={controls.caption}>payload</span>
    {PAYLOAD_SCALES.map((s) => (
      <button
        key={s}
        disabled={disabled}
        onClick={() => onSelect(s)}
        style={payloadScale === s ? controls.primaryButton : controls.baseButton}
      >
        {s}×
      </button>
    ))}
    <span style={controls.caption}>
      {payloadChars.toLocaleString()} chars / {payloadBlocks} blocks
    </span>
    {children != null && <span style={{ ...controls.caption, marginLeft: 8 }}>·</span>}
    {children}
  </div>
);
