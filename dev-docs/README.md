# dev-docs

Everything about **how this app gets built** — the plans, the decisions and the
design references it is built against. Nothing in here ships to a user.

This is separate from [`docs/`](../docs), which is the opposite thing: `docs/`
explains the app to somebody who wants to run, self-host or understand it, and
is written for an outside reader.

| | |
|---|---|
| [`prd.md`](prd.md) | What the product is meant to be, and why. The oldest document here and the one everything else answers to. |
| [`mvp-build-plan.md`](mvp-build-plan.md) | Stages 0–8 plus 6.5. History now, but its **Decisions Log** is live: the E2EE model, the key-wrap design and the plaintext-forwarding fix are all recorded there and still govern the code. |
| [`iteration-2-build-plan.md`](iteration-2-build-plan.md) | The current plan — folders, list view, chrome, web parity, export/import. Has its own Decisions Log; iteration-2 decisions go there, not into the MVP file. |
| [`design/`](design) | Reference screenshots, by iteration and stage. **Authoritative over prose:** where a written description and a screenshot disagree, the screenshot wins. |

## Why these are in the repo

They were gitignored until 2026-08-22. That had a real cost the project already
paid once: stage state ended up existing only in commit messages, so the record
of what had been decided and why was reconstructable only by reading git log.
A plan that is not in the repo is not inspectable, cannot be reviewed in a diff,
and does not travel with the branch it describes.

## What is deliberately NOT in here

No credentials, no keys, no recovery codes, no live URLs that are not already
public. The one email address that remains is the landing page's own contact
address, which exists to be published. Note that the repo's commit history
carries the author's address regardless — removing an address from a document
does not remove it from the repository.

If a stage genuinely needs a secret to be verified, it belongs in the local
`.env` (see [`docs/two-stacks.md`](../docs/two-stacks.md)), never in a plan.

## Design references

```
dev-docs/design/<iteration>/<stage-slug>/...
```

Named by what they show, not by when they were taken, so a filename in a code
comment still means something a year later. Several components cite theirs
directly — see `components/IconButton.tsx` and `lib/layout/paneChrome.ts`.
