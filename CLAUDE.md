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

## User-visible text: no em dashes, and there is a check for it

Strings that render to a user (JSX text, `title`/`placeholder`/`aria-label` and friends, button
labels, dialog copy, toast and error messages) carry no em dash (`—`, U+2014) and no en dash
(`–`, U+2013) in prose. A bare `–` between numeric bounds in a compact label is fine (`5–95%`).
Comments, JSDoc, `console.*`, commit messages, SKILL.md files and this file are all exempt.

Do not grep for this: a plain `grep -rn '—' src` returns 255 hits, nearly all of them in exempt
comments. Run the parser instead, and run it before you hand over any UI change:

    node scripts/check-ui-text.mjs              # exits 1 and names the file:line of each violation
    node scripts/check-ui-text.mjs --self-test  # 21 checks, proves it can still go RED

It walks the TypeScript AST and looks only at surfaces that reach a user. To keep a dash on
purpose, put `ui-text-check: allow` in a comment on the same line.

One part of the rule is not checkable and stays a judgement: prefer two sentences or a comma
over a semicolon, and keep a semicolon only where it genuinely joins two independent clauses.

---

## Two measured facts that will mislead you

**`tsc --noEmit` is broken by design here, so do not gate on it.** TypeScript 3.9.10 is declared
in `package.json` against a tsconfig needing 4.1+. Re-measured 2026-11-04: it exits 1 with 2,211
errors, the first being `tsconfig.json(17,12): error TS6046: Argument for '--jsx' option must be:
'preserve', 'react-native', 'react'`, and 2,132 of them are parse errors inside dependencies'
`.d.ts` files that 3.9 cannot read. None of that is about your change. The real gate is:

    ./node_modules/.bin/react-scripts build

**CLAUDE.md carries `skip-worktree` in some worktrees, so edits to it silently never commit.**
Measured 2026-11-04: `git ls-files -v -- CLAUDE.md` printed `H` in the main checkout and `S` in
a sibling worktree whose local copy was 101 lines longer than the tracked blob. Under `S` git
reports the file clean no matter what you write to it, and both `git status` and `git diff`
agree over the whole difference. Check the flag before editing this file, and edit a copy that
reports `H`. `.github/copilot-instructions.md` is a symlink to it, so a committed change here
also reaches GitHub Copilot.

---

## Where to find more

Load these skills before touching the matching area of the codebase. They hold the coding
conventions, architectural patterns, component inventory and development rules:

- **`.claude/skills/bioimageio-website/SKILL.md`** — code-level guide for this repository. Read it before any non-trivial change: coding conventions, component layout under `src/components/{colab,annotate}/`, store contracts, the Hypha-reachability banner pattern, the `HYPHA_SERVER_URL` config seam, and the development rules (read-before-edit, no speculative features, undo snapshots on every vector mutation, etc.).
- **`public/skills/bioimageio-models/SKILL.md`** — agent-facing skill served at `https://bioimage.io/skills/bioimageio-models/SKILL.md`. Walks any AI agent through the full model contribution pipeline (gather info → build package → static + dynamic validation → submit to Hypha → optional BioEngine validation). The Upload page (`src/components/Upload.tsx`) advertises this URL to contributors.
- **`public/skills/bioengine/SKILL.md`** — canonical deploy workflow and CLI reference for BioEngine apps. Load this before deploying or updating a BioEngine application. Critical rule: always pass `--app-id <running-id>` when updating; omitting it creates a new random instance.

## Related repositories

Working copies of the sibling libraries live under `bioimageio-resources/` in this repo (added
2026-07-07) so they can be grepped side-by-side with the frontend:

| Repo | Path | Role |
|---|---|---|
| spec-bioimage-io | `bioimageio-resources/spec-bioimage-io` | RDF format spec + `bioimageio.spec` Python library |
| core-bioimage-io-python | `bioimageio-resources/core-bioimage-io-python` | `bioimageio.core` — what the Test button delegates to |
| collection | `bioimageio-resources/collection` | Community partner registry + reviewer roster (JSON config) |
| bioengine | `../bioengine` | Ray-Serve inference backend behind the BioEngine button |

The spec ↔ core versions are a pinned chain: bumping one without the other silently rejects
otherwise-valid resources. Read the versions out of the checkouts rather than from here. See the
bioimageio-website skill for the version-chain rule, the partner-registry file, and the
YAML 1.2 / ruyaml gotcha.
