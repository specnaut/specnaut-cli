---
description: Build and expose a feature branch via Cloudflare Tunnel for testing. Checks out the feature branch, builds for production, and provides a public URL.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

Goal: Expose a feature branch as a public URL via Cloudflare Tunnel so the user
can test it on any device.

### 1. Determine the feature branch

If the user provided a spec number (e.g. `147`), the feature branch follows the
naming convention `{number}-*` (e.g. `147-some-feature`).

- If the current branch already matches the spec number → use it directly
- If not → find the branch: `git branch --list "{number}-*" | head -1`
- If no branch found → inform the user and stop

### 2. Checkout the feature branch

If not already on the correct branch:

```sh
git checkout {branch-name}
```

### 3. Execute the expose-tunnel skill

Read and execute the **expose-tunnel** skill located at
`.claude/skills/expose-tunnel/SKILL.md`.

**Follow every step in the skill autonomously.**

### 4. Report back

Once the tunnel is active, respond with:

> ✅ **Feature #{number} exposée !**
>
> Branche : `{branch-name}`
>
> 👉 [https://xxxx.trycloudflare.com](https://xxxx.trycloudflare.com)

### 5. Suggest next commands

```
/speckit review {number}
```

## Notes

- Running this command again on the same branch rebuilds and restarts — but if
  cloudflared is still running, the URL stays the same (no need to kill the
  tunnel, only the server).
- The user can also run this on `main` to test the current state of the main
  branch.
