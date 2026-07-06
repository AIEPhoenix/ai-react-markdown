/**
 * Structural clone of a hast subtree for render-time use.
 *
 * Copies exactly what the render-time mutators touch — every node object,
 * its `children` array (the allow/disallow filters splice it), and its
 * `properties` object (`urlTransform` overwrites `href`/`src`) — while
 * SHARING `position`, `data`, string values, and individual property values
 * by reference. This is both cheaper than a JSON round-trip (no string
 * intermediate; `position` objects, typically over half of a serialized
 * hast, are never materialized) and exact for any tree the pipeline
 * produces (no lossy JSON semantics to reason about).
 *
 * @module components/cloneHastForRender
 */

import type { Nodes as HastNodes } from 'hast';

/** See module docs. Safe for any hast node union member. */
export function cloneHastForRender<T extends HastNodes>(node: T): T {
  const copy = { ...node } as T;
  const withChildren = copy as { children?: HastNodes[] };
  if (Array.isArray(withChildren.children)) {
    withChildren.children = withChildren.children.map((child) => cloneHastForRender(child));
  }
  const withProperties = copy as { properties?: Record<string, unknown> };
  if (withProperties.properties) {
    withProperties.properties = { ...withProperties.properties };
  }
  return copy;
}
