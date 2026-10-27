package parity

import (
	"slices"
	"strings"
	"testing"
)

const helpSample = `Flags (for init):
  --ai <name>         Target AI harness: claude (default) | cursor | codex
  --backlog <name>    Backlog backend: cloud (default) | local | github
Flags (for upgrade):
  --backlog <name>    Switch the backlog backend (local | github | gitlab).`

func TestHelpLists(t *testing.T) {
	h, err := HelpHarnesses(helpSample)
	if err != nil || !slices.Equal(h, []string{"claude", "cursor", "codex"}) {
		t.Errorf("harnesses %v, %v", h, err)
	}
	b, err := HelpBackends(helpSample)
	if err != nil || !slices.Equal(b, []string{"cloud", "local", "github"}) {
		t.Errorf("backends %v, %v", b, err)
	}
	if _, err := HelpHarnesses("no such line"); err == nil {
		t.Error("a help text without an --ai line must be an error, not an empty list")
	}
}

func TestParseUsesReadsOnlyTheScript(t *testing.T) {
	got := parseUses("# uses: gh cloud\n# uses: gh\nspecnaut check\n-- f.md --\n# uses: deny\n")
	if !slices.Equal(got, []string{"cloud", "gh"}) {
		t.Errorf("got %v", got)
	}
}

func TestMatrixCoversEveryCell(t *testing.T) {
	dir := t.TempDir()
	scenarios, err := Scenarios(dir, "testdata")
	if err != nil {
		t.Fatal(err)
	}
	generated := map[string]bool{}
	for _, s := range scenarios {
		if strings.HasPrefix(s.File, dir) {
			generated[s.Name] = true
		}
		if strings.HasPrefix(s.Name, "check-") && !slices.Contains(s.Uses, "gh") {
			t.Errorf("%s runs check, which probes gh, without declaring it", s.Name)
		}
	}
	for _, c := range matrixCommands {
		for _, h := range Harnesses {
			for _, b := range Backends {
				if name, _ := MatrixScript(c, h, b); !generated[name] {
					t.Errorf("matrix cell %s has no scenario", name)
				}
			}
		}
	}
}
