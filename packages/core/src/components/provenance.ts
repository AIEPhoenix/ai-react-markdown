/**
 * Per-pipeline provenance credential for the engine's placeholder elements.
 *
 * `<AIMarkdownContent>` creates ONE credential per mounted instance (a
 * null-sentinel `useRef`, never `useRef(createCredential())`, which would
 * evaluate its argument on every render) and hands the same string to two
 * places: the remark-rehype options, where the cross-chunk handlers stamp it
 * on every placeholder they emit, and `buildCoreRehypePlugins`, which
 * installs `rehypeVerifyEngineTags` to unwrap any placeholder without it.
 * The verifier deletes the property before anything downstream sees the
 * tree, so the value never reaches the DOM, caches or logs.
 *
 * Two defence layers (see `rehypeVerifyEngineTags` in the engine):
 * 1. the property NAME — authored raw HTML comes back from the tokenizer
 *    lowercased and cannot produce `engineProvenance` at all; this layer
 *    needs nothing from the runtime;
 * 2. the VALUE — 128 random bits from Web Crypto, so that a future upstream
 *    change preserving authored attribute case would still leave the value
 *    to guess.
 *
 * Without Web Crypto (no supported runtime lacks it — `engines.node >= 20`,
 * every browser since 2014 — but the repository declares no browser floor
 * and the credential is created before coordinated mode is known, so
 * throwing here would break plain standalone rendering) layer 2 degrades to
 * a unique non-secret value and layer 1 keeps holding: the verifier still
 * runs, forged instances are still unwrapped, nothing is silently lost. One
 * dev-only diagnostic per credential that fell back — i.e. per retained
 * mount — and none in production.
 *
 * @module components/provenance
 */
import { useState } from 'react';

export interface ProvenanceCredential {
  /** The string stamped on placeholders and checked by the verifier. */
  value: string;
  /** Whether `value` came from a CSPRNG. `false` only on the fallback path. */
  secret: boolean;
}

/** Diagnostic text for the fallback path. Kept as one constant so the
 *  build-aware production gate (`scripts/assert-prod-diagnostic-inert.mjs`)
 *  can look for exactly this. */
export const PROVENANCE_FALLBACK_MESSAGE =
  'Web Crypto (globalThis.crypto.getRandomValues) is unavailable; the cross-chunk placeholder credential is unique but not secret. Forged placeholders are still unwrapped by the property-name channel.';

let fallbackCounter = 0;

/**
 * One credential per mounted component, created exactly once by a lazy
 * `useState` initialiser. Not `useRef(createCredential())`: that evaluates
 * its argument on EVERY render (React keeps only the first result), burning
 * randomness and, on the fallback path, repeating the diagnostic. Not
 * `useMemo` either: React may discard memo caches, and a fresh value changes
 * the `rehypePlugins` identity, which resets the incremental parse state and
 * the block cache. (A null-sentinel `useRef` would do too, but reading a ref
 * during render is what `react-hooks/refs` forbids; the state initialiser
 * is the sanctioned once-only construct.) Strict Mode may run the
 * initialiser twice in development and keep one result — the diagnostic
 * guarantee is therefore per credential instance, not per mount.
 */
export function useProvenanceCredential(): ProvenanceCredential {
  const [credential] = useState<ProvenanceCredential>(createCredential);
  return credential;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** Create a credential. Never throws; never returns an empty value. */
export function createCredential(): ProvenanceCredential {
  // `globalThis.crypto`, not a bare `crypto` identifier: absence must be a
  // detectable `undefined`, not a `ReferenceError`.
  const webCrypto = globalThis.crypto as { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    return { value: hex(bytes), secret: true };
  }
  fallbackCounter += 1;
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ai-react-markdown] ${PROVENANCE_FALLBACK_MESSAGE}`);
  }
  return { value: `fallback-${fallbackCounter}-${Date.now().toString(36)}`, secret: false };
}
