/**
 * Code as it appears in a real answer: many languages, short and idiomatic,
 * with inline spans mixed into prose rather than fences alone.
 *
 * WHAT THE OLD CORPUS DID. 24 identical TypeScript fences, each 18 lines of
 * `export const f = (x: number) => x * n;`. That measured one highlighter
 * grammar 24 times. highlight.js registers 193 languages and every one is a
 * separate state machine with its own keyword sets, string rules and comment
 * forms; a regression in any of the other 192 was invisible, and so was the
 * whole inline-code path, which never appeared at all.
 *
 * WHAT "MAINSTREAM" MEANS HERE. The languages a model actually emits, chosen
 * to spread across highlighter cost rather than across popularity: a language
 * with heavy string interpolation (Ruby, Kotlin), one with significant
 * whitespace (Python, YAML), one with a preprocessor (C), one whose comments
 * nest (Rust), one that is mostly punctuation (Perl, regex-heavy shell), and
 * markup where the highlighter must switch sub-grammars mid-file (HTML with
 * embedded CSS and JS).
 *
 * EVERY `lang` IS CHECKED against the installed highlight.js. A fence tagged
 * with a language the highlighter does not know renders as plain text, and a
 * corpus that claims to cover Solidity while silently getting plaintext is
 * measuring nothing — see `CODE_UNKNOWN_LANGS`, where that case is covered on
 * purpose instead of by accident.
 */

export interface CodeCase {
  readonly id: string;
  /** Fence info string, exactly as written after the backticks. */
  readonly lang: string;
  /** What this case makes the highlighter do that its siblings do not. */
  readonly probes: string;
  readonly src: string;
}

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

export const CODE_LANGUAGES: readonly CodeCase[] = [
  {
    id: 'lang-typescript',
    lang: 'typescript',
    probes: 'generics, decorators and type-level syntax the JS grammar has no rules for',
    src: `interface Chunk<T = string> {
  readonly offset: number;
  readonly payload: T;
}

export function splice<T>(prev: readonly Chunk<T>[], next: Chunk<T>): Chunk<T>[] {
  const cut = prev.findLastIndex((c) => c.offset <= next.offset);
  return [...prev.slice(0, cut + 1), next];
}`,
  },
  {
    id: 'lang-tsx',
    lang: 'tsx',
    probes: 'JSX inside TypeScript — the highlighter switches between two grammars per line',
    src: `export function Answer({ content, streaming }: Props) {
  const blocks = useMemo(() => parse(content), [content]);
  return (
    <article className="answer" aria-busy={streaming}>
      {blocks.map((b) => (
        <Block key={b.id} node={b} />
      ))}
      {streaming ? <Cursor /> : null}
    </article>
  );
}`,
  },
  {
    id: 'lang-python',
    lang: 'python',
    probes: 'significant whitespace, decorators, f-strings and triple-quoted docstrings',
    src: `from dataclasses import dataclass

@dataclass(frozen=True)
class Boundary:
    offset: int
    confirmed: bool = False

    def advance(self, text: str) -> "Boundary":
        """Move to the last newline that is safely behind the tail."""
        nl = text.rfind("\\n", self.offset)
        return Boundary(nl + 1 if nl >= 0 else self.offset, confirmed=True)

print(f"boundary at {Boundary(0).advance('a\\nb').offset}")`,
  },
  {
    id: 'lang-rust',
    lang: 'rust',
    probes: 'lifetimes, attributes and nested block comments — a comment form most grammars lack',
    src: `use std::collections::HashMap;

/// Freeze boundary for an incremental parse.
#[derive(Debug, Clone, Default)]
pub struct Scanner<'a> {
    source: &'a str,
    checkpoints: HashMap<usize, bool>,
}

impl<'a> Scanner<'a> {
    /* outer /* nested */ comment */
    pub fn advance(&mut self, to: usize) -> Option<usize> {
        self.source.get(..to)?.rfind('\\n').map(|n| n + 1)
    }
}`,
  },
  {
    id: 'lang-go',
    lang: 'go',
    probes: 'struct tags and backtick raw strings — backticks INSIDE a backtick fence',
    src: `package parser

import "encoding/json"

type Chunk struct {
	Offset  int    \`json:"offset"\`
	Payload string \`json:"payload,omitempty"\`
}

func Decode(b []byte) (*Chunk, error) {
	var c Chunk
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}`,
  },
  {
    id: 'lang-java',
    lang: 'java',
    probes: 'annotations, generics and text blocks',
    src: `package dev.example.parser;

import java.util.List;

public record Chunk(int offset, String payload) {
    public static final String USAGE = """
        parse <file>
          --incremental   reuse the frozen prefix
        """;

    public static List<Chunk> of(String... parts) {
        return List.of(parts).stream().map(p -> new Chunk(0, p)).toList();
    }
}`,
  },
  {
    id: 'lang-kotlin',
    lang: 'kotlin',
    probes: 'string templates — `$name` inside code, which the LaTeX preprocessor must not touch',
    src: `data class Chunk(val offset: Int, val payload: String)

fun render(chunks: List<Chunk>): String = buildString {
    for (c in chunks) {
        append("at \${c.offset}: \$c")
        appendLine(" (\${c.payload.length} chars)")
    }
}`,
  },
  {
    id: 'lang-swift',
    lang: 'swift',
    probes: 'optionals, protocol extensions and trailing closures',
    src: `struct Boundary: Equatable {
    let offset: Int
    var confirmed = false
}

extension Array where Element == Boundary {
    func lastConfirmed() -> Boundary? {
        last { $0.confirmed }
    }
}`,
  },
  {
    id: 'lang-c',
    lang: 'c',
    probes: 'preprocessor directives — a whole second grammar layered over the first',
    src: `#include <string.h>
#include <stdlib.h>

#define MAX_CHUNKS 512
#ifndef NDEBUG
#  define TRACE(msg) fputs((msg), stderr)
#else
#  define TRACE(msg) ((void)0)
#endif

size_t last_newline(const char *s, size_t to) {
    const char *p = memrchr(s, '\\n', to);
    return p ? (size_t)(p - s) + 1u : 0u;
}`,
  },
  {
    id: 'lang-cpp',
    lang: 'cpp',
    probes: 'templates and raw string literals with custom delimiters',
    src: `#include <optional>
#include <string_view>

template <typename T>
class Scanner {
public:
    explicit Scanner(std::string_view src) : src_(src) {}
    [[nodiscard]] std::optional<T> advance(std::size_t to) const;

private:
    std::string_view src_;
};

constexpr auto kPattern = R"regex(^\\s*\`\`\`(\\w+)?$)regex";`,
  },
  {
    id: 'lang-csharp',
    lang: 'csharp',
    probes: 'attributes, LINQ and interpolated verbatim strings',
    src: `using System.Linq;

public sealed record Chunk(int Offset, string Payload);

public static class Parser
{
    public static IEnumerable<Chunk> Confirmed(IEnumerable<Chunk> all, int upTo) =>
        all.Where(c => c.Offset <= upTo)
           .OrderBy(c => c.Offset)
           .Select(c => c with { Payload = $@"[{c.Offset}] {c.Payload}" });
}`,
  },
  {
    id: 'lang-ruby',
    lang: 'ruby',
    probes: 'symbols, blocks, heredocs and `#{}` interpolation',
    src: `# frozen_string_literal: true

class Scanner
  attr_reader :offset

  def initialize(source, offset: 0)
    @source = source
    @offset = offset
  end

  def advance!
    @offset = @source.rindex("\\n", @offset).to_i + 1
    self
  end

  def to_s = <<~TEXT
    scanner at #{@offset}
    of #{@source.length} bytes
  TEXT
end`,
  },
  {
    id: 'lang-php',
    lang: 'php',
    probes: 'the `<?php` open tag and sigil variables — a grammar that starts in HTML mode',
    src: `<?php

declare(strict_types=1);

final class Chunk
{
    public function __construct(
        public readonly int $offset,
        public readonly string $payload = '',
    ) {}

    public function __toString(): string
    {
        return "[{$this->offset}] {$this->payload}";
    }
}`,
  },
  {
    id: 'lang-scala',
    lang: 'scala',
    probes: 'pattern matching and implicit/given syntax',
    src: `case class Chunk(offset: Int, payload: String)

object Scanner:
  def advance(src: String, to: Int): Option[Int] =
    src.take(to).lastIndexOf('\\n') match
      case -1 => None
      case n  => Some(n + 1)`,
  },
  {
    id: 'lang-haskell',
    lang: 'haskell',
    probes: 'operator-dense code and layout-sensitive `where` blocks',
    src: `module Scanner (advance) where

import Data.List (findIndex)

advance :: String -> Int -> Maybe Int
advance src to
  | to <= 0   = Nothing
  | otherwise = (+ 1) <$> findIndex (== '\\n') prefix
  where
    prefix = reverse (take to src)`,
  },
  {
    id: 'lang-elixir',
    lang: 'elixir',
    probes: 'pipes, atoms and sigils — `|>` next to GFM table pipes',
    src: `defmodule Scanner do
  @moduledoc "Freeze boundary over a streamed binary."

  def advance(source, to) when is_binary(source) do
    source
    |> binary_part(0, to)
    |> String.reverse()
    |> then(&:binary.match(&1, "\\n"))
    |> case do
      {n, _} -> {:ok, to - n}
      :nomatch -> :error
    end
  end
end`,
  },
  {
    id: 'lang-clojure',
    lang: 'clojure',
    probes: 'deeply nested parens and reader macros',
    src: `(ns scanner.core
  (:require [clojure.string :as str]))

(defn advance
  "Last newline offset at or before to, else nil."
  [^String source ^long to]
  (when-let [n (str/last-index-of (subs source 0 to) "\\n")]
    (inc n)))

(comment
  (advance "a\\nb\\nc" 4) ;; => 2
  )`,
  },
  {
    id: 'lang-lua',
    lang: 'lua',
    probes: 'long-bracket strings and 1-based indexing idioms',
    src: `local Scanner = {}
Scanner.__index = Scanner

function Scanner.new(source)
  return setmetatable({ source = source, offset = 1 }, Scanner)
end

function Scanner:advance(to)
  local n = self.source:sub(1, to):find("\\n[^\\n]*$")
  self.offset = n and n + 1 or self.offset
  return self.offset
end

local usage = [[
  scanner.lua <file>
]]`,
  },
  {
    id: 'lang-shell',
    lang: 'bash',
    probes: 'variable expansion, heredocs and pipelines — punctuation-dense, and `$` everywhere',
    src: `#!/usr/bin/env bash
set -euo pipefail

corpus_root="\${1:-./corpus}"
shopt -s nullglob

for f in "\$corpus_root"/src/**/*.ts; do
  lines=\$(wc -l < "\$f")
  printf '%6d  %s\\n' "\$lines" "\${f#"\$corpus_root"/}"
done | sort -rn | head -20

cat <<'EOF' > /dev/null
literal \$100 and \\[x\\] survive a quoted heredoc
EOF`,
  },
  {
    id: 'lang-powershell',
    lang: 'powershell',
    probes: 'cmdlet casing and `$`-sigil variables in a second shell dialect',
    src: `[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CorpusRoot
)

Get-ChildItem -Path $CorpusRoot -Filter *.ts -Recurse |
    ForEach-Object {
        [pscustomobject]@{
            Name  = $_.Name
            Lines = (Get-Content $_.FullName).Count
        }
    } | Sort-Object Lines -Descending | Select-Object -First 20`,
  },
  {
    id: 'lang-r',
    lang: 'r',
    probes: 'the `<-` assignment arrow and formula syntax',
    src: `library(stats)

fit_growth <- function(bytes, ms) {
  model <- lm(log(ms) ~ log(bytes))
  list(
    exponent = unname(coef(model)[2]),
    r2 = summary(model)$r.squared
  )
}

fit_growth(c(2152, 18841, 151142, 1206784), c(18, 41, 229, 5009))`,
  },
  {
    id: 'lang-julia',
    lang: 'julia',
    probes: 'unicode identifiers and broadcasting dots',
    src: `struct Boundary
    offset::Int
    confirmed::Bool
end

function advance(source::AbstractString, to::Integer)
    idx = findlast('\\n', source[1:to])
    isnothing(idx) ? nothing : idx + 1
end

σ = 1.0
scaled = advance.(["a\\nb", "c\\nd"], 3) .* σ`,
  },
  {
    id: 'lang-perl',
    lang: 'perl',
    probes: 'regex-dense, sigil-dense code — the densest punctuation in the set',
    src: `#!/usr/bin/perl
use strict;
use warnings;

my %counts;
while (my $line = <STDIN>) {
    next if $line =~ /^\\s*#/;
    $counts{$1}++ while $line =~ /\\\\([a-zA-Z]+)/g;
}

for my $cmd (sort { $counts{$b} <=> $counts{$a} } keys %counts) {
    printf "%-20s %d\\n", $cmd, $counts{$cmd};
}`,
  },
  {
    id: 'lang-sql',
    lang: 'sql',
    probes: 'keyword-heavy with no punctuation structure to lean on',
    src: `WITH confirmed AS (
  SELECT document_id,
         MAX(offset) FILTER (WHERE confirmed) AS frozen_to,
         COUNT(*)                             AS chunks
    FROM chunk
   WHERE created_at >= NOW() - INTERVAL '1 day'
   GROUP BY document_id
)
SELECT d.id,
       d.title,
       c.frozen_to,
       ROUND(100.0 * c.frozen_to / LENGTH(d.content), 1) AS pct_frozen
  FROM document d
  JOIN confirmed c ON c.document_id = d.id
 WHERE LENGTH(d.content) > 0
 ORDER BY pct_frozen DESC
 LIMIT 20;`,
  },
  {
    id: 'lang-html',
    lang: 'html',
    probes: 'THREE grammars in one file — the highlighter switches into CSS and JS sub-modes',
    src: `<!doctype html>
<html lang="en">
  <head>
    <style>
      .answer { max-width: 65ch; font-variant-numeric: tabular-nums; }
      @media (prefers-color-scheme: dark) { :root { --bg: #111; } }
    </style>
  </head>
  <body>
    <article class="answer" data-cost="$100"></article>
    <script type="module">
      const el = document.querySelector('.answer');
      el.textContent = \`rendered \${Date.now()}\`;
    </script>
  </body>
</html>`,
  },
  {
    id: 'lang-css',
    lang: 'scss',
    probes: 'nesting, at-rules and custom properties',
    src: `@use 'sass:color';

$accent: #4f46e5;

.answer {
  --aim-gap: 0.75rem;
  display: grid;
  gap: var(--aim-gap);

  &__block + &__block { margin-block-start: var(--aim-gap); }

  @container (min-width: 40rem) {
    grid-template-columns: minmax(0, 1fr) 12rem;
  }

  code { color: color.adjust($accent, $lightness: -10%); }
}`,
  },
  {
    id: 'lang-diff',
    lang: 'diff',
    probes: 'a grammar that colours by line prefix rather than by token',
    src: `--- a/corpus/src/math/generated.ts
+++ b/corpus/src/math/generated.ts
@@ -20,7 +20,9 @@
 export const KATEX_VERSION = '0.16.47';

-export const MATH_SYMBOLS: readonly string[] = [
-  \`{\\\\equiv} \\\\quad {\\\\prec}\`,
+export const LITERAL_CHARS: readonly string[] = [
+  \`Α \\\\quad Β\`,
+];
+
+export const MATH_SYMBOLS: readonly string[] = [
+  \`{\\\\equiv} \\\\quad {\\\\prec}\`,
 ];`,
  },
  {
    id: 'lang-dockerfile',
    lang: 'dockerfile',
    probes: 'instruction keywords plus an embedded shell grammar on RUN lines',
    src: `FROM node:22-slim AS build
WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN --mount=type=cache,target=/root/.pnpm \\
    corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @bench/corpus validate && pnpm build

FROM gcr.io/distroless/nodejs22
COPY --from=build /app/dist /app/dist
CMD ["/app/dist/index.js"]`,
  },
  {
    id: 'lang-makefile',
    lang: 'makefile',
    probes: 'tab-significant recipes and `$(...)` expansion',
    src: `CORPUS := corpus
SOURCES := $(shell find $(CORPUS)/src -name '*.ts')

.PHONY: validate generate clean

validate: $(SOURCES)
	pnpm --filter @bench/corpus validate

generate:
	pnpm --filter @bench/corpus generate:math

clean:
	rm -rf $(CORPUS)/node_modules`,
  },
];

/**
 * Structured data, kept separate from programming languages because the
 * highlighter treats it differently and because a real answer quotes far more
 * of it than it quotes code.
 */
export const CODE_STRUCTURES: readonly CodeCase[] = [
  {
    id: 'data-json',
    lang: 'json',
    probes: 'deep nesting, unicode escapes and long numeric arrays',
    src: `{
  "app": "react-core",
  "throttle": 1,
  "cells": [
    { "id": "cold-short", "bytes": 2152, "ms": 18, "outcome": "settled" },
    { "id": "cold-xlong", "bytes": 1206784, "ms": 5009, "outcome": "settled" },
    { "id": "scale-xlong", "bytes": 1206784, "ms": null, "outcome": "stream-timeout" }
  ],
  "notes": { "unicode": "\\u03b1\\u03b2\\u03b3", "quote": "he said \\"fine\\"" }
}`,
  },
  {
    id: 'data-yaml',
    lang: 'yaml',
    probes: 'anchors, aliases, block scalars and significant indentation',
    src: `defaults: &defaults
  repeats: 4
  throttle: 1
  settleBetweenMs: 400

families:
  cold:
    <<: *defaults
    chunks: 1
  steps:
    <<: *defaults
    chunks: 100

notes: |
  A cold cell delivers instantly and spends its cost settling,
  so streamMs alone reports every one of them as free.`,
  },
  {
    id: 'data-toml',
    lang: 'toml',
    probes: 'table headers and typed values',
    src: `[corpus]
name = "@bench/corpus"
private = true

[corpus.math]
katex = "0.16.47"
identifiers = 1139
excluded = 6

[[corpus.mermaid.types]]
name = "flowchart"
variants = 5

[[corpus.mermaid.types]]
name = "sequenceDiagram"
variants = 3`,
  },
  {
    id: 'data-xml',
    lang: 'xml',
    probes: 'namespaces, attributes, CDATA and a processing instruction',
    src: `<?xml version="1.0" encoding="UTF-8"?>
<corpus xmlns:m="https://example.test/math">
  <m:layer name="generated" count="1139"/>
  <m:layer name="authored" count="29"/>
  <note><![CDATA[ $100 and \\[x\\] are literal here ]]></note>
</corpus>`,
  },
  {
    id: 'data-graphql',
    lang: 'graphql',
    probes: 'schema definition language — directives and non-null markers',
    src: `type Document {
  id: ID!
  content: String!
  blocks(first: Int = 20, after: String): BlockConnection!
  frozenTo: Int @deprecated(reason: "use boundary.offset")
}

interface Node { id: ID! }

union Renderable = Document | Block

input StreamFilter {
  outcome: Outcome = SETTLED
  minBytes: Int
}`,
  },
  {
    id: 'data-protobuf',
    lang: 'protobuf',
    probes: 'field numbering and nested message definitions',
    src: `syntax = "proto3";

package corpus.v1;

message Chunk {
  int32 offset = 1;
  string payload = 2;
  optional bool confirmed = 3;

  message Boundary {
    int32 offset = 1;
    repeated int32 checkpoints = 2 [packed = true];
  }
}`,
  },
  {
    id: 'data-ini',
    lang: 'ini',
    probes: 'the simplest grammar in the set — a useful low bound for highlighter cost',
    src: `[scanner]
math_flow = true
reference_taint = true

[soak]
legs = fuzz,dir,scanner,census,oracle
census_stride = 1`,
  },
];

/**
 * The fence itself, rather than what is inside it.
 *
 * These are the cases where code meets the parser rather than the
 * highlighter, and they are where this engine's fence bugs have lived: an
 * unclosed fence at the tail of a stream, a fence that contains what looks
 * like another fence, content inside a fence that looks like markdown and
 * must not be treated as any, and a tilde fence, which most corpora forget
 * exists at all.
 *
 * The three fixtures whose CONTENT is itself a fence — the tilde form, the
 * four-backtick form and the unclosed tail — cannot be expressed as a `src`
 * body and are exported separately as `TILDE_FENCE_DOC`, `NESTED_FENCE_DOC`
 * and `UNCLOSED_FENCE_DOC` at the bottom of this file.
 */
export const CODE_EDGE: readonly CodeCase[] = [
  {
    id: 'edge-no-language',
    lang: '',
    probes: 'a bare fence — no info string at all, which is what a model emits half the time',
    src: `$ pnpm --filter @bench/corpus validate
[corpus] ALL CLEAN`,
  },
  {
    id: 'edge-markdown-inside',
    lang: 'markdown',
    probes: 'headings, tables and list markers INSIDE a fence, none of which may be parsed',
    src: `# Not a heading

| not | a | table |
| --- | --- | --- |
| a | b | c |

- not a list item
> not a quote

[not a link](http://example.test)`,
  },
  {
    id: 'edge-long-lines',
    lang: 'text',
    probes: 'a single line far wider than any viewport — horizontal overflow, not wrapping',
    src: `SELECT d.id, d.title, c.frozen_to, c.chunks, ROUND(100.0 * c.frozen_to / LENGTH(d.content), 1) AS pct_frozen, d.created_at, d.updated_at, d.session_id, d.author_id FROM document d JOIN confirmed c ON c.document_id = d.id WHERE LENGTH(d.content) > 0 AND d.created_at >= NOW() - INTERVAL '30 days' ORDER BY pct_frozen DESC, d.updated_at DESC LIMIT 100;`,
  },
  {
    id: 'edge-cjk-in-code',
    lang: 'python',
    probes: 'wide characters inside code — column alignment and measurement, not just glyphs',
    src: `# 冻结边界：只扫新确认的行
边界 = {"偏移": 0, "已确认": False}

def 推进(文本: str, 到: int) -> int:
    """返回小于等于 \`到\` 的最后一个换行位置。"""
    位置 = 文本.rfind("\\n", 0, 到)
    return 位置 + 1 if 位置 >= 0 else 边界["偏移"]

print(f"边界 → {推进('甲\\n乙\\n丙', 4)}")`,
  },
];

/**
 * Languages the installed highlight.js does NOT register, covered on purpose.
 *
 * A fence tagged with an unknown language renders as plain text, and that is
 * a real path with real behaviour: no `<span>` tokens, a different DOM shape,
 * a different cost. It is worth measuring, and it is worth doing deliberately
 * rather than discovering that a language you thought was covered has been
 * silently falling through. Verified unregistered at the time of writing;
 * the gate re-checks, so promoting one to `CODE_LANGUAGES` is a decision
 * someone makes, not something that happens.
 */
export const CODE_UNKNOWN_LANGS: readonly string[] = ['solidity', 'zig', 'asm'];

/**
 * Inline code, which the old corpus contained none of.
 *
 * Inline spans are not small fences: they take a different path, they sit
 * inside flowing text where the LaTeX and CJK preprocessors are also
 * operating, and the multi-backtick form exists precisely so a span can
 * contain a backtick. Every hazard below is a character some other rule in
 * this pipeline wants to rewrite.
 */
export const CODE_INLINE: readonly CodeCase[] = [
  {
    id: 'inline-plain',
    lang: '',
    probes: 'ordinary inline spans at realistic density in prose',
    src: `Call \`computeFreezeBoundary(text, options, resume)\` and read \`result.offset\`. The \`resume\` argument is a \`FreezeScanCheckpoint\`, and passing \`null\` restarts the scan from zero rather than from \`cp.confirmedOffset\`.`,
  },
  {
    id: 'inline-hazards',
    lang: '',
    probes: 'a span containing every character another rule wants to rewrite: $, |, _, \\, ==',
    src: `Use \`$100\` for a literal price, \`P(A|B)\` for a conditional, \`max_depth\` for the field, \`\\[x\\]\` for the escaped brackets, and \`==mark==\` for the highlight syntax. None of them may be rewritten.`,
  },
  {
    id: 'inline-backtick-inside',
    lang: '',
    probes: 'the multi-backtick form — the only way to put a backtick inside a span',
    src: 'Write `` `x` `` to show a span, ``` `` ` `` ``` to show two, and `` a`b `` when an identifier contains one.',
  },
  {
    id: 'inline-in-table',
    lang: '',
    probes: 'inline code inside GFM table cells, where a pipe inside the span is the whole problem',
    src: `| Expression | Meaning |
| --- | --- |
| \`a \\| b\` | alternation |
| \`P(A\\|B)\` | conditional |
| \`$100\` | a literal price |`,
  },
  {
    id: 'inline-cjk-boundary',
    lang: '',
    probes: 'inline code against CJK with no space — where remark-pangu and cjk-friendly both act',
    src: '调用`computeFreezeBoundary`并读取`result.offset`，其中`resume`参数是`FreezeScanCheckpoint`类型，传`null`表示从零重扫。',
  },
];

/**
 * Two fixtures that cannot be written as template literals, because their
 * content is a fence.
 *
 * A backtick fence inside a backtick-delimited template string terminates it,
 * and escaping every backtick would make the fixture unreadable and easy to
 * get subtly wrong. Assembled from parts instead, which is also self-
 * documenting: the assembly shows exactly which characters are the fence.
 */
const BT = '`'.repeat(3);
const BT4 = '`'.repeat(4);
const TILDE = '~'.repeat(3);

/** A tilde fence quoting a backtick fence — the reason tilde fences exist. */
export const TILDE_FENCE_DOC = `${TILDE}markdown
Here is how you write a fence:

${BT}ts
const x = 1;
${BT}
${TILDE}`;

/** A four-backtick fence quoting a three-backtick one. */
export const NESTED_FENCE_DOC = `${BT4}markdown
${BT}python
print("inner")
${BT}
${BT4}`;

/** A stream that stopped inside a fence: opener present, closer never arrived. */
export const UNCLOSED_FENCE_DOC = `Here is the implementation:

${BT}typescript
export function advance(text: string, to: number): number {
  const nl = text.lastIndexOf('\\n', to);`;
