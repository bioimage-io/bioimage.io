# #0356 — the in-process `FieldInfo` trap does not reproduce

The served skill told readers to restructure their app around a failure mode I could not
reproduce in any worker image I had. This note is the measurement that replaced the claim.

Filed at `polar-shark-grvryd`'s explicit request while it was refusing PR #143 (six
corrections to the published BioEngine skill): *"That is a defect in `main` and needs its own
row regardless of what happens to #143. I am not asking this PR to fix it."*

## What the skill used to say

Two sites, both in `public/skills/bioengine/SKILL.md`:

- the **Key rules** bullet (was :287-293) — *"Never call your own `@bioengine.method`
  in-process … any `Field(...)`-defaulted parameter you don't pass arrives as a raw
  `FieldInfo` object rather than its default value"*, with a quoted
  `TypeError: float() argument must be a string or a real number, not 'FieldInfo'`.
- the **Common pitfalls** table row (:938) — the same `TypeError`, attributed to the same
  cause.

A third site at :71 cross-referenced it as *"the `FieldInfo` trap"*.

## What actually happens

`bioengine/_app/decorators.py:90` wraps every `@bioengine.method` with
`schema_method(arbitrary_types_allowed=True)`. That validator runs on **every** call, an
in-process one included — so an omitted `Field(...)` default arrives already resolved.

Measured in `ghcr.io/aicell-lab/bioengine-worker:0.16.96`, through a real decorated class.
`@bioengine.app` turns the class into a Ray Serve `Deployment` which refuses direct
construction, so the probe instantiates `Probe.func_or_class` — the wrapped class, with all
the `@bioengine.method` / `smoke_test` / `health_check` decorators still applied.

```
hypha_rpc 0.21.40 | pydantic 2.12.0 | ray 2.55.1
bare method, default omitted  -> {'type': 'float', 'value': 0.5}
context=True, default omitted -> {'type': 'float', 'value': 0.5}
smoke_test   -> self.score()  -> {'type': 'float', 'value': 0.5}
health_check -> self.score()  -> {'type': 'float', 'value': 0.5}
CONTROL explicit 0.9          -> {'type': 'float', 'value': 0.9}
```

Every one of the four call shapes the skill warned about received `0.5` as a plain `float`.
The control at `0.9` discriminates: the probe can tell a resolved default from a passed
argument, so the four `0.5` lines are a measurement and not a constant.

`polar-shark-grvryd` measured the same thing independently in a **different** image,
`bioengine-worker-local:0.16.89-py3.12-ray2.55.1`. Two images, same result — hence the
"measured in two worker images" phrasing in the shipped text.

The raw `FieldInfo` survives in exactly one place: the **undecorated** function's own
`__defaults__`, which nothing in a running app reads.

## Where a real `FieldInfo` at runtime comes from

A `FieldInfo` reaching application code means the validator did not run at all. The skill
already documents that fault, two rows further down the same table (:945, :946): a
driver / `runtime_env` **pydantic-core version mismatch**, fixed by pinning `pydantic` in
`runtime_env.pip`. The new :938 row points there instead of inventing a cause.

## The advice that survives

The *shape* the skill recommends — body in a separate undecorated module, decorated method a
thin wrapper — is still right, on a different and already-measured reason: **reachability**.
`@bioengine.app` runs `from ray import serve` at decoration time, so a `[cli]`-only venv
cannot import an app module at all (SKILL.md:71). A helper *method* on the decorated class
does not help, because reaching it means importing the decorator. A separate module is
importable in the venv you already have. That reason was already in the file; this change
makes it the reason, rather than a second argument stacked on a false one.

So the bullet keeps the recommendation and loses the justification.

## What was deliberately NOT touched

`SKILL.md:946` — `Ray Serve replica crashes with 'FieldInfo' object has no attribute
'exclude_if'` — is a **different, real** defect that a word-keyed sweep for `FieldInfo`
would have destroyed. The row was flagged in #0356 when it was filed, and verified
untouched rather than assumed:

```
=== the exclude_if TABLE ROW, scoped to the row itself ===
fa5f285d5ca43c12334ebb1004c5b15c  -      (base 4eae7f6)
fa5f285d5ca43c12334ebb1004c5b15c  -      (working tree)
=== CONTROL: a row this PR DID change ===
93d62c751371296af84127652dc48c3a  -
bc75f6cccf4a15dd966da8016985b009  -
```

Byte-identical, and the control proves the comparison can tell a changed row from an
unchanged one.

## Verification traps hit while writing this

Three greps came back wrong before they came back right. All three are the same mistake —
a control that did not fire where the claim was about:

- `grep -c 'not peculiar to the frontend-only path'` returned 0 because the literal I
  searched for contained my own `**` markdown.
- `git diff | grep -c "exclude_if"` returned 1, which read as *line 946 changed*. It was my
  own **added** line at :291, which mentions the string by name. A diff-wide grep cannot
  distinguish an added mention from a modified line; the md5 of the row itself can.
- The same confusion recurred inside an `md5sum` control until the pattern was narrowed to
  the row's own leading text (`| Ray Serve replica crashes with`).

## Anchors

`:71` and `:291` both link `#key-rules`. Verified it resolves:

```
=== anchors: does '### Key rules' exist for #key-rules? ===
1
=== CONTROL: a heading that does not exist ===
0
```

An earlier draft of :291 linked `#troubleshooting`, which is dead — the pitfalls table lives
under `## Common pitfalls (across all four tasks)` and no other link in the skill uses that
anchor. Replaced with the bold section name.

## DONE WHEN, against this note

1. ✅ The in-process-`FieldInfo` sites no longer make the claim; `:946` untouched, verified.
2. ✅ The quoted `TypeError` at the old `:289` is gone; the `:938` row now attributes the
   symptom to the pydantic-core mismatch that does produce it.
3. ✅ The advice still routes the reader to a separate undecorated module, on the
   import-reachability reason.
4. ✅ Re-measured against a current worker image (0.16.96) with the own-value control.
5. ⏳ Needs merge + deploy: fetch `https://bioimage.io/skills/bioengine/SKILL.md` over HTTP
   and grep the body, with a positive control proving the pattern is live against that body.
   A 200 can be the SPA fallback.

Clause 5 is why this row pauses rather than closes.
