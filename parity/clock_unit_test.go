package parity

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestPinClockRewritesEveryRecordedTimestamp(t *testing.T) {
	in := "entries:\n  a:\n    installed_at: '2026-11-12T07:52:32.464Z'\n  b:\n    installed_at: '2026-11-12T07:52:33Z'\n"
	want := "entries:\n  a:\n    installed_at: '" + PinnedInstant + "'\n  b:\n    installed_at: '" + PinnedInstant + "'\n"
	got, n := PinClock(in)
	if got != want || n != 2 {
		t.Errorf("PinClock = %q, %d; want %q, 2", got, n, want)
	}
}

func TestPinClockLeavesEverythingElse(t *testing.T) {
	in := "templates_version: 7.0.3\nsha256: 2026\n"
	if got, n := PinClock(in); got != in || n != 0 {
		t.Errorf("PinClock = %q, %d; want it unchanged, 0", got, n)
	}
}

// A file with no timestamp is refused, not pinned in silence: the scenario
// pinned the wrong file, and its commit ids would vary again.
func TestPinFileRefusesAFileWithNoTimestamp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lock.yml")
	in := "templates_version: 7.0.3\n"
	if err := os.WriteFile(path, []byte(in), 0o644); err != nil {
		t.Fatal(err)
	}
	err := pinFile(path, "lock.yml")
	if err == nil || err.Error() != "pin-clock: lock.yml holds no timestamp to pin" {
		t.Errorf("pinFile = %v; want the no-timestamp refusal", err)
	}
	if got, _ := os.ReadFile(path); string(got) != in {
		t.Errorf("the refused file changed: %q", got)
	}
}

// Pinning hides nothing a record would not hide already: what pin-clock
// rewrites is exactly what the iso-timestamp rule absorbs.
func TestPinClockMatchesWhatTheRecordAbsorbs(t *testing.T) {
	for _, s := range []string{"at: 2026-11-12T07:52:32.464Z", "2026-11-12 07:52:32", "2026-11-12T07:52:32+01:00"} {
		pinned, _ := PinClock(s)
		if Normalise(pinned, Context{}) != Normalise(s, Context{}) {
			t.Errorf("%q: pinned %q normalises differently from the original", s, pinned)
		}
	}
}

// A commit hashes its dates as well as its tree: git's and the lock's clock
// are one instant.
func TestGitCommitsAtThePinnedInstant(t *testing.T) {
	vars := isolationVars("/w", "/w/home")
	for _, v := range []string{"GIT_AUTHOR_DATE=" + PinnedInstant, "GIT_COMMITTER_DATE=" + PinnedInstant} {
		if !slices.Contains(vars, v) {
			t.Errorf("isolationVars lacks %s", v)
		}
	}
}
