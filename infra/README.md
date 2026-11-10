# infra — macOS release signing

`Pulumi.yaml` declares the Google Cloud side of the macOS signing in `.github/workflows/release.yml`
(cli#428): a Workload Identity pool with one provider, a service account, three Secret Manager
containers with per-secret access, and Secret Manager `DATA_READ` audit logs. It references the GCP
project `specnaut` and manages neither the project nor its APIs. The one project-wide setting it
owns is the project's Secret Manager audit config: an `IAMAuditConfig` is authoritative for its
service, so that config is written here and nowhere else, and it is protected against deletion. The
`gcp` provider plugin is pinned in the file.

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

## Gate before the first signed tag

The provider's condition keeps every other workflow out; it cannot keep out a principal that already
holds a project-level role reaching the secrets. Before the first signed tag, and after any change
to the project's IAM, read the policy:

```bash
gcloud projects get-iam-policy specnaut --format=json
```

It must show **no** service account and no principal other than the operators holding, at project
level, any of: a Secret Manager role (`roles/secretmanager.*`),
`roles/iam.serviceAccountTokenCreator` (it can mint the signer's tokens), or a Workload Identity
pool admin role (`roles/iam.workloadIdentityPoolAdmin`, which can rewrite the condition).
`roles/owner` and `roles/editor` reach all three. A finding is removed or narrowed first; the
release waits.

## GitHub side

- The `macos-signing` environment, deployable from `v*` tags only.
- A tag ruleset on `v*` restricting **creation, update and deletion** and **blocking force pushes**,
  with only maintainers in its bypass list: whoever can create or move such a tag runs their own
  `release.yml` at it. The provider's condition also pins the actor to the maintainer's GitHub id,
  so a tag pushed by anyone else cannot authenticate even if the ruleset is changed.
