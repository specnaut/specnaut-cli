package cli

import (
	"fmt"
	"io"
)

// ExitNotPorted is the exit code of a recognised command the Go binary does
// not implement yet. Distinct from 2 (a malformed command line, which the Go
// binary refuses exactly as TypeScript does) and from 1 (a command's own
// failure), so a script can tell "wrong binary" from "wrong call".
const ExitNotPorted = 3

// NotPorted is the one answer every unported command gives. It is reached
// only after Parse accepted the command line, so a malformed call still gets
// TypeScript's refusal, never this.
func NotPorted(w io.Writer, p Palette, command string) int {
	fmt.Fprintln(w, p.Red(fmt.Sprintf(
		"error: `specnaut %s` is not ported to this Go build yet; use the released binary for it", command)))
	return ExitNotPorted
}
