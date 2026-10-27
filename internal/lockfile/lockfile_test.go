package lockfile

import (
	"encoding/json"
	"errors"
	"os"
	"slices"
	"testing"
	"testing/fstest"
)

// The goldens are internal/testdata/golden.ts's output: parseLock and
// assertSafeDestination run on the same inputs, so the port is judged
// against the implementation.

func readGolden(t *testing.T, name string, into any) {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, into); err != nil {
		t.Fatal(err)
	}
}

func TestParseMatchesParseLock(t *testing.T) {
	var cases []struct {
		Name   string `json:"name"`
		YAML   string `json:"yaml"`
		Result struct {
			Harness string   `json:"harness"`
			Entries []string `json:"entries"`
			Removed string   `json:"removed"`
			Error   bool     `json:"error"`
		} `json:"result"`
	}
	readGolden(t, "lock_golden.json", &cases)
	for _, c := range cases {
		lock, err := Parse([]byte(c.YAML))
		want := c.Result
		var removed *RemovedHarnessError
		switch {
		case want.Removed != "":
			if !errors.As(err, &removed) || removed.Error() != want.Removed {
				t.Errorf("%s: err = %v; parseLock throws RemovedHarnessError %q", c.Name, err, want.Removed)
			}
		case want.Error:
			if err == nil || errors.As(err, &removed) {
				t.Errorf("%s: err = %v; parseLock throws (not a removed harness)", c.Name, err)
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
	if len(cases) < 25 {
		t.Fatalf("only %d lock cases", len(cases))
	}
}

func TestSafeDestinationMatchesAssertSafeDestination(t *testing.T) {
	var cases []struct {
		Dest   string `json:"dest"`
		Result string `json:"result"`
	}
	readGolden(t, "destination_golden.json", &cases)
	for _, c := range cases {
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
