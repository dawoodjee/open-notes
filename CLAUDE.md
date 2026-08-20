# Project rules

## Who I am
I know plain JavaScript, HTML, and CSS well. I'm new to TypeScript, npm, Expo/React Native, NativeWind, Gluestack UI, Supabase, and PowerSync. Treat unfamiliar concepts as things to teach concisely, not just implement.

## Branching
Every stage or feature gets its own branch off main. Tell me the branch name when you start. Merge to main only when the stage checkpoint passes — never commit directly to main.

## Before writing code
For anything beyond a trivial fix, enter Plan Mode and pause for review. The plan must explain what you're about to do and why in beginner terms. If a step touches a tool I haven't used yet in this project, teach it — with a short example where it helps.

## While executing
Keep your todo list concrete and current. If reality diverges from the approved plan, stop and tell me rather than improvising.

## When you finish
Write a plain-language summary of every file you changed, tied to the underlying concept — the lesson for that step, not a changelog. Claude Code won't surface this automatically, so it's on you to always include it.

## Decisions
Default to deciding and moving. Choices that are cheap to reverse — file placement, naming, internal structure, how to factor a function, which built-in helper to use — just make them and note the call in one line in your summary. Don't stop for these.

Escalate before acting only when a choice is expensive to undo or changes something I'd notice as a user: data shape and schema, new dependencies, auth or security properties, sync and conflict behavior, or anything that changes stored data or visible product behavior. For those, tell me plainly and concisely — the options, your recommendation, and the tradeoff. I make that call.

The test when unsure: would undoing this in two weeks take minutes or days? Minutes, decide. Days, ask. And if I explicitly delegate a decision in a prompt ("decide and implement"), that overrides all of the above — just make the call.

When I accept a tradeoff on an escalated decision, record it in the Decisions Log in `mvp-build-plan.md` — the decision, the reasoning, and the consequence I accepted — before moving on.

## Verification
Prove things rather than asserting them: use the terminal to run, boot, query, or test what you built, and show me the result.

## Compact Instructions

When compacting — automatic or manual — write a state snapshot, not a narrative
recap. If the current stage is complete, don't compact: write outcomes into
`mvp-build-plan.md`, commit, merge, `/clear`. A written handoff is inspectable;
a summary isn't.

Anything already committed or written to a file is durable — reference it by
path rather than re-summarizing it. Preserve only what exists nowhere but this
conversation. Compaction is lossy, so preserve in this order:

1. **Position** — current stage, branch name, and whether its checkpoint has passed.
2. **Uncommitted work** — every file touched this session and what changed in
   each. Not "updated the schema," but which columns/fields, in which file, and
   what's still unfinished.
3. **Decisions, with reasoning and tradeoff** — especially anything escalated to
   me under the Decisions rule and what I chose. Never silently drop an accepted
   tradeoff; a decision without its tradeoff gets relitigated. Anything already
   written to the Decisions Log in `mvp-build-plan.md` is durable — reference it
   by name, don't re-summarize it. Preserve decisions made this session that
   haven't been written down yet.
4. **Cross-stage deferrals** — what was deferred, which stage it lands in, and
   what forces it then. The landing stage is the half that goes missing and
   resurfaces as rework, so never record a deferral without it. Deferrals
   already captured in `mvp-build-plan.md` are durable — reference by path.
5. **Verification actually run** — which command, what it proved. Not "tests passed."
6. **Errors verbatim** — never paraphrased, never summarized.
7. **Open questions** — including concepts I asked about that aren't yet settled.

Fine to drop: exploratory dead ends that didn't change a decision, restated
explanations of concepts already taught this session, superseded plans once the
final approach is captured, and tool output already acted on.

Terse structured notes under these headings. Not prose. If a fact would need to
be looked up again to act on it, it wasn't preserved.

## Front-load what needs me
Before starting execution, list everything in the task that will need my hands or my approval — physical device access, credentials, dashboard logins, OAuth consent screens, email verification codes, destructive steps needing sign-off — and get all of it done or confirmed up front. Don't discover these one at a time mid-run and stall waiting on me; by then I've likely stopped watching and the run sits idle. If something genuinely can't be front-loaded, say so and tell me exactly when in the run it will come up.

## Balance
Teach densely, not lengthily — maximum learning per word, and keep momentum. Concise is not shallow: compress the explanation, never the substance. Skip preamble, restatement of what the diff already shows, and boilerplate caveats.

Calibrate depth to novelty: go deep the first time a concept appears, one-line reminder on reuse. Prioritize what I couldn't have guessed — why this approach over the obvious alternative, what breaks otherwise, the gotcha specific to this tool. Don't pad to look thorough; the test is whether I could rebuild it myself, not length. Write complete working code in one pass — no teaching stubs or TODOs, since each checkpoint needs a real, testable result.

## Context discipline
Don't read node_modules/, android/, ios/, .expo/, assets/, or lock files unless I explicitly ask or a native build is actually broken. components/ui/ is generated Gluestack code — read a specific file if you need it, never the whole directory. Prefer targeted Grep/Glob over broad directory reads.

## Follow-up questions
If I ask "why" or push back, that's a continuation of the conversation, not a new task — answer in chat and only touch code again once I say to proceed.

## Environments
There are two backends — a wipeable local dev stack and a live cloud stack holding my real notes. Read `docs/two-stacks.md` before touching server config, migrations, sync rules, or builds.
