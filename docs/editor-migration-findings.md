# Stage 11.5 Phase 0 — editor migration spike findings

**Date:** 2026-08-22
**Branch:** `spike/enriched-editor` (throwaway, not merged)
**Question:** should `@10play/tentap-editor` be replaced by `react-native-enriched-html`?

## Verdict: **NO-GO**

Do not migrate. Stay on TenTap. The library corrupts this app's data in a way
that is silent, reproducible, and hits the most common note shape there is.

The tiptap workarounds this migration was meant to remove — the `react-dom`
18→19 `overrides` block in `package.json` and the `<h1></h1>`/`<p></p>`
empty-document handling in `types/note.ts` — therefore **stay**. Pulling the
override while TenTap is still installed re-breaks the duplicate-native-module
check that fails EAS builds.

## How this was tested

Not by reading docs. `react-native-enriched-html@1.1.1` was installed for real,
iOS was rebuilt natively (build succeeded, 0 errors), and a throwaway route at
`app/spike-editor.tsx` fed HTML through `EnrichedTextInput.setValue()` and read
it back with `getHTML()`.

Results were POSTed to a local collector rather than rendered on screen, because
the answer is a byte-level diff of two HTML strings and reading that off a
screenshot is guesswork. Every finding below is an exact recorded string.

Two categories were tested: 22 synthetic samples covering every construct TenTap
emits, and **the three real notes in the local database**. The whole run was
repeated once; results were identical both times.

## Finding 1 — short documents are silently turned into literal text (fatal)

`setValue()` applies a heuristic to decide whether its argument is HTML or plain
text, and the heuristic is **input string length**. At or below ~12 characters
the markup is escaped and shown to the user as visible text.

| Input | Length | Output | |
|---|---|---|---|
| `<h1></h1>` | 9 | `<p>&lt;h1&gt;&lt;/h1&gt;</p>` | escaped |
| `<h1>r</h1>` | 10 | `<p>&lt;h1&gt;r&lt;/h1&gt;</p>` | escaped |
| `<h1>rr</h1>` | 11 | `<p>&lt;h1&gt;rr&lt;/h1&gt;</p>` | escaped |
| `<h1>rrr</h1>` | 12 | `<p>&lt;h1&gt;rrr&lt;/h1&gt;</p>` | escaped |
| `<p>rrrrr</p>` | 12 | `<p>&lt;p&gt;rrrrr&lt;/p&gt;</p>` | escaped |
| `<h1>Note</h1>` | 13 | `<h1>Note</h1>` | parsed |
| `<h1>rrrrr</h1>` | 14 | `<h1>rrrrr</h1>` | parsed |
| `<h1>r</h1><p>body text here</p>` | 31 | correct | parsed |

Every data point fits a threshold between 12 and 13 characters of *total input*,
not of text content — which is why `<p>rrrrr</p>` fails while `<h1>rrrrr</h1>`
succeeds at the same content length.

**This is not a synthetic edge case.** One of the three real notes in the
database is `<h1>r</h1>`, and it round-tripped to
`<p>&lt;h1&gt;r&lt;/h1&gt;</p>`. In the app that note would stop showing a title
and start showing the literal text `<h1>r</h1>`.

The shapes this destroys are the common ones in a notes app:

- every **brand-new note** — TenTap seeds `<h1></h1>`;
- every **title-only note** with a short title and no body;
- any one-word note.

It also breaks `isBlankNote()` (`types/note.ts`), which is what decides whether
a note is **permanently deleted** rather than trashed. A blank note would stop
reading as blank, because it now contains visible text.

## Finding 2 — nested lists are flattened (data loss)

Documented upstream as "one level only". What that means in practice is that the
hierarchy is not rejected, it is silently discarded:

```
in:  <ul><li><p>parent</p><ul><li><p>child</p><ul><li><p>grandchild</p>…
out: <ul><li>parent</li><li>child</li><li>grandchild</li></ul>
```

Three levels collapse to one, with no error. Stage 12 plans indent/outdent on
list items, which this would make unimplementable.

## Finding 3 — highlight and text colour are dropped, which removes the reason for choosing HTML

This is the finding that changes the earlier decision.

```
<p><mark>highlighted</mark></p>              ->  <p>highlighted</p>
<p><span style="color: #ff0000">red</span></p> -> <p>red</p>
```

HTML was chosen over Markdown **specifically because** `formatting-toolbar-desktop.png`
and `mobile-navbar-default-aa-undo-redo.png` show underline, highlight and text
colour, and Markdown cannot represent the last two. It turns out
`react-native-enriched-html` cannot represent them either — its entire supported
style set is fixed and enumerated in its own types as `TextShortcutStyle`:
bold, italic, underline, strikethrough, inline_code, h1–h6, blockquote,
codeblock, unordered_list, ordered_list, checkbox_list. There is no `mark` and
no colour span in `HtmlStyle` either.

So the HTML-vs-Markdown argument was decided on a premise that does not hold for
this library. Underline survives; highlight and colour do not, in either format.

## Finding 4 — the stored format would change on every note

Even where content survives, the output is not the input:

- everything is wrapped in `<html>\n…\n</html>` with inserted newlines;
- `<strong>`→`<b>`, `<em>`→`<i>`;
- `<pre><code>` → `<codeblock>`, which is **not a real HTML tag**;
- `<li><p>x</p></li>` → `<li>x</li>`;
- task lists lose their checked state: `<ul data-type="taskList"><li data-checked="true">`
  → `<ul><li>…</li></ul>`.

None of this is fatal on its own, but it means every note is rewritten in a new
dialect the first time it is opened — a de facto data migration of the whole
corpus, arriving as a side effect rather than as a deliberate step.

## Finding 5 — performance is fine

A 500-paragraph note (34,903 chars) round-tripped in **1,992 ms**, output 35,418
chars. Not a blocker, and not the reason for the NO-GO.

## What the library is good at

Worth recording, because this is a "not yet" rather than a "never":

- Genuinely native, no WebView.
- Rich imperative API that is a close fit for Stage 12's toolbar —
  `toggleBold/Italic/Underline/StrikeThrough/InlineCode`, `toggleH1`–`toggleH6`,
  `toggleCodeBlock`, `toggleBlockQuote`, `toggleOrdered/Unordered/CheckboxList`,
  `setLink`, `removeLink`, `setImage` — plus `onChangeState` for active-button
  highlighting.
- Separate web implementation (`index.d.ts` vs `index.native.d.ts`), so web is a
  real target rather than an afterthought.
- Supports RN 0.81 on the 1.1.x line; New Architecture required, which this app
  already uses. It installed and built cleanly on iOS with no configuration.

## Recommendation

1. **Stay on TenTap.** Stage 11.5 does not proceed. Stage 12's formatting
   toolbar is built against TenTap's bridge, as originally planned before this
   stage was inserted.
2. **Report Finding 1 upstream.** A length-based HTML-vs-plain-text heuristic in
   `setValue` is a bug, not a design choice, and it has a two-line reproduction.
   Re-evaluate if it is fixed — the rest of the library is a good fit.
3. **Findings 2 and 3 are the deeper blockers** and would remain even if
   Finding 1 were fixed. Nested lists and highlight/colour would have to arrive
   upstream before this migration is worth revisiting.
4. **Stage 13 keeps its own problem.** Dropping the WebView was going to help web
   parity; it doesn't happen, so the `@powersync/web` at-rest spike and the
   `Appearance.setColorScheme` boot failure are unchanged.
