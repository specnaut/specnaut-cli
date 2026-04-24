# Dagger + GitHub Actions Integration

## GitHub Action

Use `dagger/dagger-for-github` to run Dagger Functions in CI.

### Basic Workflow

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dagger/dagger-for-github@v8.4.1
        with:
          version: "latest"
          call: all --source=.
```

### Action Inputs

| Input                   | Default            | Description                                    |
| :---------------------- | :----------------- | :--------------------------------------------- |
| `version`               | `"latest"`         | Dagger CLI version (semver or `"latest"`)      |
| `verb`                  | `"call"`           | Command verb: call, run, shell, check          |
| `args`                  | `""`               | Generic CLI arguments                          |
| `call`                  | `""`               | Arguments for `dagger call` (alias for args)   |
| `module`                | `""`               | Module reference (local or git URL)            |
| `cloud-token`           | `""`               | Dagger Cloud authentication token              |
| `dagger-flags`          | `"--progress plain"` | CLI flags                                    |
| `workdir`               | `"."`              | Working directory for CLI execution            |
| `enable-github-summary` | `"false"`          | Write job summary to GitHub                    |

### Action Outputs

| Output     | Description                          |
| :--------- | :----------------------------------- |
| `stdout`   | Standard output from the command     |
| `traceURL` | URL to Dagger Cloud execution trace  |

## Passing Source Code

The `--source=.` flag passes the checked-out repository as a `Directory`
argument:

```yaml
call: test --source=.
```

This maps to the `source: Directory` parameter in your Dagger Function.

## Secrets

Pass GitHub secrets via environment variables:

```yaml
- uses: dagger/dagger-for-github@v8.4.1
  env:
    SEGPAY_SECRET: ${{ secrets.SEGPAY_SECRET }}
  with:
    call: test --source=.
```

Then in your Dagger module, read from env or pass as `Secret` argument.

## Chaining Functions

Call multiple functions in a single invocation:

```yaml
call: build --source=. publish --address=ghcr.io/my/app:latest
```

## Shell Mode

For complex pipeline expressions:

```yaml
- uses: dagger/dagger-for-github@v8.4.1
  with:
    version: "latest"
    shell: container | from alpine | with-exec echo,"hello" | stdout
```

## Multi-Job Workflows

Split checks across jobs for parallel execution:

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dagger/dagger-for-github@v8.4.1
        with:
          call: lint --source=.

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dagger/dagger-for-github@v8.4.1
        with:
          call: test --source=.
```

## Version Pinning

Pin both the action version and the Dagger CLI version for reproducibility:

```yaml
- uses: dagger/dagger-for-github@v8.4.1  # pin action
  with:
    version: "0.20.5"                      # pin CLI
    call: test --source=.
```

## Replacing Existing CI

When replacing a GitHub Actions workflow with Dagger:

1. Keep the workflow file (`.github/workflows/ci.yml`)
2. Replace multi-step jobs with a single `dagger call` step
3. Remove service containers from the workflow (Dagger provisions them)
4. Remove Node.js setup steps (Dagger uses its own containers)
5. Remove environment variable blocks (move to Dagger module)

### Before (handwritten CI)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_PASSWORD: postgres
      redis:
        image: redis:7
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

### After (Dagger)

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dagger/dagger-for-github@v8.4.1
        with:
          call: all --source=.
```

All service provisioning, dependency installation, and test execution is defined
in the Dagger module -- the same code that runs locally.
