package cli

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// helpTS is the HELP literal of src/cli/help.ts with each colour call written
// as help.go writes it, so the copy cannot drift from its source unseen.
func helpTS(t *testing.T) string {
	t.Helper()
	src, err := os.ReadFile("../../src/cli/help.ts")
	if err != nil {
		t.Fatal(err)
	}
	s := string(src)
	start := strings.Index(s, "export const HELP = `")
	if start < 0 {
		t.Fatal("help.ts has no HELP literal")
	}
	s = s[start+len("export const HELP = `"):]
	s = s[:strings.Index(s, "`;")]
	call := regexp.MustCompile(`\$\{\s*(bold|cyan|dim)\("([^"]*)"\)\s*\}`)
	return call.ReplaceAllString(s, "{$1:$2}")
}

func TestHelpIsHelpTS(t *testing.T) {
	if got := helpTS(t); got != helpTemplate {
		t.Errorf("help.go has drifted from src/cli/help.ts; regenerate it\n--- help.ts\n%s\n--- help.go\n%s", got, helpTemplate)
	}
}

func TestHelpColours(t *testing.T) {
	on := Help(Palette{Enabled: true})
	if !strings.HasPrefix(on, "\x1b[1mspecnaut\x1b[22m — AI project") {
		t.Errorf("coloured help starts %q", on[:40])
	}
	if !strings.Contains(on, "\x1b[2m— run headless, answer your agent from your phone\x1b[22m") {
		t.Error("coloured help lost its dim tagline")
	}
	off := Help(Palette{})
	if strings.Contains(off, "\x1b[") || !strings.HasPrefix(off, "specnaut — AI") {
		t.Errorf("plain help holds escape codes or lost its head: %q", off[:40])
	}
}

func TestPaletteFollowsDeno(t *testing.T) {
	for _, c := range []struct {
		env  map[string]string
		want bool
	}{
		{map[string]string{}, true},
		{map[string]string{"NO_COLOR": ""}, true},
		{map[string]string{"NO_COLOR": "1"}, false},
		{map[string]string{"NO_COLOR": "0"}, false},
		{map[string]string{"NO_COLOR": "1", "FORCE_COLOR": ""}, true},
		{map[string]string{"NO_COLOR": "1", "FORCE_COLOR": "0"}, true},
	} {
		lookup := func(k string) (string, bool) { v, ok := c.env[k]; return v, ok }
		if got := PaletteFor(lookup).Enabled; got != c.want {
			t.Errorf("env %v: colour %v, want %v", c.env, got, c.want)
		}
	}
}

func TestRedReopensInsideItself(t *testing.T) {
	got := Palette{Enabled: true}.Red("a\x1b[39mb")
	if want := "\x1b[31ma\x1b[31mb\x1b[39m"; got != want {
		t.Errorf("Red = %q, want %q", got, want)
	}
}
