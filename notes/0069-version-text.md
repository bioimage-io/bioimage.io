# #0069 — the served uploader could name an artifact version the manifest does not spell

Handed over by the reviewer (`polar-shark-grvryd`) as the one finding its APPROVE on PR #143 left
unfiled. It scored the finding a note; measured here it is two defects of unequal severity, and the
worse of the two is not the one the reviewer was looking at.

Branch: `docs/0069-version-text-not-float`, cut from `b39f719` (PR #148's head, the stack tip).

## Decided: stack on the tip again, not on main

Site 1 (the `test_version.py` snippet) **exists only on the stack** — `assert app_core.__version__`
is 0 occurrences on `origin/main` at `e0faf0e` and 1 on `a508a50` / `4eae7f6` / `fe8c22e` /
`b39f719`, negative control `assert app_core.__versionzz__` 0. A branch from main could not fix a
line that is not there, and splitting the row into one PR per site would separate a snippet from the
script it now points at. Site 2 is on main and untouched by the stack, so it comes along cleanly.

## The mechanism

`yaml.safe_load` reads an unquoted two-component `version:` as a float, and `str()` on that float
does not give the text back when the minor part carries a trailing zero.

```
  version: 1.0.0    -> str   '1.0.0'   str()='1.0.0'   vs '1.0.0':  OK
  version: 1.0      -> float 1.0       str()='1.0'     vs '1.0':    OK
  version: 2.1      -> float 2.1       str()='2.1'     vs '2.1':    OK
  version: 0.10     -> float 0.1       str()='0.1'     vs '0.10':   MISMATCH
  version: 2.10     -> float 2.1       str()='2.1'     vs '2.10':   MISMATCH
  version: 1.20     -> float 1.2       str()='1.2'     vs '1.20':   MISMATCH
  version: 0.9.1    -> str   '0.9.1'   str()='0.9.1'   vs '0.9.1':  OK
  version: 1.0.10   -> str   '1.0.10'  str()='1.0.10'  vs '1.0.10': OK
NEGATIVE CONTROL, a quoted scalar must always round-trip:
  version: "2.10"   -> str   '2.10'    vs '2.10':  OK
  version: '0.10'   -> str   '0.10'    vs '0.10':  OK
```

The failing set is exactly **two components with a trailing zero in the minor part**. `1.0` survives
only because `str(1.0)` happens to be `'1.0'`, which is why the defect reads as absent on the
spelling everyone tries first.

## Site 2 is the one that matters, and it is not an assertion

`public/skills/bioengine/scripts/upload_app.py:82`, on `origin/main` at `e0faf0e`
(`git grep 'str(manifest\[.version.\])'` over `public/skills/bioengine` → this one occurrence,
negative control `str(manifestzz` → 0):

```python
base = str(manifest["version"])          # target release, e.g. 0.1.2
```

`base` **names the artifact version that gets uploaded**. It reaches `_set_files_version(files,
base)`, `worker.upload_app`, the already-exists check at `:105` and the printed
`deploy_app(... version='{base}')`.

Measured by loading the real file in `ghcr.io/aicell-lab/bioengine-worker:0.16.96` (PyYAML 6.0.2)
and running its two pure functions over a temp manifest per spelling — no network, no worker. The
**same probe** against the pre-fix file at `b39f719` and the post-fix file, so the difference is the
fix and not the harness:

```
                 _manifest_version_text / str(_read_manifest)   uploaded manifest text
PRE-FIX  (b39f719)
  0.10           '0.1'                                          '0.1'      WRONG VERSION NAME
  2.10           '2.1'                                          '2.1'      WRONG VERSION NAME
  1.20           '1.2'                                          '1.2'      WRONG VERSION NAME
  1.0            '1.0'                                          '1.0'      CONTROL OK
  1.0.0          '1.0.0'                                        '1.0.0'    CONTROL OK
  0.9.1          '0.9.1'                                        '0.9.1'    CONTROL OK
  2.1            '2.1'                                          '2.1'      CONTROL OK
                                                                4/7
POST-FIX
  all seven, including the three above                                     7/7
```

The third column is what the worker reads back out of the *uploaded* manifest, so the artifact's own
manifest disagreed with the author's source too, not just the version label. The four controls pass
in both runs, which is what makes the three failures readable as the defect rather than as a broken
probe.

**Still inferred, not measured:** that a wrong `base` therefore *commits* an artifact named `0.1` on
`hypha.aicell.io`. What is measured is the string handed to `worker.upload_app`. I did not run the
uploader against a live worker, so if the worker or the artifact manager normalises or rejects a
version earlier, site 2 degrades to site 1's severity class. The fix is correct either way; the
urgency is what would change. This was declared on the row when it was filed.

## Site 1 is a loud false alarm, and its explanation was the trap

`public/skills/bioengine/SKILL.md`, the `test_version.py` block, added by PR #143. The snippet
asserted against `str(manifest["version"])`, and the sentence below it presented that `str(...)` as
the remedy for the float conversion. That sentence is **true and incomplete**: `str()` rescues `1.0`
and is exactly what fails on `0.10`. A reader whose manifest says `version: 0.10` gets a failing
version test on a manifest that uploads and deploys perfectly well — the opposite of what the
paragraph promises.

Fixed by teaching `BaseLoader`, which keeps every scalar as its source text, and by naming the lossy
shape as the thing that looks right and is wrong. The paragraph now also points at the served
`scripts/upload_app.py` as the worked example, and mentions quoting the manifest field as a
source-side fix worth doing *as well* rather than instead.

## The guard: `scripts/check-version-text.sh`

Exit 0 pass / 1 violated / **2 could not run**, which is deliberately not a pass: a missing file, an
empty file, a missing anchor, no `python3` or no PyYAML would otherwise make every grep match
nothing and read as clause 1 satisfied.

Clause 3 **runs** the premise rather than asserting it in a comment — it checks that in the PyYAML
actually installed, `str(safe_load(...))` still loses `0.10`/`2.10`/`1.20` and `BaseLoader` still
does not. If a future PyYAML changes that, the guard says so instead of silently guarding nothing.

Eleven trees, each under `/bin/sh` (dash), `bash --posix` and `busybox ash`. All eleven agreed
across all three shells:

```
TREE                             dash bash ash
clean                            0    0    0
M1_lossy_assign                  1    1    1   base = str(manifest[...]) restored
M2_no_baseloader                 1    1    1   BaseLoader string removed
M3_snippet_lossy                 1    1    1   snippet reverted to str(manifest[...])
M3b_snippet_safeload_spelling    1    1    1   snippet reverted to str(yaml.safe_load(...))
M4_no_uploader                   2    2    2   upload_app.py deleted
M5_empty_skill                   2    2    2   SKILL.md truncated to zero bytes
M6_no_anchor                     2    2    2   the test_version.py anchor renamed
M7_helper_safeload               1    1    1   helper kept, body switched to str(safe_load)
M8_widen_clause2                 1    1    1   clause 2 widened to the whole file  <- SCOPING CONTROL
M9_no_helper_call                1    1    1   helper kept but `base` assigned from neither
```

**Discrimination controls for the three-shell harness**, because eleven agreements mean nothing if
the loop cannot see a difference. `[[ 1 == 1 ]] || exit 3` separates dash (rc=3) from bash (rc=0);
busybox ash accepts `[[` so it is the weaker control there, and a second control independent of `[[`
— `${v^^}` — separates bash (0) from dash (2) **and** busybox (2). A first attempt at this control
exited 0 in every shell because both branches ended in `exit 0`; it proved nothing and was replaced.

**M8 is why clause 2 is scoped to the fenced block.** The warning paragraph directly below the block
now contains the literal `str(yaml.safe_load(...))` in order to warn about it — measured 1 file-wide,
0 inside the block — so a file-wide clause 2 exits 1 on correct prose nobody broke. A first version
of M8 used `sed` and silently matched nothing, giving rc=0 and reading as "the scoping is
unnecessary"; rewritten with an asserting `python3` patch, it fires. Noted because that is the exact
shape of failure this lane keeps meeting: the mutant that does not mutate is indistinguishable from
the clause that does not matter.

Also measured: clause 2's *other* pattern, `str(manifest[`, is 0 file-wide on this branch, so the
scoping would have been inert had the clause caught only that spelling. Catching both spellings is
what makes the scoping load-bearing, and both are the regression.

`npm run check-version-text` exits 0 and propagates the script's output; with line 82 reverted it
exits 1 through npm, and restoring it returns to 0. Like its two siblings, **no GitHub workflow runs
it** — this repo has `deploy.yml` and `model-testing.yml` only, neither of which invokes an
`npm run check`. Wired into the same place as the siblings; nothing fires automatically for any of
the three.

## Merge order, measured

`package.json` **conflicts** with the three other guard-adding branches, and it is a one-line
both-keep in `scripts`:

```
  vs 5182aba (#142)  CONFLICT package.json
  vs c93f9e0 (#144)  CONFLICT package.json
  vs 8b2c3ab (#134)  CONFLICT package.json
  vs ed3c3c6 babf488 a508a50 4eae7f6 fe8c22e 2b08770 b887abf 649653a   all CLEAN
  onto origin/main e0faf0e                                            CLEAN
```

Three alphabetically adjacent keys after `check-prebuilt-images` — `check-application-resources-doc`,
`check-concurrency-doc`, `check-version-text`. Whoever sequences second, third and fourth inherits it.
The reviewer already reported the #142 × #144 half of this independently.

## Still unmet

Nothing here is deployed. `https://bioimage.io/skills/bioengine/SKILL.md` serves `origin/main`, so
neither site 1's corrected snippet nor the pointer to the fixed uploader is readable by an agent
until this branch and the four under it merge. The fetch-and-grep of the served page, with a positive
control, is DONE WHEN clause 4 and cannot run yet.
