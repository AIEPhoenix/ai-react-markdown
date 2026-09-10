# Legacy npm scope: proposed retirement

Status: proposal, registry unchanged. Inventory checked on 2026-09-11.

| Existing package                           | Current `latest` | Replacement                          |
| ------------------------------------------ | ---------------- | ------------------------------------ |
| `@ai-react-markdown/core`                  | `2.14.1`         | `@ai-markdown/react`                 |
| `@ai-react-markdown/engine`                | `2.14.1`         | `@ai-markdown/engine`                |
| `@ai-react-markdown/mantine`               | `2.14.1`         | `@ai-markdown/react-mantine`         |
| `@ai-react-markdown/remark-mark-highlight` | `1.0.1`          | `@ai-markdown/remark-mark-highlight` |

None of the published versions currently carries a deprecation message. The checked
names `@ai-react-markdown/react`, `runtime` and `vue` are not published. See the
[framework migration guide](./framework-transition.md) for imports, styles and the
new framework-independent core boundary. Old `core` consumers must migrate to new
`react`; replacing only the scope changes the meaning of the package.

## Recommended policy for maintainer review

Retain all existing versions and dist-tags so lockfiles and existing installations
continue to resolve. [npm recommends deprecation over unpublishing](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/) because it warns installers while keeping the package available. Deprecate all versions of the four old packages with package-specific
migration messages. Do not unpublish, move old `latest` tags, or release forwarding
wrappers: migration crosses a major version and has compatibility requirements that a
transparent wrapper would conceal.

Proposed messages (not applied):

- core: `Moved to @ai-markdown/react (not @ai-markdown/core). Migration guide: https://github.com/ai-markdown/ai-markdown/blob/main/docs/framework-transition.md`
- engine: `Moved to @ai-markdown/engine. Migration guide: https://github.com/ai-markdown/ai-markdown/blob/main/docs/framework-transition.md`
- mantine: `Moved to @ai-markdown/react-mantine. Migration guide: https://github.com/ai-markdown/ai-markdown/blob/main/docs/framework-transition.md`
- remark-mark-highlight: `Moved to @ai-markdown/remark-mark-highlight. Migration guide: https://github.com/ai-markdown/ai-markdown/blob/main/docs/framework-transition.md`

Before applying, decide whether the 2.x line will receive critical fixes and state that
support policy explicitly. Preserve npm ownership of the old names. Deprecation is a
registry metadata operation; it does not require rebuilding or publishing a patch.
After an authorized change, reread every version's metadata and verify messages,
unchanged dist-tags and continued tarball availability. Keep a before/after inventory
so a mistaken deprecation message can be corrected.
