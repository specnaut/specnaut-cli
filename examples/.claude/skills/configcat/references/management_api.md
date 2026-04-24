# ConfigCat Management API

## Purpose

Use the Public Management API to inspect ConfigCat entities programmatically:
products, configs, environments, settings, and environment values.

## Authentication

- Auth scheme: HTTP Basic Auth
- Base URL: `https://api.configcat.com`
- Credentials should be stored only in the sibling `.env` file.

## Important Rule

Do not use the Management API to evaluate feature flags for runtime behavior.
Use the SDK for evaluation and the Management API for inspection and
administration.

## Endpoints Used By Bundled Scripts

- `GET /v1/products`
- `GET /v1/products/{productId}/configs`
- `GET /v1/products/{productId}/environments`
- `GET /v1/configs/{configId}/settings`
- `GET /v1/configs/{configId}/environments/{environmentId}/values`
- `GET /v1/me`
- `POST /v1/configs/{configId}/settings`
- `PATCH /v1/settings/{settingId}`
- `PATCH /v1/environments/{environmentId}/settings/{settingId}/value`
- `DELETE /v1/settings/{settingId}`

## Generic Script Wrapper

Use `scripts/configcat_api.sh` when you need an endpoint that does not yet have
its own dedicated helper script.

Examples:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/configcat_api.sh /v1/me
bash ${CLAUDE_SKILL_DIR}/scripts/configcat_api.sh /v1/products
bash ${CLAUDE_SKILL_DIR}/scripts/configcat_api.sh /v1/products/<productId>/configs
```

## Rate Limiting

ConfigCat returns rate-limit headers such as:

- `X-Rate-Limit-Remaining`
- `X-Rate-Limit-Reset`
- `Retry-After` on `429 Too Many Requests`

The bundled wrapper prints the response body only. If you need headers too,
extend the script or call `curl -i` through the wrapper logic.
