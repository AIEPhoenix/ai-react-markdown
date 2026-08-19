# Security Policy

## Reporting a vulnerability

`ai-react-markdown` renders untrusted markdown — typically from LLM output, which can contain anything. The library's two-gate URL sanitization, schema-enforced HTML allowlists, and cross-chunk URL re-sanitization are designed to make XSS via malicious markdown impossible by default. If you believe you've found a bypass, **please report it privately**.

**Do not file a public issue or PR for security vulnerabilities.**

Use GitHub's private advisory flow:

→ [Report a vulnerability](https://github.com/AIEPhoenix/ai-react-markdown/security/advisories/new)

This creates a private channel between you and the maintainer. We'll triage as soon as possible.

## What to include

- The package and exact version (`@ai-react-markdown/core@x.y.z` / `@ai-react-markdown/engine@x.y.z` / `@ai-react-markdown/mantine@x.y.z`).
- A **minimal** markdown input that triggers the vulnerability — the smallest input that demonstrates the issue.
- The relevant `<AIMarkdown>` / `<MantineAIMarkdown>` props (custom `urlTransform`, `sanitizeSchema`, etc.). If you're using defaults, say so.
- The observed behavior (what was rendered) vs the expected (what should have been filtered).
- Whether the issue requires user interaction (e.g. clicking a link) or fires on render alone.

## Scope

In scope:

- XSS or script injection via crafted markdown that passes default sanitization.
- Sanitization bypass — URLs / tags / attributes / classes that survive both gates but shouldn't.
- Cross-chunk reference escapes — a definition in one `<AIMarkdown>` instance influencing another in unintended ways.
- Prototype pollution, denial of service via crafted input, etc.

Out of scope:

- Issues that require the consumer to explicitly loosen the defaults — a permissive custom `urlTransform`, or a `sanitizeSchema` (via `extendSanitizeSchema`) that re-admits dangerous tags/attributes/protocols (documented escape hatches; if you do that, you own the safety). Note that `urlTransform={null}` is _not_ an escape hatch: `null` means "use the default" and falls back to `defaultUrlTransform`.
- Vulnerabilities in upstream packages (`react-markdown`, `rehype-sanitize`, `katex`, `mermaid`) that aren't amplified by anything `ai-react-markdown` does.
- Social engineering, supply-chain attacks against your own dev environment, etc.

## Supported versions

| Version | Supported                                   |
| ------- | ------------------------------------------- |
| 2.4.x   | ✅ Latest                                   |
| 2.3.x   | ⚠️ Best-effort backport for critical issues |
| < 2.3   | ❌ Upgrade                                  |

## Public disclosure

After a fix is shipped, we'll publish a GitHub Security Advisory with the CVE (if applicable), affected versions, and credit to the reporter (unless you'd prefer to stay anonymous).
