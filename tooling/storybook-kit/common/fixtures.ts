/** General samples come from corpus documents; precise syntax/policy regressions
 * keep dedicated inputs so their assertions continue to exercise the same case. */
import { EMPHASIS, QUOTES, TABLES, TASKS, LINKS, CODE, MATH, SHOWCASE } from './corpus';
export const GFM_BASICS = [EMPHASIS, TABLES, TASKS, QUOTES].join('\n\n');
export const PROSE_SAMPLE = [EMPHASIS, QUOTES].join('\n\n');
export const TABLES_DOC = TABLES;
export const TASK_LIST_DOC = TASKS;
export const MATH_DOC = MATH;
export const LINKED_PROSE_DOC = [LINKS, CODE].join('\n\n');
export const CODE_SAMPLES_DOC = CODE;
export const KITCHEN_SINK = SHOWCASE;

export const FOOTNOTES_DOC: string = [
  '# Footnotes',
  '',
  'The renderer collects every definition into a single footer section and',
  'renumbers the markers[^1] in reference order. Labels can be numbers or',
  'words[^setup], and a definition can run to several paragraphs[^long].',
  '',
  'A reference may also appear inside other inline formatting, such as',
  '**bold text[^nested]** or a list item:',
  '',
  '- The first item cites a source[^1].',
  '- The second one does not.',
  '',
  '[^1]: A short, single-paragraph definition.',
  '',
  '[^setup]: Referenced second, so it renders as footnote 2 regardless of',
  '    where its definition sits in the source.',
  '',
  '[^long]: The first paragraph of a longer note.',
  '',
  '    A second paragraph, indented four spaces to stay inside the note.',
  '',
  '    ```ts',
  "    import { defaultEnginePlugins } from '@ai-markdown/react/plugins';",
  '    ```',
  '',
  '[^nested]: Definitions are matched by label, so nesting the reference',
  '    inside emphasis changes nothing.',
].join('\n');

export const DEFINITION_LIST_DOC: string = [
  '# Glossary',
  '',
  'Design token',
  ': A named CSS custom property such as `--aim-color-anchor`.',
  ': The smallest unit a consumer can override without touching a stylesheet.',
  '',
  'Engine plugin',
  ': One selectable entry in the parse chain. The set is sealed — plugins are',
  '  values exported by the library, not functions a consumer writes.',
  '',
  'Prefix freeze',
  ': The incremental parsing strategy. Everything before the frozen boundary is',
  '  reused verbatim across a streaming append; only the tail is reparsed.',
  '',
  'A term may carry inline formatting, and so may its definitions:',
  '',
  '**Clobber prefix**',
  ': The per-document namespace prepended to generated ids so that two',
  '  documents on one page cannot collide.',
].join('\n');

export const CJK_MIXED_DOC: string = [
  '# 国际化文本',
  '',
  '## 中文',
  '',
  '这个组件用React18写的，构建工具是Vite，包管理器用pnpm。',
  '**「强调」**紧跟全角标点时，星号依然要渲染成加粗。',
  '',
  '## 日本語',
  '',
  'このライブラリはTypeScriptで書かれており、Reactのバージョンは18です。',
  '**「強調」**の直後に句読点が来ても、アスタリスクは記号として扱われます。',
  '',
  '## 한국어',
  '',
  '이 라이브러리는TypeScript로 작성되었고React18에서 동작합니다.',
  '**「강조」**뒤에 문장 부호가 와도 별표는 그대로 표시되지 않습니다.',
  '',
  '## 表格',
  '',
  '| 属性 | 类型 | 说明 |',
  '| :--- | :--- | :--- |',
  '| `content` | `string` | 要渲染的markdown文本 |',
  '| `streaming` | `boolean` | 是否处于流式输出中 |',
  '| `fontSize` | `string` | 根字号，其余尺寸按比例缩放 |',
].join('\n');

export const RTL_DOC: string = [
  '# النص العربي',
  '',
  'هذه فقرة قصيرة باللغة العربية تعرض كيفية عرض النص من اليمين إلى اليسار.',
  'المتصفح يحدد اتجاه النص من الأحرف نفسها.',
  '',
  '- العنصر الأول',
  '- العنصر الثاني',
  '- عنصر يحتوي على كلمة إنجليزية مثل `streaming` داخل النص',
  '',
  '> اقتباس قصير يوضح أن التنسيق يعمل أيضًا مع النص العربي.',
].join('\n');

export const MARK_HIGHLIGHT_DOC: string = [
  '# Highlighted text',
  '',
  'A run wrapped in double equals signs becomes ==a mark element==, which the',
  'default stylesheet paints with `--aim-color-mark-bg`.',
  '',
  '- A ==highlighted phrase== inside a list item',
  '- Highlighting composes with **bold**, so ==**both at once**== works',
  '- It stops at the closing delimiter: ==this is marked== and this is not',
  '',
  '> A blockquote can carry ==a highlight== too.',
  '',
  'Inside a code span the syntax is inert: `==not marked==`.',
].join('\n');

export const SMARTYPANTS_DOC: string = [
  '# Typographic punctuation',
  '',
  'She said "the renderer handles this" and then added \'or it should\'.',
  '',
  'A pause -- the kind that wants a dash -- and a trailing thought...',
  '',
  'A run of three hyphens --- inside a sentence is left exactly as typed.',
  '',
  '- "Quoted list item"',
  "- An item with an apostrophe: the parser's job",
  '- A range written with a dash: pages 10 -- 20',
  '',
  'Inside code the characters are left exactly as typed: `"quoted" -- and...`,',
  'and the same holds for fenced blocks:',
  '',
  '```text',
  'printf("literal -- quotes and dots... survive\\n");',
  '```',
].join('\n');

export const COMMENTS_DOC: string = [
  '# Draft notes',
  '',
  '<!-- Reviewer: tighten the opening paragraph before publishing. -->',
  '',
  'The visible document opens here. Nothing in this paragraph came from a',
  'comment, and nothing a comment says should ever appear on the page.',
  '',
  'A comment can also sit inline <!-- like this one --> in the middle of a',
  'sentence without breaking the run of text around it.',
  '',
  '<!--',
  'A multi-line comment.',
  'It holds several lines of notes that are not part of the document.',
  '-->',
  '',
  '## Second section',
  '',
  'Comments inside a fenced block are content, not comments, and stay visible:',
  '',
  '```html',
  '<!-- this one is source code, so it renders -->',
  '```',
].join('\n');

export const URL_SCHEMES_DOC: string = [
  '# Link schemes',
  '',
  'Allowed by the default schema:',
  '',
  '- [An absolute https link](https://example.com/guide)',
  '- [A relative link](./getting-started.md)',
  '- [A fragment link](#link-schemes)',
  '- [A mailto link](mailto:support@example.com)',
  '',
  'Dropped by the default schema — the text survives, the `href` does not:',
  '',
  '- [A javascript: link](javascript:alert(1))',
  '- [A data: link](data:text/html,hello)',
  '',
  'Dropped unless the consumer extends the schema:',
  '',
  '- [A custom app scheme](app://settings/appearance)',
  '- [Another custom scheme](myapp:open?id=42)',
  '',
  'Autolinks go through the same check: https://example.com/autolinked',
].join('\n');

export const ORPHAN_FOOTNOTE_CHUNK: string = [
  '## Sources',
  '',
  '[^soak]: The soak suite runs 300k splice iterations against the incremental',
  '    parser before a release is tagged.',
  '[^artifacts]: Every published artifact is verified against the pushed tag',
  '    before the release notes go out.',
  '',
  'The paragraph that cites both of those notes is still being written, so at',
  'this instant the definitions have nothing pointing at them',
].join('\n');

export const SECRETS_DOC: string = [
  '# Deploying the worker',
  '',
  'Set the API key to sk-a91f4c7d2be08135 before the first request, or the',
  'client falls back to anonymous quota.',
  '',
  'You can also export it inline: `export ANTHROPIC_API_KEY=sk-77b0e14aa9c3d562`.',
  '',
  '```bash',
  'curl https://api.example.test/v1/messages \\',
  "  -H 'x-api-key: sk-3f1c99e07ad4b628' \\",
  "  -H 'content-type: application/json'",
  '```',
  '',
  'Rotate the key after the deploy.',
].join('\n');

export const BROKEN_TAIL_FRAME: string = [
  '## Rate limiting',
  '',
  'Requests are throttled per organization, not per key, so a burst from one worker',
  'slows the others down. Read `x-ratelimit-remaining` on every response.',
  '',
  '```python',
  'wait = base * (2 ** attempt)',
  '```',
  '',
  'The client recovers with **exponential backoff — see [the retry guidance](https://example.test/re',
].join('\n');

export const CJK_EMPHASIS_REGRESSION: string =
  '这是一个**“会引起”**渲染错误的**“已知问题”**，当加重符号\\*\\*遇到某些中文标点时，可能就会出现**“识别不了”**的情况。就如这句话展现的一样。\n\n**このアスタリスクは強調記号として認識されず、そのまま表示されます。**この文のせいで。\n\n**该星号不会被识别，而是直接显示。**这是因为它没有被识别为强调符号。\n\n**이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)**이 문장 때문에.\n\n**~~このアスタリスクは強調記号として認識されず、そのまま表示されます。~~**この文のせいで。\n\n**~~该星号不会被识别，而是直接显示。~~**这是因为它没有被识别为强调符号。\n\n**~~이 별표는 강조 표시로 인식되지 않고 그대로 표시됩니다(이 괄호 때문에)~~**이 문장 때문에.';
