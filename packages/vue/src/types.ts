import type { Component, VNodeChild } from 'vue';
import type { Element } from 'hast';
import type {
  AIMarkdownEnginePlugin,
  AIMDContentPreprocessor,
  SanitizeSchema,
  UrlTransform,
} from '@ai-markdown/engine';

export interface MarkdownElementContext {
  /** Sanitized, render-owned HAST node. Never a shared registry body. */
  node: Element;
  properties: Record<string, unknown>;
  children: VNodeChild[];
  streaming: boolean;
  metadata: unknown;
}
export type MarkdownComponents = Readonly<Record<string, Component>>;
export type MarkdownElementSlot = (context: MarkdownElementContext) => VNodeChild;
export interface AIMarkdownProps {
  /** Complete accumulated source, not a transport delta. */
  content: string;
  documentId?: string;
  documentIndex?: number;
  streaming?: boolean;
  incrementalParse?: boolean;
  preserveOrphanReferences?: boolean;
  enginePlugins?: readonly AIMarkdownEnginePlugin[];
  contentPreprocessors?: readonly AIMDContentPreprocessor[];
  sanitizeSchema?: SanitizeSchema;
  urlTransform?: UrlTransform;
  components?: MarkdownComponents;
  metadata?: unknown;
  streamingCursor?: boolean;
}
