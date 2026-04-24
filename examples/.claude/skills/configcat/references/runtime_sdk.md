# ConfigCat Runtime SDK

## Purpose

Use the Node SDK to understand what the application actually evaluates at
runtime.

## Miximodel Runtime Model

- Backend-only evaluation via `configcat-node`
- `FeatureFlagService` is the application-facing abstraction
- Frontend reads only the server-evaluated `featureFlags` snapshot

## Relevant SDK Behaviors

- `getValueAsync(key, defaultValue, user?)` Returns the evaluated flag value.
- `getValueDetailsAsync(key, defaultValue, user?)` Returns value plus
  `isDefaultValue`, `variationId`, matching rule metadata, and fetch time.
- `forceRefreshAsync()` Required when using Manual Polling.
- `waitForReady()` Useful when using Auto Polling and you want to wait for
  initialization.

## Good Debug Signals

- `isDefaultValue` Tells you whether the SDK fell back instead of using remote
  config.
- `variationId` Useful to confirm which variation actually matched.
- `matchedTargetingRule` Useful when rollout rules depend on user targeting.

## Common Local Checks

- Confirm `CONFIGCAT_SDK_KEY` is loaded.
- Check `promotion` with `getValueDetailsAsync()`.
- Confirm the app exposes the same boolean in Inertia shared props.
