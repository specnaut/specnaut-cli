---
name: Bug report
about: Report a Specnaut problem you hit while running the CLI or using the bundled agents.
title: ""
labels: "bug,from:specnaut-guide"
---

## Summary

<!-- One paragraph: what you tried to do, what went wrong. -->

## Reproduction

<!-- Numbered steps. Include the exact commands you ran. -->

1.
2.
3.

## Observed

<!-- What actually happened — error messages, unexpected output, missing files. -->

## Expected

<!-- What you thought should happen. -->

## Environment

<!--
Run these and paste the output:

  specnaut --version
  cat .specnaut/installed.lock | head -10
  uname -srm   # or `cmd /c ver` on Windows
-->

```
specnaut --version: <output>
templates_version : <from installed.lock>
harness           : <from installed.lock>
backlog_backend   : <from installed.lock>
OS / arch         : <uname -srm output>
```

## Logs

<!--
Paste the failing command's stdout / stderr in a fenced code block.

Remove secrets and anything that identifies your project before submitting.
This issue is public, and only maintainers can delete it.

`/specnaut issue <what happened>` drafts this report in your harness, checks it
for those, and shows you the exact text before anything is published.
-->

```
<paste here>
```
