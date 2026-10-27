package js

import (
	"fmt"
	"strings"
)

// Quote is `JSON.stringify` of a string. Not `encoding/json`: that escapes
// `<`, `>` and `&` unless told otherwise, and U+2028/U+2029 always, while
// JavaScript escapes only `"`, `\` and the C0 controls — a lock key holding
// `&` must print as `&`.
func Quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}
