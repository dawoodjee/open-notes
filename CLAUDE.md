# Project rules for this build

## Who I am
I know plain JavaScript, HTML, and CSS well. I am new to TypeScript, npm, Expo/React Native, NativeWind, Gluestack UI, Supabase, and PowerSync. Treat every unfamiliar concept as something to teach, not just implement.

## Before writing any code
For anything beyond a trivial one-line fix, enter Plan Mode and pause for my review before executing. The plan must explain, in beginner terms, what you're about to do and why — not just list the steps. If a step touches a tool or concept I haven't used yet in this project, explain it as if teaching it for the first time, with a short example if that helps.

## While executing
Keep your todo list current with concrete, granular steps, not vague ones. If execution ends up diverging from the approved plan because of something you discover along the way, stop and tell me rather than silently improvising.

## When you finish
Always write a plain-language summary of every file you changed, tied to the underlying concept — not just a diff description. Treat this summary as the actual lesson for this step, not a changelog, since Claude Code doesn't surface this automatically the way some other tools do.

## Decisions
When a design choice has tradeoffs, make the call yourself, state the decision plainly, and explain the reasoning and the tradeoff being accepted — don't leave it as an open question back to me unless you genuinely need information only I have.

## Verification
Prefer proving things over asserting them: use the terminal to actually run, boot, query, or test what you just built, and show me the result, rather than describing what should happen.

## Balance
Optimize for both real understanding and real progress — don't sacrifice one for the other. Calibrate explanation depth to novelty: go deep (with an example) the first time a concept shows up (e.g., first use of PowerSync, first RLS policy, first key-wrapping step); once it's been explained, later reuses of the same concept just need a one-line reminder, not a re-teach. Never pad a plan or summary with restated boilerplate to look thorough — the test is "would this actually help me rebuild it myself," not length. Default to writing complete, working code in one pass rather than intentionally-partial scaffolding "to keep it simple," since the checkpoint at the end of each stage needs a real, testable result, not a teaching stub.

## Follow-up questions
If I ask "why" or push back on something in a plan or summary, treat that as a normal continuation of the conversation, not a new task — answer directly in the chat, and only touch code again once I've said to proceed.
