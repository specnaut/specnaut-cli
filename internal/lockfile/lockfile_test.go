package lockfile

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/specnaut/specnaut-cli/internal/golden"
)

// The goldens are internal/testdata/golden.ts's output: parseLock and
// assertSafeDestination run on the same inputs, so the port is judged
// against the implementation.

type lockCase struct {
	Name   string `json:"name"`
	YAML   string `json:"yaml"`
	Result struct {
		Harness string   `json:"harness"`
		Entries []string `json:"entries"`
		Removed string   `json:"removed"`
		Error   string   `json:"error"` // "<class>: <message>"
	} `json:"result"`
}

// reason is the Go refusal spelled as the golden spells TypeScript's. A
// SyntaxError is held to its class only (yaml.go says why); every refusal of
// parseLock's own is held to its exact text.
func reason(err error, want string) (got string, same bool) {
	var syntax *SyntaxError
	if errors.As(err, &syntax) {
		return "SyntaxError: " + err.Error(), strings.HasPrefix(want, "SyntaxError: ")
	}
	got = "Error: " + err.Error()
	return got, got == want
}

func TestParseMatchesParseLock(t *testing.T) {
	cases := golden.Load[lockCase](t, "testdata/lock_golden.jsonl", 25)
	for _, c := range cases {
		lock, err := Parse([]byte(c.YAML))
		want := c.Result
		var removed *RemovedHarnessError
		switch {
		case want.Removed != "":
			if !errors.As(err, &removed) || removed.Error() != want.Removed {
				t.Errorf("%s: err = %v; parseLock throws RemovedHarnessError %q", c.Name, err, want.Removed)
			}
		case want.Error != "":
			if err == nil || errors.As(err, &removed) {
				t.Errorf("%s: err = %v; parseLock throws %q", c.Name, err, want.Error)
			} else if got, same := reason(err, want.Error); !same {
				t.Errorf("%s: refused for %q; parseLock: %q", c.Name, got, want.Error)
			}
		case err != nil:
			t.Errorf("%s: %v; parseLock accepts it", c.Name, err)
		default:
			keys := make([]string, 0, len(lock.Entries))
			for k := range lock.Entries {
				keys = append(keys, k)
			}
			slices.Sort(keys)
			if lock.Harness != want.Harness || !slices.Equal(keys, want.Entries) {
				t.Errorf("%s: harness %q entries %q; parseLock: %q %q", c.Name, lock.Harness, keys, want.Harness, want.Entries)
			}
		}
	}
}

type destinationCase struct {
	Dest   string `json:"dest"`
	Result string `json:"result"`
}

func TestSafeDestinationMatchesAssertSafeDestination(t *testing.T) {
	for _, c := range golden.Load[destinationCase](t, "testdata/destination_golden.jsonl", 28) {
		got := "ok"
		if err := SafeDestination(c.Dest); err != nil {
			got = err.Error()
		}
		if got != c.Result {
			t.Errorf("SafeDestination(%q) = %q, assertSafeDestination: %q", c.Dest, got, c.Result)
		}
	}
}

func TestReadWithoutALockIsNil(t *testing.T) {
	lock, err := Read(fstest.MapFS{})
	if lock != nil || err != nil {
		t.Errorf("Read(empty) = %v, %v; want nil, nil", lock, err)
	}
	if _, err := Read(fstest.MapFS{Path: {Data: []byte("version: [")}}); err == nil {
		t.Error("a malformed lock read as fine")
	}
}

func TestRefuseRoot(t *testing.T) {
	for _, c := range []struct {
		root, home string
		refused    bool
	}{
		{"/", "/home/a", true},
		{"/home/a", "/home/a", true},
		{"/home/a/p", "/home/a", false},
		{"/home/a", "", false},
	} {
		if err := RefuseRoot(c.root, c.home); (err != nil) != c.refused {
			t.Errorf("RefuseRoot(%q, %q) = %v", c.root, c.home, err)
		}
	}
}
