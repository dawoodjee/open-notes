# Project rules

## Who I am
I know plain JavaScript, HTML, and CSS well. I'm new to TypeScript, npm, Expo/React Native, NativeWind, Gluestack UI, Supabase, and PowerSync. Treat unfamiliar concepts as things to teach, not just implement.

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

## Verification
Prove things rather than asserting them: use the terminal to run, boot, query, or test what you built, and show me the result.

## Compact Instructions
When compacting — automatic or manual — write a state snapshot, not a narrative recap. Preserve, exactly rather than paraphrased:
- Current stage, branch name, and whether its checkpoint has passed.
- Every file touched this session and what changed in each — not "updated the schema," but which columns/fields, in which file.
- Every decision made and its stated reasoning and tradeoff, especially anything from the Decisions rule that was escalated to me and what I chose. Never silently drop an accepted tradeoff (e.g., the PIN-wraps-a-key model's stated consequence, the no-SMS/WhatsApp call, the username case-insensitivity/ASCII rules) — these are load-bearing for later stages.
- Verification actually run and its real result — which command, what it proved — not "tests passed."
- Error messages verbatim, not summarized.
- Open questions, unresolved errors, and anything explicitly deferred (web platform, Phase 2 items).

Fine to drop: exploratory dead ends that didn't change a decision, restated explanations of concepts already taught earlier this session, and superseded plans once the final approach is captured.

## Balance
Teach densely, not lengthily — maximum learning per word, and keep momentum. Concise is not shallow: compress the explanation, never the substance. Skip preamble, restatement of what the diff already shows, and boilerplate caveats.

Calibrate depth to novelty: go deep the first time a concept appears, one-line reminder on reuse. Prioritize what I couldn't have guessed — why this approach over the obvious alternative, what breaks otherwise, the gotcha specific to this tool. Don't pad to look thorough; the test is whether I could rebuild it myself, not length. Write complete working code in one pass — no teaching stubs or TODOs, since each checkpoint needs a real, testable result.

## Context discipline
Don't read node_modules/, android/, ios/, .expo/, assets/, or lock files unless I explicitly ask or a native build is actually broken. components/ui/ is generated Gluestack code — read a specific file if you need it, never the whole directory. Prefer targeted Grep/Glob over broad directory reads.

## Follow-up questions
If I ask "why" or push back, that's a continuation of the conversation, not a new task — answer in chat and only touch code again once I say to proceed.
