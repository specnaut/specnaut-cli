package js

import (
	"math"
	"testing"
)

func TestToNumber(t *testing.T) {
	for _, c := range []struct {
		in   string
		want float64
		ok   bool
	}{
		{"42", 42, true}, {"0042", 42, true}, {"1e3", 1000, true}, {" 7 ", 7, true},
		{"0x10", 16, true}, {"0o17", 15, true}, {"0b101", 5, true}, {"-0x10", 0, false},
		{".5", 0.5, true}, {"5.", 5, true}, {"+5", 5, true}, {"1_000", 0, false},
		{"", 0, true}, {"abc", 0, false}, {"1e400", math.Inf(1), true}, {"Infinity", math.Inf(1), true},
		{"+-Infinity", 0, false}, {"0x", 0, false}, {"1n", 0, false}, {" 5", 5, true},
	} {
		got, ok := ToNumber(c.in)
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("ToNumber(%q) = %v, %v; want %v, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

var tenth = 0.1 // a variable, so 0.1+0.2 is computed in float64, not folded exactly

func TestNumberToString(t *testing.T) {
	for _, c := range []struct {
		in   float64
		want string
	}{
		{42, "42"}, {1000, "1000"}, {0.5, "0.5"}, {1e21, "1e+21"}, {1e20, "100000000000000000000"},
		{1e-6, "0.000001"}, {1e-7, "1e-7"}, {123456789012345678901234, "1.2345678901234569e+23"},
		{-0.0, "0"}, {-3.25, "-3.25"}, {tenth + 2*tenth, "0.30000000000000004"}, {1.5e-10, "1.5e-10"},
		{math.Inf(1), "Infinity"},
	} {
		if got := NumberToString(c.in); got != c.want {
			t.Errorf("NumberToString(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestQuoteMatchesJSONStringify(t *testing.T) {
	for in, want := range map[string]string{
		"b/r&d.md":       `"b/r&d.md"`,
		"<x>":            `"<x>"`,
		"a\"b\\c":        `"a\"b\\c"`,
		"\b\f\n\r\t\x01": `"\b\f\n\r\t\u0001"`,
		"  \x7f":         "\"  \x7f\"",
		"é":              `"é"`,
	} {
		if got := Quote(in); got != want {
			t.Errorf("Quote(%q) = %s, want %s", in, got, want)
		}
	}
}
