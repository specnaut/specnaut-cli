package parity

import (
	"os"
	"regexp"

	"github.com/rogpeppe/go-internal/testscript"
)

// PinnedInstant is the one wall-clock instant a scenario's repositories are
// built at: git stamps every commit with it (env.go), and pin-clock writes it
// over the timestamps the binary recorded. A commit id hashes the commit's
// dates and its tree, so with both pinned the ids a scenario prints depend only
// on what the binary wrote, and two runs of one binary agree on them.
const PinnedInstant = "2026-01-01T00:00:00Z"

var recordedTimestamp = regexp.MustCompile(isoTimestamp)

// PinClock rewrites every recorded timestamp in s to PinnedInstant and says
// how many it rewrote. It matches what the iso-timestamp rule absorbs, so a
// pinned file hides nothing its record would not hide already.
func PinClock(s string) (string, int) {
	n := len(recordedTimestamp.FindAllStringIndex(s, -1))
	return recordedTimestamp.ReplaceAllLiteralString(s, PinnedInstant), n
}

// pinClock is `pin-clock <file>...`: a scenario runs it on a file the binary
// wrote, before git commits it. A file with no timestamp fails the scenario:
// the pin would be a no-op, and the commit ids would vary again in silence.
func pinClock(ts *testscript.TestScript, neg bool, args []string) {
	if neg || len(args) == 0 {
		ts.Fatalf("usage: pin-clock file...")
	}
	for _, name := range args {
		path := ts.MkAbs(name)
		data, err := os.ReadFile(path)
		ts.Check(err)
		pinned, n := PinClock(string(data))
		if n == 0 {
			ts.Fatalf("pin-clock: %s holds no timestamp to pin", name)
		}
		// The file exists, so WriteFile keeps its mode; the permission is unused.
		ts.Check(os.WriteFile(path, []byte(pinned), 0o644))
	}
}
