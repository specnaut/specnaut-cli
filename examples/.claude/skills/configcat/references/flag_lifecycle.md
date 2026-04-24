# Flag Lifecycle Commands

## Recommended Lifecycle

Deleting a remote flag immediately is usually the wrong first move.

Preferred sequence:

1. Turn the flag off in the target environments.
2. Remove or migrate runtime code that still depends on the key.
3. Deploy the code that no longer references the flag.
4. Search the repo for any remaining uses of the key.
5. Delete the remote flag only when references are gone or explicitly accepted.

## Why Delete Needs Guard Rails

Deleting a flag that is still referenced can cause:

- fallback-to-default behavior that hides a production issue
- dead code paths that nobody notices immediately
- confusion between dashboard state and runtime behavior
- accidental reuse of a retired key for a different purpose later

## Supported Command Patterns

### Add

Creates a boolean feature flag and sets one environment's initial value.

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/add_feature_flag.sh \
  --config <configId> \
  --environment <environmentId> \
  --key <slug> \
  --name "Human readable name" \
  --value false
```

### Update

Updates metadata and optionally one environment's default value.

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/update_feature_flag.sh \
  --config <configId> \
  --key <slug> \
  --name "New name" \
  --environment <environmentId> \
  --value true
```

### Search

Searches the repo for a flag key.

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/search_flag_usage.sh promotion
```

### Delete

Deletion is intentionally guarded. The script searches for usages first and
refuses to delete without explicit force flags.

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/delete_feature_flag.sh \
  --config <configId> \
  --key <slug> \
  --force
```

If references still exist in the repo, deletion also requires
`--allow-references`.
