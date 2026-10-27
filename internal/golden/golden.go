// Package golden reads the differential goldens internal/testdata/golden.ts
// writes: the TypeScript implementation's own answers, one JSON value per
// line, which the Go ports are judged against. Test support only.
package golden

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

// Load decodes every line of a .jsonl golden, and fails the test on a file
// holding fewer than min cases — a truncated golden must not pass by having
// nothing left to compare.
func Load[T any](t testing.TB, path string, min int) []T {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out []T
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		var v T
		if err := json.Unmarshal(sc.Bytes(), &v); err != nil {
			t.Fatalf("%s:%d: %v", path, len(out)+1, err)
		}
		out = append(out, v)
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	if len(out) < min {
		t.Fatalf("%s holds %d cases, want at least %d: is it truncated?", path, len(out), min)
	}
	return out
}
