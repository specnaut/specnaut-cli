# Supply chain and integrity

> **Attack surface** — everything that enters the build without being
> written by the team: dependencies, base images, actions and plugins,
> CDN-served assets, downloaded installers, auto-updates. Plus the pipeline
> that assembles them, which usually holds the most powerful credentials in
> the organisation. Supply chain became its own Top 10 category in 2025;
> integrity failures are its sibling.
>
> **OWASP** A03:2025 Software Supply Chain Failures ·
> A08:2025 Software or Data Integrity Failures ·
> **ASVS** V15 (Secure Coding and Architecture)

> **Hand-off** — per-dependency CVE triage, licence policy, and version
> currency belong to the `dependency-expert`. This file covers the
> *shape* of the supply chain: pinning, provenance, pipeline trust, and
> integrity verification.

## Where to look

- Manifests and lockfiles — and whether the lockfile is committed at all.
- CI/CD workflow definitions: triggers, permissions, secret exposure,
  third-party actions and their pinning.
- Container base images and their tags.
- Install and bootstrap scripts, especially anything piping a download
  into a shell.
- `<script>` and `<link>` tags pointing at a third-party origin.
- Post-install and build hooks in package manifests.
- Auto-update and plugin-loading code paths.

**Search signatures.** `^`, `~`, `*`, `latest` in a manifest; a missing
lockfile; `curl ... | sh`, `wget ... | bash`; `uses:` without a pinned
commit SHA; `FROM image:latest`; `postinstall`, `prepare`, `preinstall`;
`<script src="https://` without `integrity=`;
`pull_request_target`, `permissions:` blocks, `secrets.` in a workflow.

## Failure modes

### Unpinned or floating versions

Ranges (`^`, `~`, `*`, `latest`) mean the artefact built today differs from
the one built tomorrow. A compromised release lands automatically, and the
build is not reproducible.

*Confirm* — a committed lockfile with integrity hashes largely answers this
for application code. A library legitimately declares ranges; check what
kind of project it is before flagging.

*Severity* — MEDIUM; HIGH when there is no lockfile at all.

### Missing integrity verification

Downloaded artefacts used without a checksum or signature check: an
installer, a binary release, a base image by mutable tag, a third-party
script tag without Subresource Integrity.

*Confirm* — pin by digest, verify a checksum, or verify a signature. Trust
on first use, repeated on every build, is not verification.

*Severity* — HIGH.

### Install scripts piped straight into a shell

`curl … | sh` in a Dockerfile, CI step, or setup guide. The remote content
is executed unverified, with whatever privileges the step holds.

*Confirm* — download, verify a pinned checksum, then execute.

*Severity* — HIGH; CRITICAL in a step that holds credentials.

### Dependency confusion and typosquatting

A private package name resolvable from a public registry, so the public one
wins; or a name one character from a popular package; or a hallucinated
package name adopted from generated code (an attacker registers invented
names and waits — **slopsquatting**).

*Confirm* — scoped or namespaced private packages, a registry configuration
that does not fall back to public for internal scopes, and verification
that any newly added dependency exists under the intended publisher.

*Severity* — CRITICAL for a resolvable confusion path.

### Over-privileged or injectable pipeline

The pipeline is the highest-value target: it holds signing keys, registry
credentials, and deploy access.

- Workflows triggered by untrusted contributions that also expose secrets.
- Untrusted input interpolated into a shell step — a branch name, a PR
  title, an issue body — which is command injection with the pipeline's
  privileges.
- Third-party actions or plugins referenced by mutable tag rather than
  commit digest.
- Blanket write permissions where read would do.

*Confirm* — least-privilege permissions, pinning by digest, untrusted input
passed through the environment rather than interpolated into a command,
and secrets scoped to the jobs that need them.

*Severity* — CRITICAL.

### Unverified auto-update or plugin loading

The application fetches and executes code at runtime — an update, a plugin,
a remote configuration that drives behaviour — without verifying a
signature.

*Confirm* — signature verification against a pinned public key or a pinned
certificate authority, before loading, plus an allowlist of sources. Keyless
signing over a workload identity (Sigstore and equivalents) satisfies this
without a stored private key: the verifier pins the issuing authority and the
identity permitted to sign rather than a key file.

*Confirm the anchor is not the artefact.* A checksum published beside the file
it describes is a transport check, not a signature — whoever can replace one
replaces both. Ask where the verifying material comes from, and count the
control only when the answer is somewhere the attacker would have to compromise
separately.

*Severity* — CRITICAL.

### Deserialization of unsigned data across a trust boundary

Serialized state handed to a client and accepted back, or a signed blob
deserialized *before* the signature is verified. Order matters: verify,
then deserialize. See `03-injection-and-input.md`.

*Severity* — CRITICAL.

### No component inventory

No SBOM and no reliable list of what ships. When an advisory lands, nobody
can answer "are we affected?" quickly, which is the whole point.

*Severity* — MEDIUM.

### Unused and unmaintained dependencies

Packages declared but unused, or unmaintained for years, or pulling
transitive trees far larger than the value they provide. Each is attack
surface with no owner.

*Severity* — LOW to MEDIUM.

## When it is NOT a finding

- **The advisory does not affect the code path in use.** Most advisories are
  conditional on a function, option or platform. A vulnerable version present is
  not the same as a vulnerable application — say which one you established.
- **It is a development or build-time dependency.** Still worth reporting, but
  the blast radius is the build, not production traffic, and the severity must
  say so.
- **The unpinned range is on an internal package** you publish and control.
  The risk model is different from an unpinned third-party range.
- **A lockfile exists and pins the transitive tree.** A loose range in a
  manifest with a committed lockfile is not floating in practice.
- **An unfamiliar package name is not a typosquat.** Confirm against the
  registry before implying it. A wrong accusation here is expensive and
  personal.

## Secure patterns

**Pin exactly, verify integrity, audit.**

```bash
# UNSAFE — resolves to whatever is newest at build time
npm install some-package

# SAFE — exact version, then verify and audit
npm install some-package@1.2.3 --save-exact
npm audit
npm audit signatures
```

**Commit the lockfile with integrity hashes.**

```json
{
  "dependencies": {
    "example-lib": {
      "version": "4.17.21",
      "integrity": "sha512-<hash>"
    }
  }
}
```

**Subresource Integrity on third-party assets.**

```html
<!-- UNSAFE — the CDN can change the file under you -->
<script src="https://cdn.example.com/lib.js"></script>

<!-- SAFE -->
<script src="https://cdn.example.com/lib.js"
        integrity="sha384-<hash>"
        crossorigin="anonymous"></script>
```

**Never interpolate untrusted text into a pipeline shell step.**

```yaml
# UNSAFE — a crafted title executes in the runner
- run: echo "Building ${{ github.event.pull_request.title }}"

# SAFE — passed as data through the environment
- run: echo "Building $TITLE"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

## Review checklist

- [ ] Lockfile committed and used in CI (`ci` / `--frozen-lockfile`, not a
      resolving install)
- [ ] Direct dependencies pinned; integrity hashes present
- [ ] Base images and third-party actions pinned by digest, not by tag
- [ ] Downloaded artefacts checksum- or signature-verified before use
- [ ] No `curl | sh` in build, CI, or container steps
- [ ] Private package names cannot be resolved from a public registry
- [ ] Newly added dependencies verified to exist under the intended
      publisher
- [ ] Third-party script and style tags carry Subresource Integrity
- [ ] Pipeline permissions least-privilege; secrets scoped per job
- [ ] No untrusted input interpolated into a pipeline shell command
- [ ] Auto-update and plugin loading verify a signature before executing
- [ ] Serialized data crossing a trust boundary is signed, and verified
      before deserialization
- [ ] A component inventory (SBOM) is produced and retained
- [ ] Unused dependencies removed
- [ ] Advisories monitored continuously — hand CVE triage to the
      `dependency-expert`
