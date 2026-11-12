package lockfile

import (
	"fmt"
	"strings"
	"unicode"
)

// TerminalText is terminalText (src/domain/terminal_text.ts): one line of
// untrusted text made safe to print. A backslash is doubled, then every code
// point a terminal acts on rather than shows is written as `\uXXXX`, or
// `\u{X}` above the BMP. Here because SafeDestination is its first caller;
// the refusals of package reconcile use it too (cli#776).
//
// The unsafe set is TypeScript's, by Unicode property: Cc, Cf, Co, Cs, Zl, Zp,
// unassigned, and Default_Ignorable_Code_Point, which beyond Cf is
// Other_Default_Ignorable_Code_Point plus the variation selectors. Go's tables
// and V8's may name a different Unicode version, so a code point assigned in
// only one of them can differ; terminal_text_golden.jsonl pins the rest.
func TerminalText(s string) string {
	var b strings.Builder
	for _, r := range strings.ReplaceAll(s, `\`, `\\`) {
		switch {
		case !unsafeRune(r):
			b.WriteRune(r)
		case r > 0xffff:
			fmt.Fprintf(&b, `\u{%x}`, r)
		default:
			fmt.Fprintf(&b, `\u%04x`, r)
		}
	}
	return b.String()
}

func unsafeRune(r rune) bool {
	// unicode.C is Cc, Cf, Cn, Co and Cs: every "other" code point, unassigned included.
	return unicode.In(r, unicode.C, unicode.Zl, unicode.Zp,
		unicode.Other_Default_Ignorable_Code_Point, unicode.Variation_Selector)
}

// hasControl is terminal_text.ts's: a C0, DEL or C1 control character.
func hasControl(s string) bool {
	return strings.ContainsFunc(s, func(r rune) bool { return r < 0x20 || (r >= 0x7f && r <= 0x9f) })
}
