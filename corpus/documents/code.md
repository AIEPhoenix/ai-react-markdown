# Code corpus

Languages chosen to spread across highlighter cost rather than across
popularity, plus the two paths a fence-only corpus never reaches: inline
spans, and the fence itself.

## Programming languages

### lang-typescript

Generics, decorators and type-level syntax the JS grammar has no rules for.

```typescript
interface Chunk<T = string> {
  readonly offset: number;
  readonly payload: T;
}

export function splice<T>(prev: readonly Chunk<T>[], next: Chunk<T>): Chunk<T>[] {
  const cut = prev.findLastIndex((c) => c.offset <= next.offset);
  return [...prev.slice(0, cut + 1), next];
}
```

### lang-tsx

JSX inside TypeScript — the highlighter switches between two grammars per line.

```tsx
export function Answer({ content, streaming }: Props) {
  const blocks = useMemo(() => parse(content), [content]);
  return (
    <article className="answer" aria-busy={streaming}>
      {blocks.map((b) => (
        <Block key={b.id} node={b} />
      ))}
      {streaming ? <Cursor /> : null}
    </article>
  );
}
```

### lang-python

Significant whitespace, decorators, f-strings and triple-quoted docstrings.

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Boundary:
    offset: int
    confirmed: bool = False

    def advance(self, text: str) -> "Boundary":
        """Move to the last newline that is safely behind the tail."""
        nl = text.rfind("\n", self.offset)
        return Boundary(nl + 1 if nl >= 0 else self.offset, confirmed=True)

print(f"boundary at {Boundary(0).advance('a\nb').offset}")
```

### lang-rust

Lifetimes, attributes and nested block comments — a comment form most grammars lack.

```rust
use std::collections::HashMap;

/// Freeze boundary for an incremental parse.
#[derive(Debug, Clone, Default)]
pub struct Scanner<'a> {
    source: &'a str,
    checkpoints: HashMap<usize, bool>,
}

impl<'a> Scanner<'a> {
    /* outer /* nested */ comment */
    pub fn advance(&mut self, to: usize) -> Option<usize> {
        self.source.get(..to)?.rfind('\n').map(|n| n + 1)
    }
}
```

### lang-go

Struct tags and backtick raw strings — backticks INSIDE a backtick fence.

```go
package parser

import "encoding/json"

type Chunk struct {
	Offset  int    `json:"offset"`
	Payload string `json:"payload,omitempty"`
}

func Decode(b []byte) (*Chunk, error) {
	var c Chunk
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}
```

### lang-java

Annotations, generics and text blocks.

```java
package dev.example.parser;

import java.util.List;

public record Chunk(int offset, String payload) {
    public static final String USAGE = """
        parse <file>
          --incremental   reuse the frozen prefix
        """;

    public static List<Chunk> of(String... parts) {
        return List.of(parts).stream().map(p -> new Chunk(0, p)).toList();
    }
}
```

### lang-kotlin

String templates — `$name` inside code, which the LaTeX preprocessor must not touch.

```kotlin
data class Chunk(val offset: Int, val payload: String)

fun render(chunks: List<Chunk>): String = buildString {
    for (c in chunks) {
        append("at ${c.offset}: $c")
        appendLine(" (${c.payload.length} chars)")
    }
}
```

### lang-swift

Optionals, protocol extensions and trailing closures.

```swift
struct Boundary: Equatable {
    let offset: Int
    var confirmed = false
}

extension Array where Element == Boundary {
    func lastConfirmed() -> Boundary? {
        last { $0.confirmed }
    }
}
```

### lang-c

Preprocessor directives — a whole second grammar layered over the first.

```c
#include <string.h>
#include <stdlib.h>

#define MAX_CHUNKS 512
#ifndef NDEBUG
#  define TRACE(msg) fputs((msg), stderr)
#else
#  define TRACE(msg) ((void)0)
#endif

size_t last_newline(const char *s, size_t to) {
    const char *p = memrchr(s, '\n', to);
    return p ? (size_t)(p - s) + 1u : 0u;
}
```

### lang-cpp

Templates and raw string literals with custom delimiters.

```cpp
#include <optional>
#include <string_view>

template <typename T>
class Scanner {
public:
    explicit Scanner(std::string_view src) : src_(src) {}
    [[nodiscard]] std::optional<T> advance(std::size_t to) const;

private:
    std::string_view src_;
};

constexpr auto kPattern = R"regex(^\s*```(\w+)?$)regex";
```

### lang-csharp

Attributes, LINQ and interpolated verbatim strings.

```csharp
using System.Linq;

public sealed record Chunk(int Offset, string Payload);

public static class Parser
{
    public static IEnumerable<Chunk> Confirmed(IEnumerable<Chunk> all, int upTo) =>
        all.Where(c => c.Offset <= upTo)
           .OrderBy(c => c.Offset)
           .Select(c => c with { Payload = $@"[{c.Offset}] {c.Payload}" });
}
```

### lang-ruby

Symbols, blocks, heredocs and `#{}` interpolation.

```ruby
# frozen_string_literal: true

class Scanner
  attr_reader :offset

  def initialize(source, offset: 0)
    @source = source
    @offset = offset
  end

  def advance!
    @offset = @source.rindex("\n", @offset).to_i + 1
    self
  end

  def to_s = <<~TEXT
    scanner at #{@offset}
    of #{@source.length} bytes
  TEXT
end
```

### lang-php

The `<?php` open tag and sigil variables — a grammar that starts in HTML mode.

```php
<?php

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
}
```

### lang-scala

Pattern matching and implicit/given syntax.

```scala
case class Chunk(offset: Int, payload: String)

object Scanner:
  def advance(src: String, to: Int): Option[Int] =
    src.take(to).lastIndexOf('\n') match
      case -1 => None
      case n  => Some(n + 1)
```

### lang-haskell

Operator-dense code and layout-sensitive `where` blocks.

```haskell
module Scanner (advance) where

import Data.List (findIndex)

advance :: String -> Int -> Maybe Int
advance src to
  | to <= 0   = Nothing
  | otherwise = (+ 1) <$> findIndex (== '\n') prefix
  where
    prefix = reverse (take to src)
```

### lang-elixir

Pipes, atoms and sigils — `|>` next to GFM table pipes.

```elixir
defmodule Scanner do
  @moduledoc "Freeze boundary over a streamed binary."

  def advance(source, to) when is_binary(source) do
    source
    |> binary_part(0, to)
    |> String.reverse()
    |> then(&:binary.match(&1, "\n"))
    |> case do
      {n, _} -> {:ok, to - n}
      :nomatch -> :error
    end
  end
end
```

### lang-clojure

Deeply nested parens and reader macros.

```clojure
(ns scanner.core
  (:require [clojure.string :as str]))

(defn advance
  "Last newline offset at or before to, else nil."
  [^String source ^long to]
  (when-let [n (str/last-index-of (subs source 0 to) "\n")]
    (inc n)))

(comment
  (advance "a\nb\nc" 4) ;; => 2
  )
```

### lang-lua

Long-bracket strings and 1-based indexing idioms.

```lua
local Scanner = {}
Scanner.__index = Scanner

function Scanner.new(source)
  return setmetatable({ source = source, offset = 1 }, Scanner)
end

function Scanner:advance(to)
  local n = self.source:sub(1, to):find("\n[^\n]*$")
  self.offset = n and n + 1 or self.offset
  return self.offset
end

local usage = [[
  scanner.lua <file>
]]
```

### lang-shell

Variable expansion, heredocs and pipelines — punctuation-dense, and `$` everywhere.

```bash
#!/usr/bin/env bash
set -euo pipefail

corpus_root="${1:-./corpus}"
shopt -s nullglob

for f in "$corpus_root"/src/**/*.ts; do
  lines=$(wc -l < "$f")
  printf '%6d  %s\n' "$lines" "${f#"$corpus_root"/}"
done | sort -rn | head -20

cat <<'EOF' > /dev/null
literal $100 and \[x\] survive a quoted heredoc
EOF
```

### lang-powershell

Cmdlet casing and `$`-sigil variables in a second shell dialect.

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CorpusRoot
)

Get-ChildItem -Path $CorpusRoot -Filter *.ts -Recurse |
    ForEach-Object {
        [pscustomobject]@{
            Name  = $_.Name
            Lines = (Get-Content $_.FullName).Count
        }
    } | Sort-Object Lines -Descending | Select-Object -First 20
```

### lang-r

The `<-` assignment arrow and formula syntax.

```r
library(stats)

fit_growth <- function(bytes, ms) {
  model <- lm(log(ms) ~ log(bytes))
  list(
    exponent = unname(coef(model)[2]),
    r2 = summary(model)$r.squared
  )
}

fit_growth(c(2152, 18841, 151142, 1206784), c(18, 41, 229, 5009))
```

### lang-julia

Unicode identifiers and broadcasting dots.

```julia
struct Boundary
    offset::Int
    confirmed::Bool
end

function advance(source::AbstractString, to::Integer)
    idx = findlast('\n', source[1:to])
    isnothing(idx) ? nothing : idx + 1
end

σ = 1.0
scaled = advance.(["a\nb", "c\nd"], 3) .* σ
```

### lang-perl

Regex-dense, sigil-dense code — the densest punctuation in the set.

```perl
#!/usr/bin/perl
use strict;
use warnings;

my %counts;
while (my $line = <STDIN>) {
    next if $line =~ /^\s*#/;
    $counts{$1}++ while $line =~ /\\([a-zA-Z]+)/g;
}

for my $cmd (sort { $counts{$b} <=> $counts{$a} } keys %counts) {
    printf "%-20s %d\n", $cmd, $counts{$cmd};
}
```

### lang-sql

Keyword-heavy with no punctuation structure to lean on.

```sql
WITH confirmed AS (
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
 LIMIT 20;
```

### lang-html

THREE grammars in one file — the highlighter switches into CSS and JS sub-modes.

```html
<!doctype html>
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
      el.textContent = `rendered ${Date.now()}`;
    </script>
  </body>
</html>
```

### lang-css

Nesting, at-rules and custom properties.

```scss
@use 'sass:color';

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
}
```

### lang-diff

A grammar that colours by line prefix rather than by token.

```diff
--- a/corpus/src/math/generated.ts
+++ b/corpus/src/math/generated.ts
@@ -20,7 +20,9 @@
 export const KATEX_VERSION = '0.16.47';

-export const MATH_SYMBOLS: readonly string[] = [
-  `{\\equiv} \\quad {\\prec}`,
+export const LITERAL_CHARS: readonly string[] = [
+  `Α \\quad Β`,
+];
+
+export const MATH_SYMBOLS: readonly string[] = [
+  `{\\equiv} \\quad {\\prec}`,
 ];
```

### lang-dockerfile

Instruction keywords plus an embedded shell grammar on RUN lines.

```dockerfile
FROM node:22-slim AS build
WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN --mount=type=cache,target=/root/.pnpm \
    corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @bench/corpus validate && pnpm build

FROM gcr.io/distroless/nodejs22
COPY --from=build /app/dist /app/dist
CMD ["/app/dist/index.js"]
```

### lang-makefile

Tab-significant recipes and `$(...)` expansion.

```makefile
CORPUS := corpus
SOURCES := $(shell find $(CORPUS)/src -name '*.ts')

.PHONY: validate generate clean

validate: $(SOURCES)
	pnpm --filter @bench/corpus validate

generate:
	pnpm --filter @bench/corpus generate:math

clean:
	rm -rf $(CORPUS)/node_modules
```


## Structured data

### data-json

Deep nesting, unicode escapes and long numeric arrays.

```json
{
  "app": "react-core",
  "throttle": 1,
  "cells": [
    { "id": "cold-short", "bytes": 2152, "ms": 18, "outcome": "settled" },
    { "id": "cold-xlong", "bytes": 1206784, "ms": 5009, "outcome": "settled" },
    { "id": "scale-xlong", "bytes": 1206784, "ms": null, "outcome": "stream-timeout" }
  ],
  "notes": { "unicode": "\u03b1\u03b2\u03b3", "quote": "he said \"fine\"" }
}
```

### data-yaml

Anchors, aliases, block scalars and significant indentation.

```yaml
defaults: &defaults
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
  so streamMs alone reports every one of them as free.
```

### data-toml

Table headers and typed values.

```toml
[corpus]
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
variants = 3
```

### data-xml

Namespaces, attributes, CDATA and a processing instruction.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<corpus xmlns:m="https://example.test/math">
  <m:layer name="generated" count="1139"/>
  <m:layer name="authored" count="29"/>
  <note><![CDATA[ $100 and \[x\] are literal here ]]></note>
</corpus>
```

### data-graphql

Schema definition language — directives and non-null markers.

```graphql
type Document {
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
}
```

### data-protobuf

Field numbering and nested message definitions.

```protobuf
syntax = "proto3";

package corpus.v1;

message Chunk {
  int32 offset = 1;
  string payload = 2;
  optional bool confirmed = 3;

  message Boundary {
    int32 offset = 1;
    repeated int32 checkpoints = 2 [packed = true];
  }
}
```

### data-ini

The simplest grammar in the set — a useful low bound for highlighter cost.

```ini
[scanner]
math_flow = true
reference_taint = true

[soak]
legs = fuzz,dir,scanner,census,oracle
census_stride = 1
```


## Inline code

Not small fences. These sit in flowing text where the LaTeX, CJK and pangu preprocessors all operate.

### inline-plain

Ordinary inline spans at realistic density in prose.

Call `computeFreezeBoundary(text, options, resume)` and read `result.offset`. The `resume` argument is a `FreezeScanCheckpoint`, and passing `null` restarts the scan from zero rather than from `cp.confirmedOffset`.

### inline-hazards

A span containing every character another rule wants to rewrite: $, |, _, \, ==.

Use `$100` for a literal price, `P(A|B)` for a conditional, `max_depth` for the field, `\[x\]` for the escaped brackets, and `==mark==` for the highlight syntax. None of them may be rewritten.

### inline-backtick-inside

The multi-backtick form — the only way to put a backtick inside a span.

Write `` `x` `` to show a span, ``` `` ` `` ``` to show two, and `` a`b `` when an identifier contains one.

### inline-in-table

Inline code inside GFM table cells, where a pipe inside the span is the whole problem.

| Expression | Meaning |
| --- | --- |
| `a \| b` | alternation |
| `P(A\|B)` | conditional |
| `$100` | a literal price |

### inline-cjk-boundary

Inline code against CJK with no space — where remark-pangu and cjk-friendly both act.

调用`computeFreezeBoundary`并读取`result.offset`，其中`resume`参数是`FreezeScanCheckpoint`类型，传`null`表示从零重扫。


## Fence edge cases

### edge-no-language

A bare fence — no info string at all, which is what a model emits half the time.

```
$ pnpm --filter @bench/corpus validate
[corpus] ALL CLEAN
```

### edge-markdown-inside

Headings, tables and list markers INSIDE a fence, none of which may be parsed.

```markdown
# Not a heading

| not | a | table |
| --- | --- | --- |
| a | b | c |

- not a list item
> not a quote

[not a link](http://example.test)
```

### edge-long-lines

A single line far wider than any viewport — horizontal overflow, not wrapping.

```text
SELECT d.id, d.title, c.frozen_to, c.chunks, ROUND(100.0 * c.frozen_to / LENGTH(d.content), 1) AS pct_frozen, d.created_at, d.updated_at, d.session_id, d.author_id FROM document d JOIN confirmed c ON c.document_id = d.id WHERE LENGTH(d.content) > 0 AND d.created_at >= NOW() - INTERVAL '30 days' ORDER BY pct_frozen DESC, d.updated_at DESC LIMIT 100;
```

### edge-cjk-in-code

Wide characters inside code — column alignment and measurement, not just glyphs.

```python
# 冻结边界：只扫新确认的行
边界 = {"偏移": 0, "已确认": False}

def 推进(文本: str, 到: int) -> int:
    """返回小于等于 `到` 的最后一个换行位置。"""
    位置 = 文本.rfind("\n", 0, 到)
    return 位置 + 1 if 位置 >= 0 else 边界["偏移"]

print(f"边界 → {推进('甲\n乙\n丙', 4)}")
```


## Fences whose content is a fence

### edge-tilde-fence

A tilde fence quoting a backtick fence — the reason tilde fences exist.

~~~markdown
Here is how you write a fence:

```ts
const x = 1;
```
~~~

### edge-nested-fence

A four-backtick fence quoting a three-backtick one.

````markdown
```python
print("inner")
```
````
> The unclosed-fence fixture is `code-unclosed-fence.md`, for the same reason
> the unclosed math blocks have documents of their own.
