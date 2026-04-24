# Dagger Module Structure

## Initialization

```bash
# Initialize from project root
dagger init --sdk=typescript --name=ci
dagger develop   # generates type bindings and installs SDK
```

## Directory Layout

```text
.dagger/
├── dagger.json          # Module metadata (name, SDK, engine version)
├── package.json         # SDK dependency (@dagger.io/dagger)
├── tsconfig.json        # TypeScript config for the module
└── src/
    └── index.ts         # Main module file (all @func definitions)
```

## dagger.json

```json
{
  "name": "ci",
  "sdk": "typescript",
  "engineVersion": "v0.20.5"
}
```

Key fields:
- `name`: Module name (lowercase, matches PascalCase class name)
- `sdk`: Must be `typescript`
- `engineVersion`: Pin to a specific engine version for reproducibility

## Module Entry Point

The main file is `.dagger/src/index.ts`. It exports a single class decorated
with `@object()` whose name matches the module name in PascalCase:

```typescript
import { dag, object, func, Container, Directory, Service } from "@dagger.io/dagger"

@object()
class Ci {
  // All @func() methods go here
}
```

## Naming Convention

- Module name in `dagger.json`: lowercase (`ci`, `my-pipeline`)
- Class name in `index.ts`: PascalCase (`Ci`, `MyPipeline`)
- Function names in TypeScript: camelCase (`buildApp`, `runTests`)
- Function names in CLI: kebab-case (`build-app`, `run-tests`)

## Adding Dependencies

The `.dagger/` directory has its own `package.json`. Add dependencies with:

```bash
cd .dagger && npm install <package> && cd ..
```

The module's `node_modules` is separate from the project's.

## .gitignore

Add to your project's `.gitignore`:

```text
.dagger/node_modules/
.dagger/sdk/
```

Keep `.dagger/dagger.json`, `.dagger/package.json`, `.dagger/tsconfig.json`,
and `.dagger/src/` in version control.
