# BioImage.IO — Claude Code Guidelines

This repository is the React/TypeScript frontend of the **BioImage Model Zoo**
(<https://bioimage.io>): a community platform for sharing, testing and running deep learning
models for bioimage analysis, with model records in the bioimageio RDF format, in-browser
inference through BioEngine, and artifact storage and RPC through Hypha Cloud. It is a
production site with a wide community, so a change here is visible to people who did not ask
for it. There is no README.md at the repo root; `docs/` holds the user-facing documentation.

This file carries only what the repository cannot tell you itself. The stack, the scripts and
the dependency versions are in `package.json`; the component layout is in the skill below.

## Hard Rules

These override every other instruction in this file, in any skill, and in any task brief.

### Never touch issue #3

**`bioimage-io/bioimage.io` issue #3 is the ongoing meeting-minutes thread. Never modify it in any way.**

That means no closing, no reopening, no commenting, no editing the body or title, no labels,
milestones, assignees, or pins, and no locking. It applies to every route: the `gh` CLI, the
GitHub REST/GraphQL API, a browser session, a workflow, or a subagent acting on your behalf.

It also rules out anything that reaches #3 *incidentally*. Before running any bulk or automated
issue operation (a stale-issue sweep, a triage script, a label migration, a "close all issues
matching X" pass, a scheduled job), confirm #3 is excluded and say so. A filter that happens to
miss #3 today is not an exclusion — exclude it explicitly.

The thread is a live record that people read and add to. There is no fix-it-afterwards: a close,
a stray comment, or an edit is visible to every subscriber the moment it lands, and reverting it
does not unsend the notification. If a task seems to require touching #3, stop and ask.

---

## User-visible text: no em dashes, and a check that enforces it

Strings that reach a user carry no em dash (`—`, U+2014) and no en dash (`–`, U+2013) in prose.
Which surfaces count, what is exempt, and the allowed compact numeric range (`5–95%`) are all
encoded in the check, so run it rather than reading the rule back out of here. It runs inside
`pnpm test`, and standalone:

    npm run check-ui-text                        # exits 1 and names the file:line of each violation
    node scripts/check-ui-text.js --self-test    # 22 checks, proves it can still go RED

Do not grep for this. Measured 2026-11-04, `grep -rn '—' src --include='*.ts' --include='*.tsx'`
matches 255 lines across 73 files, nearly all of them in exempt comments, so a grep gate is red
on arrival and gets switched off. The check parses instead, so a comment, a JSDoc block, a `console.*` log and
a regex literal are not nodes it ever reads. To keep a dash on purpose, put `ui-text-check:
allow` on that line, or `ui-text-check: disable` anywhere in the file.

One clause of the rule is not mechanisable and stays a judgement: prefer two sentences or a
comma over a semicolon, and keep one only where it genuinely joins two independent clauses.

---

## Two measured facts that will mislead you

**`tsc --noEmit` is broken by design here, so do not gate on it.** TypeScript 3.9.10 is declared
in `package.json` against a tsconfig needing 4.1+. Re-measured 2026-11-04, the split is exactly
2,211 = 1 + 2,210: one `tsconfig.json(17,12): error TS6046: Argument for '--jsx' option must be:
'preserve', 'react-native', 'react'` (the file asks for `react-jsx`, added in 4.1), and 2,210
`TS1xxx` parse errors in dependencies' `.d.ts` files that 3.9 cannot read. **Zero are under
`src/`.** None of it is about your change. One clean tree, 2026-11-04: `tsc --noEmit` exit 1 on
those 2,211, `react-scripts test` exit 0 over 108 cases, the gate below exit 0.

    ./node_modules/.bin/react-scripts build

**This file has been given `skip-worktree` in a worktree before, and under that flag edits to it
silently never commit.** It is a per-worktree index bit, not a repo setting, so it can be set
again by anyone who wants session-local notes in here without committing them. Observed on
2026-11-04 in a worktree whose local copy was 101 lines longer than the tracked blob, while
`git status` and `git diff` both reported the file clean over that entire difference.
Check before you edit, and edit a copy that reports `H`, not `S`:

    git ls-files -v -- CLAUDE.md    # H = normal, S = skip-worktree, your edits will not commit

`.github/copilot-instructions.md` is a symlink to this file, so a committed change here also
reaches GitHub Copilot, and everything in it is public.

---

## Where to find more

Load the matching skill before touching that area. They hold the conventions, the component
inventory and the architectural patterns, so none of that is repeated here:

- **`.claude/skills/bioimageio-website/SKILL.md`** — the code-level guide to this repository.
  Read it before any non-trivial change.
- **`public/skills/bioimageio-models/SKILL.md`** — the model contribution pipeline, for any
  agent. `src/components/Upload.tsx` advertises its public URL to contributors.
- **`public/skills/bioengine/SKILL.md`** — the BioEngine deploy workflow. Carries one trap worth
  knowing before you read it: always pass `--app-id <running-id>` when updating an app, because
  omitting it silently deploys a new random instance instead of updating the old one.

The two under `public/skills/` are **served** at <https://bioimage.io/skills/>, so editing the
repo copy does not change what a reader fetches until it is deployed.

## Related repositories

These are separate upstream repositories, **not part of this one**. Some checkouts keep local
clones of them for side-by-side grepping, but `bioimageio-resources/` is gitignored
(`.gitignore:39`) and nothing under it is tracked, so a fresh clone and most worktrees do not
have it. Measured 2026-11-04: `git ls-files` counts 0 files under that path, and it was absent
from a worktree while present in the main checkout. Do not tell a contributor to look there,
and clone what you need yourself.

| Repo | Role |
|---|---|
| [spec-bioimage-io](https://github.com/bioimage-io/spec-bioimage-io) | RDF format spec + `bioimageio.spec` Python library |
| [core-bioimage-io-python](https://github.com/bioimage-io/core-bioimage-io-python) | `bioimageio.core` — what the Test button delegates to |
| [collection](https://github.com/bioimage-io/collection) | Community partner registry + reviewer roster (JSON config) |
| [bioengine](https://github.com/aicell-lab/bioengine) | Ray-Serve inference backend behind the BioEngine button |

The spec ↔ core versions are a pinned chain: bumping one without the other silently rejects
otherwise-valid resources. Read the versions out of the checkouts rather than from here. See the
bioimageio-website skill for the version-chain rule, the partner-registry file, and the
YAML 1.2 / ruyaml gotcha.
