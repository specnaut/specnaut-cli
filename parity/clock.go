package parity

import (
	"fmt"
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
// wrote, before git commits it.
func pinClock(ts *testscript.TestScript, neg bool, args []string) {
	if neg || len(args) == 0 {
		ts.Fatalf("usage: pin-clock file...")
	}
	for _, name := range args {
		if err := pinFile(ts.MkAbs(name), name); err != nil {
			ts.Fatalf("%v", err)
		}
	}
}

// pinFile pins the timestamps of the file at path, which a scenario calls
// name. A file with no timestamp is an error and stays as it was: the pin
// would be a no-op, and the commit ids would vary again in silence. A plain
// function, so a unit test reads the refusal that ts.Fatalf would end a
// script on.
func pinFile(path, name string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	pinned, n := PinClock(string(data))
	if n == 0 {
		return fmt.Errorf("pin-clock: %s holds no timestamp to pin", name)
	}
	// The file exists, so WriteFile keeps its mode; the permission is unused.
	return os.WriteFile(path, []byte(pinned), 0o644)
}
