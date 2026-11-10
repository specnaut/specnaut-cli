# infra — macOS release signing

`Pulumi.yaml` declares the Google Cloud side of the macOS signing in `.github/workflows/release.yml`
(cli#428): a Workload Identity pool with one provider, a service account, three Secret Manager
containers with per-secret access, and Secret Manager `DATA_READ` audit logs. It references the GCP
project `specnaut` and owns nothing project-wide.

The operator applies it; CI never does:

```bash
cd infra
pulumi stack init release-signing   # once
pulumi preview
pulumi up
```

`tests/scripts/release_signing_layout_test.ts` fails when the workflow's pool, provider, service
account or project differ from this file.

## Secret values

Pulumi creates the containers only. Each value is added out of band, from a file, so it never passes
through Pulumi state, a shell variable or an argument:

```bash
gcloud secrets versions add macos-developer-id-p12 --project=specnaut --data-file=developer-id.p12
gcloud secrets versions add macos-developer-id-p12-password --project=specnaut --data-file=p12-password.txt
gcloud secrets versions add app-store-connect-api-key --project=specnaut --data-file=api-key.json
```

`api-key.json` is what `rcodesign encode-app-store-connect-api-key` writes, for a key with the
Developer role. No service-account key is ever created.

## GitHub side

- The `macos-signing` environment, deployable from `v*` tags only.
- A tag ruleset limiting creation of `v*` tags to maintainers: whoever can push such a tag runs
  their own `release.yml` at it.
