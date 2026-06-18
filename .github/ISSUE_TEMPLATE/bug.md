---
name: Bug report
about: Report a Specnaut problem you hit while running the CLI or using the bundled agents.
title: ""
labels: "bug,from:specnaut-expert"
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

Before submitting, scrub any of:
  - GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_…)
  - GitLab PATs (glpat-…)
  - Anthropic / OpenAI keys (sk-ant-…, sk-…)
  - AWS access keys (AKIA…)
  - Paths inside ~/.ssh/, ~/.aws/, ~/.config/gh/

The bundled `specnaut-expert` agent can do this scrubbing for you —
ask it "report this as a bug" and it will pre-fill an issue with the
above sections, scrub the listed token shapes, and hand you a link
to review and submit.
-->

```
<paste here>
```
