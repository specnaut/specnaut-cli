//go:build !darwin

package main

// secretHandOff: on Linux (Secret Service over D-Bus) and Windows (wincred)
// go-keyring starts no child process, so no argv can carry the secret.
const secretHandOff = "n/a: no child process"
