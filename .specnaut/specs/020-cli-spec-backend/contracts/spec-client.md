# Contract — CLI spec surfaces

Two surfaces: (A) the cloud HTTP calls the CLI makes (consuming Lot 1's shipped
`/api/v1/specs*`), and (B) the `spec push`/`spec pull` command UX.

## A. Cloud HTTP calls (`spec_client.ts`, mirrors `gate_client.ts`)

Bearer-authed via the CLI credential store; `{apiUrl}/api/v1` prefix. Errors are **status-only**
(`SpecApiError` + `reasonForStatus`) — the backend's `error` string is never surfaced (§ I).

| Purpose | Call | Notes |
|---|---|---|
| Ensure/attach spec | `POST /api/v1/specs` `{projectKey, taskNumber, title?}` | idempotent |
| Pull a spec | `GET /api/v1/specs?projectKey=&taskNumber=` → `{spec｜null}` | `null` → no spec yet |
| Push steps (upsert-only) | `PUT /api/v1/specs/steps` `{projectKey, taskNumber, steps:[{key,name,order,body}]}` | never deletes an omitted step |
| Auto-create task (unlinked specify) | `POST /api/v1/tasks` `{projectKey, title}` → `{task:{number}}` | shipped endpoint; typed `cloud_client.createTask` |

Only `SpecStep{key,name,order,body}` and the public `projectKey`/`taskNumber` cross the wire.

## B. Commands

```
specnaut spec pull <task>   # materialise the task's cloud spec into .specnaut/specs/.cache/<task>/
specnaut spec push <task>   # upsert local spec content for <task> to the cloud
```

- **Backend gate**: both require `specBackend: cloud` + a linked Cloud project. Under
  `local`, they exit with a clear "spec push/pull are cloud-backend commands" message.
- **`spec pull <task>`**: fetches the spec, clears + rewrites `.specnaut/specs/.cache/<task>/`,
  prints the written files. No spec on Cloud → clear "no spec for task <n>" (not an error crash).
- **`spec push <task>`**: reads the task's cache (or a specified source), upserts to Cloud,
  prints the pushed step count.
- **Exit codes** (mirror `gate_handler.ts`): `0` ok · `1` usage/local-backend · `5` cloud/auth
  failure (actionable message: retry / `specnaut cloud login`).
- **Offline/auth failure** (FR-008): `pull` reuses an existing cache if present; otherwise a
  non-zero exit with an actionable message — never a partial/empty spec.

## Template-rendered behaviour (not compiled)

- `specify.md` cloud block: generate steps → `spec push` (auto-create+link task if unlinked) →
  no branch, no `.specnaut/specs/` files. Local block: unchanged (files + existing branch hook).
- `implement.md` cloud block: `create-new-feature.sh --branch-only` (the branch-creation point).
