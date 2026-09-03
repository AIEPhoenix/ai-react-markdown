# seam-unclosed-tail

A stream that stops mid-formula — the trailing unclosed block is truncated.

It is its own document because it opens a construct it never closes, and
anything after it would be swallowed. But that is only why it is SEPARATE.

Why it EXISTS: it is the positive control for the tail-sentinel gate. That
gate appends a sentinel heading to every document and requires it to survive;
these two are the only documents required to EAT it. Without them the
detector never sees a document that swallows, so it could return "the tail
survived" unconditionally and the whole gate would still pass — measured, by
mutating it to do exactly that: these two files were the only failures.

So the emptiness is the point. Do not add content after the open construct to
"make it a better test": the gate supplies what gets swallowed, and content of
its own would only be swallowed too.

Here is the derivation so far.

$$
\frac{\partial}{\partial x} \left( 
