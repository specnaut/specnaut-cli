# /specnaut list

## User Input

```text
$ARGUMENTS
```

Shows what Specnaut installed in this project. Read-only and one-shot.

## Steps

1. **Read `.specnaut/installed.lock`.** If it is absent, say that Specnaut is not installed here and
   stop.
2. **Group its entries** into skills and agents, from the paths this harness installs them under.
   For each, give its name and the first sentence of its `description` frontmatter.
3. **Mark local changes.** An entry whose file differs from its recorded hash is customised; name
   it as such. A recorded file missing on disk is named as missing.
4. **End with the three entry points**: `/task` for work, `/specnaut` for the framework, `/ship`
   for production.
