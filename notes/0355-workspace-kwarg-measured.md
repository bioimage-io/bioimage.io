# #0355 — the seven out-of-scope `workspace` sites

The row asked about "seven more `connect_to_server` calls". **Two of the seven are not
`connect_to_server` calls at all**, and they are correct as written. Five were the defect and
are fixed. This note is the measurement behind both halves.

The row's own UNVERIFIED block invited exactly this: *"A child who reads one of the seven and
concludes it is correct as written has finished clause 1, not deviated from it."*

## Clause 3 — re-measured here, with the own-workspace control

Against `hypha.aicell.io`, token encoding `ws-user-github|49943582`:

```
token's own workspace = ws-user-github|49943582

OK    no workspace kwarg                        -> landed in ws-user-github|49943582
OK    workspace = ws-user-github|49943582       -> landed in ws-user-github|49943582   <- CONTROL
FAIL  workspace = bioimage-io                   -> ConnectionAbortedError
FAIL  workspace = ws-definitely-not-a-real-one  -> ConnectionAbortedError
FAIL  workspace = my-lab                        -> ConnectionAbortedError
```

```
Failed to authenticate user: Current workspace encoded in the token
(ws-user-github|49943582) does not match the specified workspace (<the one you passed>)
```

The control is the whole measurement: passing the token's *own* workspace succeeds, so the
kwarg is not rejected outright. It is a constraint with exactly one correct value, and that
value is different for every reader. A probe that failed for all four would have tested
nothing.

Not taken from the row. Re-run from this worktree before any edit was made.

## The two sites that are NOT the defect

`references/hypha_setup.md:89` and `:102` are **`server.generate_token(...)`** calls, not
`connect_to_server`. Different API, and measured to behave in the opposite way:

```
connected in ws-user-github|49943582

OK    generate_token(workspace='bioimageio-colab')       -> token len 531
OK    generate_token(workspace='reef-imaging')           -> token len 513
OK    generate_token(workspace='ws-user-github|49943582') -> token len 551
FAIL  generate_token(workspace='bioimage-io')
      PermissionError: You do not have any permission for workspace: bioimage-io   <- CONTROL
```

So `generate_token`'s `workspace` is an ordinary permission check against the workspace you
name, and it **crosses workspaces freely while you stay connected to a different one**. The
first two lines are the decisive ones: two foreign workspaces minted successfully from a
connection in a third. The failure mode is `PermissionError` / `KeyError: 'Workspace not
found: my-lab'`, never a workspace-mismatch error.

That is exactly `hypha_setup.md`'s shape — the reader created `my-lab` in the snippet above
and is its owner by default, then mints for it. **The kwarg belongs there.** Both sites are
left as they are, and a note now says why, so the next word-keyed sweep does not "fix" them.

This is recorded as a decision, not an omission (clause 1).

## The five that are the defect, and what replaced them

Deleting the kwarg is not sufficient on its own: three of the five are discovery recipes whose
whole point is to list **bioimage-io's** workers, and `list_services` is scoped to the
connected workspace. Measured that the scope travels to a different argument:

```
list_services({'type':'bioengine-worker'})                          -> 2  (my own workspace's)
list_services({'type':'bioengine-worker','workspace':'bioimage-io'}) -> 2  (bioimage-io's)
     e.g. bioimage-io/bioengine-worker-kth-596798f679-sb8ph:bioengine-worker

CONTROL, a type that exists nowhere:
list_services({'type':'definitely-not-a-type'})                      -> 0
list_services({'type':'definitely-not-a-type','workspace':'bioimage-io'}) -> 0
```

The control matters: without it, two results on each side could have been the same two results
ignoring the filter. The ids prove otherwise, and the fake type returns 0 through the same
filter, so the filter is live rather than inert.

| Site | What changed |
|---|---|
| `references/service_ids.md:31` | kwarg dropped from the connection, `"workspace": "bioimage-io"` moved onto `list_services`, plus a block quote giving the connect-time measurement and naming the two things that *do* cross a boundary |
| `apps/model-runner/model-runner.md:54` | same move, with a comment pointing at `references/service_ids.md` |
| `apps/model-runner/model-runner.md:254` | same move |
| `apps/model-runner/model-runner.md:1100` | kwarg dropped; `my_workspace` is now **read back** from `s.config.workspace` rather than supplied, since `admin_token` already decides it and the variable is still needed for the worker's service id |
| `references/custom_dashboard.md:403` | kwarg dropped, `WORKSPACE` moved onto `list_services`, plus a short note on why |

Clause 2 is why each one carries the reason rather than just losing a key: a reader who
deletes the kwarg and then cannot reach another workspace needs to be told that the
`list_services` filter and a fully-qualified id are what do that. Measured that a
fully-qualified id still works from an ordinary connection:

```
get_service("public/artifact-manager")            OK
am.read(artifact_id="bioimage-io/model-runner")   OK -> alias=model-runner, type=application
```

## End-to-end: the edited recipe runs

Ran the edited `service_ids.md` block **verbatim** (only the token injected), from
`ws-user-github|49943582`, which is not `bioimage-io`. The old form could not have connected
at all:

```
workers: ['bioimage-io/bioengine-worker-kth-596798f679-sb8ph:bioengine-worker',
          'bioimage-io/bioengine-worker-denbi-7cdfbd55cc-cm9rd:bioengine-worker']
app ids: ['annotation-broker', 'model-runner', 'omezarr-view']
  RUNNING model-runner -> bioimage-io/bioengine-worker-kth-596798f679-sb8ph-4dcbe5dc:model-runner
get_model_rdf('affable-shark') OK -> name = NucleiSegmentationBoundaryModel
exit: 0
```

That also exercises `model-runner.md`'s step 3, which is the same recipe continued.

## Clause 4 — the file-wide scan

A plain `grep -rn '"workspace":'` is the wrong instrument: it cannot tell a `connect_to_server`
dict from a `list_services` dict, and it flags prose. A scanner that reads each
`connect_to_server({` forward to its closing `})`:

```
connect_to_server({ calls scanned: 19   <- POSITIVE CONTROL, must be > 0
calls carrying a workspace key: 3
  SKILL.md:765                     <- PR #145's fix, not on this branch (branched from main)
  SKILL.md:811                     <- PR #145's fix, not on this branch
  references/custom_dashboard.md:411  <- PROSE: my own note quoting the bad form to warn against it
```

All three accounted for; none is an unfixed site. Zero of this row's five remain.

Controls on the surrounding greps, after one that **did not run** was caught and re-run
(`--include=*.md` unquoted, which zsh glob-expanded into a no-match error, so the check
silently produced nothing rather than a pass):

```
grep -rl '"server_url"'     --include="*.md"  -> 11 files   <- positive
grep -rl '"server_url_zzz"' --include="*.md"  ->  0 files   <- negative
grep -rn  '"workspacezzz":'                   ->  0         <- negative
```

## DONE WHEN, against this note

1. ✅ All seven accounted for: five fixed, two recorded as correct as written with the
   measurement that makes them so.
2. ✅ Each replacement carries the reason, and names `list_services`' filter and
   fully-qualified ids as what actually crosses a boundary.
3. ✅ Re-measured here, own-workspace control included.
4. ✅ Scanned with a positive control; the three remaining hits are accounted for and none is
   an unfixed site.

Nothing in this row needs the change deployed, so unlike #0344 and #0356 it has no
published-copy clause. It still does not close while its PR is unmerged.
