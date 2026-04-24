---
name: configcat
description: ConfigCat feature-flag knowledge base for Miximodel. Use when implementing, debugging, documenting, or operating ConfigCat flags, SDK keys, environments, Management API access, rollout rules, or troubleshooting why a flag differs between local, non-prod, and prod. Trigger on "configcat", "config4", "feature flag", "promotion flag", "maintenanceMode", "SDK key", "variationId", "Management API", or "basic auth".
disable-model-invocation: true
argument-hint: <inspect|add|update|delete|search|api> ...
---

# ConfigCat Skill

This skill keeps ConfigCat operations split between lightweight instructions,
supporting reference docs, and executable scripts that load secrets from the
sibling `.env` file themselves.

## Usage

- Invoke this skill manually as `/configcat ...` for inspection or mutations.
- Use the scripts in `scripts/` for Management API reads instead of manually
  handling Basic Auth in prompts.
- Use the reference docs in `references/` when you need API or SDK details.
- Keep runtime flag evaluation on the backend via `FeatureFlagService`.

## Core Workflow

1. Check whether the local app uses the intended SDK key and environment.
2. If mutating flags, prefer the dispatcher script over raw API calls.
3. Use a bundled script to fetch ConfigCat Management API JSON.
4. Use the Node SDK runtime or the app's Inertia props to verify evaluated flag
   values.
5. Compare the management-side state with the runtime-side evaluation.

## Slash Commands

- `/configcat inspect products`
- `/configcat inspect configs <productId>`
- `/configcat inspect environments <productId>`
- `/configcat inspect project-environments [productName]`
- `/configcat inspect settings <configId>`
- `/configcat inspect values <configId> <environmentId>`
- `/configcat inspect flag-status <slug> [productName] [configName]`
- `/configcat add --config <configId> --environment <environmentId> --key <slug> [--name <display-name>] [--value true|false] [--hint <text>]`
- `/configcat update --config <configId> --key <slug> [--name <display-name>] [--hint <text>] [--clear-hint] [--environment <environmentId> --value true|false]`
- `/configcat search <slug> [repoRoot]`
- `/configcat delete --config <configId> --key <slug> [--repo-root <path>] --force [--allow-references]`

The skill should route these commands through:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/configcat_flag.sh $ARGUMENTS
```

For `delete`, always summarize the consequences first, run the usage search, and
only continue if the command includes the explicit force flags accepted by the
script.

## Scripts

- `scripts/configcat_flag.sh`
  Dispatcher for `inspect`, `add`, `update`, `delete`, `search`, and `api`.
- `scripts/search_flag_usage.sh <slug> [repoRoot]`
  Searches the codebase for remaining references to a flag key.
- `scripts/add_feature_flag.sh ...`
  Creates a new boolean feature flag with an initial environment value.
- `scripts/update_feature_flag.sh ...`
  Updates flag metadata and/or one environment's default value.
- `scripts/delete_feature_flag.sh ...`
  Deletes a flag only after warning, search, and explicit confirmation flags.
- `scripts/configcat_api.sh`
  Generic authenticated wrapper for the ConfigCat Public Management API.
- `scripts/list_products.sh`
  Lists accessible products.
- `scripts/list_product_configs.sh <productId>`
  Lists configs for a product.
- `scripts/list_product_environments.sh <productId>`
  Lists environments for a product.
- `scripts/list_project_environments.sh [productName]`
  Resolves the product by name and lists its environments. Defaults to `Miximodel`.
- `scripts/list_config_settings.sh <configId>`
  Lists settings in a config.
- `scripts/list_config_values.sh <configId> <environmentId>`
  Lists values for one config/environment pair using the ConfigCat v2 endpoint.
- `scripts/inspect_flag_status.sh <slug> [productName] [configName]`
  Resolves the product and config by name, then prints one flag's value across environments.

## Reference Docs

- [CloudCode skill notes](references/cloudcode_skill_notes.md)
- [ConfigCat management API](references/management_api.md)
- [ConfigCat runtime SDK](references/runtime_sdk.md)
- [Flag lifecycle commands](references/flag_lifecycle.md)
- [ConfigCat troubleshooting](references/troubleshooting.md)

## Operational Rules

- Never commit `.env` from this skill folder.
- Never paste Basic Auth credentials into tickets, docs, or prompts.
- Prefer the bundled scripts over ad hoc `curl` commands.
- Treat `CONFIGCAT_SDK_KEY` and Management API credentials as separate concerns.
- Prefer the decommission flow in `references/flag_lifecycle.md` before deleting
  a feature flag remotely.