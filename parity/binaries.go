// Package parity is a black-box oracle for the specnaut CLI binary.
//
// It runs a binary it is given — never one it builds — across a matrix of
// scenarios, records what each scenario produced (stdout, stderr, exit code,
// and the resulting file tree), and, given a second binary, reports every
// difference by scenario and artefact. It imports no CLI code and runs no
// Deno, so the same oracle judges the TypeScript binary and its successor.
package parity

import (
	"debug/buildinfo"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
)

// The environment variables that name the binaries under test.
const (
	BinVar  = "SPECNAUT_BIN"
	BinBVar = "SPECNAUT_BIN_B"
)

// Binary is one CLI binary under test.
type Binary struct {
	Label            string   // "A", "B", or "mutant:<kind>"
	Path             string   // absolute path of what the harness executes
	Impl             string   // "go" for a Go binary, "other" for anything else
	VersionLine      string   // `--version` output, colour codes removed
	Version          string   // the binary's own version
	TemplatesVersion string   // the templates version it ships
	Env              []string // extra scenario variables (a mutant's settings)

	legacyOnce sync.Once
	legacyPath string
	legacyErr  error
}

type loaded struct {
	a, b *Binary
	skip string
	err  error
}

var load = sync.OnceValue(func() loaded {
	pa, pb := os.Getenv(BinVar), os.Getenv(BinBVar)
	if pa == "" {
		return loaded{skip: BinVar + " is unset: the parity harness needs a CLI binary to run " +
			"(it never builds one); set " + BinVar + " (and " + BinBVar + " to diff two)"}
	}
	a, err := Probe("A", pa)
	if err != nil {
		return loaded{err: err}
	}
	if pb == "" {
		return loaded{a: a}
	}
	b, err := Probe("B", pb)
	return loaded{a: a, b: b, err: err}
})

// Binaries returns the binary under test and, in diff mode, the second one.
// With SPECNAUT_BIN unset it skips the test — a parity test that ran nothing
// must read SKIP, never PASS. b is nil in run mode.
func Binaries(t testing.TB) (a, b *Binary) {
	t.Helper()
	l := load()
	if l.skip != "" {
		t.Skip(l.skip)
	}
	if l.err != nil {
		t.Fatal(l.err)
	}
	return l.a, l.b
}

var versionLine = regexp.MustCompile(`^specnaut (\S+) \(templates (\S+)\)$`)

// Probe resolves a binary path and reads its identity: implementation and
// `--version`. It runs only `--version`, in an empty environment.
func Probe(label, path string) (*Binary, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(abs); err != nil {
		return nil, fmt.Errorf("%s binary: %w", label, err)
	}
	out, err := runSealed(abs, "--version")
	if err != nil {
		return nil, fmt.Errorf("%s binary %s --version: %w", label, abs, err)
	}
	line := strings.TrimSpace(StripANSI(out))
	b := &Binary{Label: label, Path: abs, Impl: implOf(abs), VersionLine: line}
	if m := versionLine.FindStringSubmatch(line); m != nil {
		b.Version, b.TemplatesVersion = m[1], m[2]
	}
	return b, nil
}

// implOf tells a Go binary from any other by its embedded build information.
// It decides which exclusions apply to a pair (excluded.go), and needs no
// variable that a caller could set wrong.
func implOf(path string) string {
	if _, err := buildinfo.ReadFile(path); err == nil {
		return "go"
	}
	return "other"
}

// runSealed runs the binary outside any scenario, with only a throwaway HOME
// and a system PATH. Used for `--version` and `--help`, which read nothing.
func runSealed(path string, args ...string) (string, error) {
	home, err := os.MkdirTemp("", "parity-probe")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(home)
	cmd := exec.Command(path, args...)
	cmd.Env = []string{"HOME=" + home, "PATH=/usr/bin:/bin", "TERM=dumb"}
	cmd.Dir = home
	out, err := cmd.Output()
	return string(out), err
}

// Help returns the binary's `--help` text, colour codes removed.
func (b *Binary) Help() (string, error) {
	out, err := runSealed(b.Path, "--help")
	return StripANSI(out), err
}

// LegacyPath is a copy of the binary named `specflow`, the pre-rebrand name
// the CLI warns about. A copy, not a symlink: on Linux the executable path the
// CLI reads resolves symlinks, so only a file of that name triggers the
// warning on every host.
func (b *Binary) LegacyPath() (string, error) {
	b.legacyOnce.Do(func() {
		if b.Env != nil {
			b.legacyErr = fmt.Errorf("%s: a mutant has no legacy name", b.Label)
			return
		}
		dir, err := os.MkdirTemp("", "parity-legacy")
		if err != nil {
			b.legacyErr = err
			return
		}
		registerCleanup(func() { os.RemoveAll(dir) })
		b.legacyPath = filepath.Join(dir, "specflow")
		b.legacyErr = copyExecutable(b.Path, b.legacyPath)
	})
	return b.legacyPath, b.legacyErr
}

func copyExecutable(from, to string) error {
	data, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, data, 0o755)
}

var ansi = regexp.MustCompile("\x1b\\[[0-9;]*m")

// StripANSI removes SGR colour codes. Used only to read a binary's identity
// and help text; records keep the raw bytes, colour included.
func StripANSI(s string) string { return ansi.ReplaceAllString(s, "") }

var (
	cleanupMu sync.Mutex
	cleanups  []func()
)

func registerCleanup(f func()) {
	cleanupMu.Lock()
	defer cleanupMu.Unlock()
	cleanups = append(cleanups, f)
}

// RunCleanups removes what the harness created outside any test's temp dir.
// TestMain calls it after the tests.
func RunCleanups() {
	cleanupMu.Lock()
	defer cleanupMu.Unlock()
	for _, f := range cleanups {
		f()
	}
	cleanups = nil
}
