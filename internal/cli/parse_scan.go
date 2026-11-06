package cli

import (
	"regexp"
	"slices"
	"strings"
)

// The values scan_parser.ts accepts for `--format` and `--top`.
var (
	scanFormats = []string{"text", "json", "mermaid"}
	scanTop     = regexp.MustCompile(`^[0-9]{1,9}$`)
	driveLetter = regexp.MustCompile(`^[A-Za-z]:`)
)

// parseScan is scan_parser.ts's parseScan: the same refusals, in its order, none echoing the value.
func parseScan(a Args, rest []string) Intent {
	if len(rest) > 0 {
		return unknown("scan takes no positional argument; name a subtree with --path")
	}
	if v, ok := a.Flag("format"); ok && (v.Kind != String || !slices.Contains(scanFormats, v.S)) {
		return unknown("scan --format takes text, json or mermaid")
	}
	if v, ok := a.Flag("top"); ok && (v.Kind != String || (v.S != "all" && !scanTop.MatchString(v.S))) {
		return unknown("scan --top takes a whole number or all")
	}
	if v, ok := a.Flag("path"); ok && (v.Kind != String || !isScanPath(v.S)) {
		return unknown("scan --path takes a relative path inside the repository, with no .. segment")
	}
	return Intent{Kind: "scan"}
}

// isScanPath is scan_parser.ts's isScanPath: relative on every platform, no `..` segment, not an
// option, no control character (C0, DEL or C1, as hasControl in terminal_text.ts).
func isScanPath(p string) bool {
	if p == "" || strings.HasPrefix(p, "-") || strings.ContainsFunc(p, isControl) {
		return false
	}
	if strings.HasPrefix(p, "/") || strings.HasPrefix(p, `\`) || driveLetter.MatchString(p) {
		return false
	}
	return !slices.Contains(strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' }), "..")
}

func isControl(r rune) bool { return r < 0x20 || (r >= 0x7f && r <= 0x9f) }
