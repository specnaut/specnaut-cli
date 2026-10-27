package cli

import "strings"

// Palette is `@std/fmt/colors` as the TypeScript binary runs it: codes are
// written whether or not the stream is a terminal, and dropped only when
// Deno's `noColor` is set — NO_COLOR non-empty, unless FORCE_COLOR is set at
// all (measured against the released binary, empty values included).
type Palette struct{ Enabled bool }

// PaletteFor reads the two variables Deno reads.
func PaletteFor(lookup func(string) (string, bool)) Palette {
	if _, force := lookup("FORCE_COLOR"); force {
		return Palette{Enabled: true}
	}
	noColor, _ := lookup("NO_COLOR")
	return Palette{Enabled: noColor == ""}
}

// run wraps s, re-opening the colour wherever s closes it, as colors.ts does.
func (p Palette) run(s string, open, close string) string {
	if !p.Enabled {
		return s
	}
	return open + strings.ReplaceAll(s, close, open) + close
}

func (p Palette) Bold(s string) string   { return p.run(s, "\x1b[1m", "\x1b[22m") }
func (p Palette) Dim(s string) string    { return p.run(s, "\x1b[2m", "\x1b[22m") }
func (p Palette) Red(s string) string    { return p.run(s, "\x1b[31m", "\x1b[39m") }
func (p Palette) Yellow(s string) string { return p.run(s, "\x1b[33m", "\x1b[39m") }
func (p Palette) Cyan(s string) string   { return p.run(s, "\x1b[36m", "\x1b[39m") }
