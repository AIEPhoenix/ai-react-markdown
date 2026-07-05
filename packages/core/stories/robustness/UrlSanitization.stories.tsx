import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';
import { defaultUrlTransform, extendSanitizeSchema } from '../../src/index';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Robustness/URL Sanitization',
  parameters: {
    docs: {
      description: {
        component:
          'LLM output is untrusted. URLs pass through **two independent gates** (defense in depth): ' +
          'Gate 1 is the `rehype-sanitize` protocol allowlist (`http https irc ircs mailto xmpp`), ' +
          'Gate 2 is `urlTransform`. Anything else — `javascript:`, `data:`, `vbscript:`, inline ' +
          "event handlers — is rewritten to `''` and rendered as a dead link. Both gates must " +
          'permit a URL for it to render.',
      },
    },
  },
};

export default meta;

/**
 * Hostile markdown that a compromised or jailbroken model might emit. Every
 * attack below is neutralized: the links go dead, the `onerror` handler and the
 * `<script>` are stripped. Nothing executes.
 */
export const XSSNeutralized: CoreStory = {
  args: {
    content: `A [seemingly normal link](javascript:alert('xss')) — the href is stripped.

An image with a payload: ![logo](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

Raw HTML is sanitized too:

<a href="javascript:alert(document.cookie)">click me</a>

<img src="x" onerror="alert('xss')" alt="broken image" />

<script>alert('this never runs')</script>

By contrast, a [safe https link](https://example.com) renders normally.`,
  },
};

// ── Custom-scheme opt-in: BOTH gates extended at module scope ─────────────────
// Gate 1 — allow `myapp` on href + src in the sanitize schema.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
  s.protocols!.src!.push('myapp');
});
// Gate 2 — let `myapp:` through, defer everything else to the safe default.
const ALLOWED = /^myapp:/i;
const URL_TRANSFORM = (url: string, key: string, node: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ALLOWED.test(url) ? url : (defaultUrlTransform as any)(url, key, node);

/**
 * Allowing a private scheme requires opting *both* gates in — the most common
 * mistake is extending only one. Here `myapp://` links render live, while
 * `javascript:` is still blocked because it isn't on either allowlist.
 */
export const CustomSchemeOptIn: CoreStory = {
  args: {
    content: `A deep link into the app: [open item 42](myapp://item/42) — this renders live.

A still-blocked attack: [nope](javascript:alert(1)).`,
  },
  render: (args) => <ThemedAIMarkdown {...args} sanitizeSchema={SCHEMA} urlTransform={URL_TRANSFORM} />,
};
