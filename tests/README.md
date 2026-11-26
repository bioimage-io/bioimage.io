# Browser tests

Playwright specs that drive real pages. Run one file at a time rather than the
whole directory: some specs have live side effects, including real GPU
inference against a deployed worker.

```bash
npx playwright test tests/<file>.spec.ts
```

`E2E_BASE_URL` retargets them at a particular dev server, which matters when
more than one checkout is serving at once. The suite's `globalSetup` prints the
server's path and pid and refuses to run against a different checkout, because
driving a sibling worktree's server produces results that belong to someone
else's code.

## These files ARE type-checked, but not by the obvious command

```bash
npm run typecheck:tests
```

**`npm`, not `pnpm`.** This repo is installed with pnpm, but `pnpm run <script>`
first brings dependencies up to date, and in this checkout that step decides the
modules directory must be replaced. With no TTY to confirm it, pnpm aborts with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` and the script never runs, so the
command exits non-zero for a reason that has nothing to do with your types.
Setting `CI=true` to get past that prompt is worse, because then the removal
goes ahead, and `node_modules` here is shared with other working copies.
`npm run` executes the script without that step. The bare command also works:

```bash
npx -y -p typescript@5.6 tsc --noEmit -p tsconfig.tests.json
```

The main `tsconfig.json` has `include: ["src", "src/types"]`, so nothing in it
ever looked at this directory. A spec could contain a plain type error and
nothing would say so. `tsconfig.tests.json` covers this directory only, and the
script above runs it.

**Do not reach for `./node_modules/.bin/tsc`.** The repo's own TypeScript is
3.9.10, and it cannot parse the type definitions that `@types/node` 20 and
Playwright 1.61 ship. Pointed at this directory it reports **1488 errors, 1487
of them inside `node_modules` and one in `tsconfig.json` itself, and zero in
`tests/`**. (The odd one out is `tsconfig.json(17,12): error TS6046`, that
compiler rejecting the `jsx` value the app's config sets.) That looks like
"the specs are fine" and it means "the compiler never got far enough to read
them". The script pins a modern TypeScript through `npx` instead, which leaves
the repo's own toolchain and the production build untouched.

Two consequences of that choice, so neither is a surprise:

- The first run on a machine downloads the compiler, so it needs network access.
  Later runs use the npm cache.
- The check is **not wired into CI**. Neither workflow in `.github/workflows/`
  runs Playwright or a type check today, so adding one is a decision about the
  shared pipeline rather than about this directory, and it covers specs owned by
  several different people. Until that is decided, this is a command you run.

## Why a separate config

The specs run under Node, through Playwright, not in a browser. The application
bundle targets `es5`, and applying that target here reports three errors in one
spec for iterating a `NodeList` — not a defect in the spec, just the wrong
target for code that never ships to a browser. The separate config sets
`es2020` and the libraries the specs actually use.

It is also separate because `react-scripts build` reads `tsconfig.json` and
rewrites parts of it. Widening that file's `include` would pull these specs into
the production build's view, which is not what anyone wants.

## What the check does and does not catch

It catches what a type checker catches. The case that prompted it: a helper
declared `(): string | undefined` whose value reaches five parameters typed
`string`, kept safe only by an early `return` inside a guard. Delete the
`return` and the file still parses, still collects, still runs. `tsc` reports it;
nothing else here does.

It does not run the specs, and it does not know whether an assertion is
meaningful. A spec that passes while asserting nothing type-checks perfectly.
