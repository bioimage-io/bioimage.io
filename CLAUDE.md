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

Do not grep for this: a dash grep over `src` matches 255 lines across 73 files, nearly all of them
in exempt comments, so a grep gate is red on arrival and gets switched off. The check parses, so a
comment, a JSDoc block, a `console.*` log and a regex literal are not nodes it reads. To keep a
dash on purpose, add `ui-text-check: allow` on the line or `ui-text-check: disable` in the file.

One clause of the rule is not mechanisable and stays a judgement: prefer two sentences or a
comma over a semicolon, and keep one only where it genuinely joins two independent clauses.

---

## Three measured facts that will mislead you

All three measured on one clean tree, 2026-11-04.

**Do not gate on `tsc --noEmit`: it is broken by design.** `package.json` declares TypeScript
3.9.10 against a tsconfig using `jsx: "react-jsx"`, which needs 4.1+. Exit 1 with 2,211 errors:
one `TS6046` for that option, and 2,210 `TS1xxx` parse errors inside dependencies' `.d.ts` files
3.9 cannot read. **Zero are under `src/`.** The two gates that do mean something, both exit 0:

    ./node_modules/.bin/react-scripts build
    npx react-scripts test --watchAll=false      # 108 cases across 11 suites

Allow the build 25 minutes: measured under 3 min idle but 12 min 44 s and 19 min 35 s under load,
and once killed with no exit status at 3 GB free. A short timeout reports a failure that did not
happen (180 s has, twice), so judge it on `^Failed to compile`, the `build/` output and the exit
status, never on elapsed time, and check free memory before blaming the code. A bare `error` grep
is useless: it matches third-party `Failed to parse source map ... Error: ENOENT` and eslint
warnings about variables merely NAMED `...Error...` on builds that succeeded. Output is
deterministic, so a repeated `main.<hash>.js` corroborates a real completion. Worked example:
`notes/build-verification-2026-11-04.txt`.

**This file gets `skip-worktree` set in worktrees, and then edits to it never commit.** It is a
per-worktree index bit, set so session-local notes can live here uncommitted. Seen with a local
copy 101 lines longer than the tracked blob while `git status` and `git diff` both reported the
file clean over that entire difference. Check before editing:

    git ls-files -v -- CLAUDE.md    # H = normal, S = your edits will not commit

`.github/copilot-instructions.md` symlinks to this file, so what lands here is public and also
reaches Copilot.

**`node_modules` is shared, so a dependency purge is never local to your worktree.** In a worktree
here it symlinks into the main checkout (`readlink -f node_modules`), so it is every worktree's
install at once. Never clear a "remove the modules directory" prompt with `CI=true`, which is what
pnpm's own no-TTY message suggests. It is intermittent: on 2026-11-04 `pnpm run <script>` failed
with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, then exited 0 within the hour on the same tree
and would not fail again, and the abort that saved it is TTY-dependent. Prefer the binaries, which
cannot touch the store. `pnpm` is right in CI, where the checkout is fresh.

---

## Where to find more

Load the matching skill before touching that area:

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

These are separate upstream repositories, **not part of this one**. `bioimageio-resources/` is
gitignored (`.gitignore:39`) with 0 tracked files, so a fresh clone and most worktrees do not
have it even though the main checkout does. Do not point a contributor there; clone what
you need yourself.

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
