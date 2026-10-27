package main

// secretHandOff is where go-keyring passes the secret to the child process on
// macOS, read from the pinned module source: keyring_darwin.go (v0.2.8)
// line 76 runs `/usr/bin/security -i`, and line 86 writes
// `add-generic-password -U -s … -a … -w <secret>` to its STDIN — so the
// secret is in no argv, which the maintainer's `eslogger exec` capture must
// confirm (macos-session.md). Get (line 44) runs `find-generic-password -s
// -a -w`, with no secret on its command line. Set stores the secret
// base64-encoded behind a `go-keyring-base64:` prefix (line 74).
const secretHandOff = "keyring_darwin.go@v0.2.8:86 — `security -i`, secret written to stdin, not argv"
