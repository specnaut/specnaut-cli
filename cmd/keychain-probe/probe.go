package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"runtime/debug"

	gokeyring "github.com/zalando/go-keyring"
)

// keyring is the slice of go-keyring the probe uses, so the driver is tested
// without an OS store.
type keyring interface {
	Set(service, account, secret string) error
	Get(service, account string) (string, error)
	Delete(service, account string) error
}

type goKeyring struct{}

func (goKeyring) Set(s, a, p string) error        { return gokeyring.Set(s, a, p) }
func (goKeyring) Get(s, a string) (string, error) { return gokeyring.Get(s, a) }
func (goKeyring) Delete(s, a string) error        { return gokeyring.Delete(s, a) }

func isMiss(err error) bool { return errors.Is(err, gokeyring.ErrNotFound) }

func printf(w io.Writer, format string, a ...any) { fmt.Fprintf(w, format, a...) }

// randomAccount names an item that cannot exist.
func randomAccount() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read never returns an error (Go 1.24+)
	return "absent-" + hex.EncodeToString(b)
}

// report prints an operation's outcome — ok, miss, or the error's TYPE only:
// a backend message may echo what it was given.
func report(w io.Writer, op string, err error) int {
	switch {
	case err == nil:
		printf(w, "%s: ok\n", op)
		return 0
	case isMiss(err):
		printf(w, "%s: miss\n", op)
		return 0
	}
	printf(w, "%s: error (%T)\n", op, err)
	return 1
}

// reachable is the non-throwing probe the TypeScript selector relies on
// (`KeychainBackend.reachable`). go-keyring has none, so it is built from a
// lookup of an account that cannot exist: "not found" means a store answered.
func reachable(kr keyring, service string) bool {
	_, err := kr.Get(service, randomAccount())
	return isMiss(err)
}

func withCanary(o options, canary string, kr keyring, w io.Writer) int {
	switch o.mode {
	case "write":
		return report(w, "write", kr.Set(o.service, o.account, canary))
	case "read":
		return compare(w, kr, o, canary)
	case "roundtrip":
		return roundtrip(w, kr, o, canary)
	}
	printf(w, "unknown mode %q\n", o.mode)
	return 2
}

// compare reads the item and says only whether it is the canary, and how long
// it is — enough to tell "absent", "wrong encoding" and "identical" apart.
func compare(w io.Writer, kr keyring, o options, canary string) int {
	got, err := kr.Get(o.service, o.account)
	if err != nil {
		return report(w, "read", err)
	}
	verdict := "mismatch"
	if got == canary {
		verdict = "match"
	}
	printf(w, "read: %s length=%d (canary length=%d)\n", verdict, len(got), len(canary))
	if verdict == "match" {
		return 0
	}
	return 1
}

// roundtrip is set, get, remove in one process, with the removal deferred so
// a failed read never leaves an item behind.
func roundtrip(w io.Writer, kr keyring, o options, canary string) (code int) {
	if c := report(w, "write", kr.Set(o.service, o.account, canary)); c != 0 {
		return c
	}
	defer func() {
		if c := report(w, "remove", kr.Delete(o.service, o.account)); c != 0 && code == 0 {
			code = c
		}
	}()
	return compare(w, kr, o, canary)
}

// versionReport pins what was measured: the go-keyring module version, and
// how this OS's backend hands the secret over (argv_*.go).
func versionReport() string {
	v := "unknown"
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, d := range info.Deps {
			if d.Path == "github.com/zalando/go-keyring" {
				v = d.Version
			}
		}
	}
	return "go-keyring " + v + "\nsecret hand-off: " + secretHandOff
}
