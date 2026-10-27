package cli

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
)

// golden is internal/testdata/golden.ts's output: parser.ts's own answer for
// each command line. The Go parser is judged against the implementation, not
// against a reading of minimist.
type golden struct {
	Args   []string `json:"args"`
	Intent struct {
		Kind     string `json:"kind"`
		Received string `json:"received"`
		Harness  string `json:"harness"`
		Crash    string `json:"crash"`
	} `json:"intent"`
}

func loadGolden(t *testing.T) []golden {
	t.Helper()
	data, err := os.ReadFile("testdata/parse_golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []golden
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 100 {
		t.Fatalf("only %d golden cases: is the file truncated?", len(cases))
	}
	return cases
}

func TestParseMatchesParserTS(t *testing.T) {
	for _, c := range loadGolden(t) {
		got, err := Parse(c.Args)
		want := c.Intent
		if want.Crash != "" {
			var shape *ShapeError
			if !errors.As(err, &shape) {
				t.Errorf("Parse(%q) = %+v, %v; TypeScript throws a %s", c.Args, got, err, want.Crash)
			}
			continue
		}
		if err != nil {
			t.Errorf("Parse(%q): %v; TypeScript answers %+v", c.Args, err, want)
			continue
		}
		if got.Kind != want.Kind || got.Received != want.Received || got.Harness != want.Harness {
			t.Errorf("Parse(%q) = {%s %q %q}, parser.ts = {%s %q %q}",
				c.Args, got.Kind, got.Received, got.Harness, want.Kind, want.Received, want.Harness)
		}
	}
}

// The shapes JavaScript would answer through its object model rather than
// through parseArgs: refused, never guessed.
func TestParseRefusesObjectModelShapes(t *testing.T) {
	for _, args := range [][]string{
		{"--_", "x"},
		{"--_.0", "x"},
		{"--a.__proto__.ai", "x", "init"},
	} {
		var shape *ShapeError
		if _, err := Parse(args); !errors.As(err, &shape) {
			t.Errorf("Parse(%q): err = %v, want a ShapeError", args, err)
		}
	}
	if in, err := Parse([]string{"--__proto__", "x", "bogus"}); err != nil || in.Received != "bogus" {
		t.Errorf("a primitive __proto__ is a no-op in JavaScript; got %+v, %v", in, err)
	}
}

func TestParseNamesTheCommand(t *testing.T) {
	in, err := Parse([]string{"login", "--api-url", "http://127.0.0.1:9"})
	if err != nil || in.Kind != "cloud" || in.Command != "login" {
		t.Errorf("login = %+v, %v; want kind cloud, command login", in, err)
	}
}
