**Releases are signed now, and `self-update` verifies before it replaces the binary.**

Until this release, `self-update` compared a `.sha256` against the binary it shipped beside. Both
files live on the same release, so anyone able to publish or amend one publishes both and the check
passes. That defends against a corrupted transfer, not against substitution at the source — and the
distinction matters here more than usual, because the binary is the trust root for every instruction
file Specnaut writes into a project.

Signing is keyless, because a key pair is structurally forbidden in this repository: a stored key
would have to be an Actions secret, and this repository holds none by policy. The release workflow
exchanges its OIDC identity for a short-lived certificate; the verifier pins the issuing authority
and the exact identity permitted to sign — bound to the specific tag, so a bundle lifted from
another release of this same repository fails on identity before the bytes are ever compared.

The anchor is compiled into the binary. It cannot be fetched from the release being verified, which
is the flaw the checksum had.

**v4.3.0 is the version where the gate closes.** Below it, a release without a signature installs
with a checksum and a warning. From this release on, a missing signature is refused outright, and a
signature that is present and does not verify is refused at any version — publishing one is a claim,
and a claim that fails to check is worse evidence than none. There is deliberately no fallback path:
an attacker who can amend a release can also serve a bundle from an authority we do not recognise,
so a "fall back when verification fails" branch would hand them the old control back on request.

The practical consequence, stated rather than discovered: a failed update is now a result, not a
bug. The console names which control cleared the bytes, and names the reason when none did. Read the
reason before retrying. An older binary meeting a signed release ignores the new asset and keeps
working.

What a pass means is written down where it can be read: signed by the pinned identity under the
pinned authority, over these exact bytes. It is not transparency-log inclusion, and there is no
revocation check. A verifier vague about its guarantee gets cited for one it never made.

**Also in this release.** The agentic surface is in scope for review, bounded by the base's own
frame, and the triage gate that routes reports can now actually reach the seat it names. The `diff`
command takes a path, and a path it cannot resolve is now an error instead of a confident diff of an
unrelated file. On Windows, a good install is no longer reported as broken, and the hook that a
project move used to strand now survives it and can be repaired.
