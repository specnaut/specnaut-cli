# ConfigCat Troubleshooting

## Promotion Flag Is Enabled But UI Does Not Change

Check in this order:

1. The local process sees `CONFIGCAT_SDK_KEY`.
2. The SDK key belongs to the intended ConfigCat environment.
3. `getValueDetailsAsync('promotion', false)` returns `value: true` and
   `isDefaultValue: false`.
4. The Inertia HTML contains `"promotion":true`.
5. The current page and viewport actually render the gated component.

## Prod vs Non-Prod Confusion

- SDK keys are environment-specific.
- Toggling a flag in non-prod does nothing if local runtime still uses the prod
  SDK key.
- Management API credentials are separate from SDK keys and do not control
  runtime evaluation.

## Management API Works But Runtime Does Not

- The Management API shows configuration state, not runtime evaluation.
- Runtime evaluation depends on the SDK key, polling state, and optional user
  context.
- Compare API state with `variationId` and runtime-side
  `getValueDetailsAsync()`.

## Responsive UI Blind Spot

- Some premium surfaces are hidden on smaller breakpoints.
- Confirm the tested page actually renders the sidebar or bottom bar you expect.
