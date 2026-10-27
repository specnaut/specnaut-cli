package cli

import "testing"

func mustTokenise(t *testing.T, args ...string) Args {
	t.Helper()
	a, err := Tokenise(args, Surface)
	if err != nil {
		t.Fatalf("Tokenise(%q): %v", args, err)
	}
	return a
}

func TestTokeniseTypesValuesAsJavaScript(t *testing.T) {
	a := mustTokenise(t, "-h0", "--a.b", "7", "--ai", "007", "--x=12", "--", "0042")
	if v, _ := a.Flag("help"); v.Kind != Number || v.Truthy() {
		t.Errorf("-h0: help = %+v, want the falsy number 0", v)
	}
	if v, _ := a.Flag("a"); v.Kind != Object || v.Obj["b"].Kind != Number || v.Obj["b"].N != 7 {
		t.Errorf("--a.b 7: a = %+v, want {b: 7}", v)
	}
	if s, ok := a.StringFlag("ai"); !ok || s != "007" {
		t.Errorf("--ai 007 = %q, %v: a string flag is never coerced", s, ok)
	}
	if v, _ := a.Flag("x"); v.Kind != Number || v.N != 12 {
		t.Errorf("--x=12: x = %+v, want the number 12", v)
	}
	if w := a.Words(); len(w) != 1 || w[0] != "0042" {
		t.Errorf("after --: %q, want the word untouched", w)
	}
}

func TestTokeniseDefaultsEveryBooleanToFalse(t *testing.T) {
	a := mustTokenise(t)
	for _, k := range append([]string{"v", "h"}, Surface.Booleans...) {
		if v, ok := a.Flag(k); !ok || v.Kind != Bool || v.B {
			t.Errorf("%s = %+v, %v; want false", k, v, ok)
		}
	}
}

func TestTokeniseCombinedShortsAndUnknownSwallow(t *testing.T) {
	a := mustTokenise(t, "-vh", "--bogus", "init", "1e3")
	for _, k := range []string{"v", "version", "h", "help"} {
		if !truthy(a, k) {
			t.Errorf("-vh: %s not set", k)
		}
	}
	if s, _ := a.Flag("bogus"); s.Kind != String || s.S != "init" {
		t.Errorf("--bogus init: bogus = %+v, want the word init", s)
	}
	if w := a.Words(); len(w) != 1 || w[0] != "1000" {
		t.Errorf("1e3 reads back as %q, want 1000", w)
	}
}

func TestTokeniseRefusesAWriteThroughAPrimitive(t *testing.T) {
	if _, err := Tokenise([]string{"--a", "1", "--a.b", "2"}, Surface); err == nil {
		t.Error("JavaScript throws a TypeError here; the tokeniser accepted it")
	}
}
