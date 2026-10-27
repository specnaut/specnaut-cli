package parity

import (
	"testing"
)

// mutationCase is one FR-008 probe: a mutant of the binary under test, the
// scenario it runs, and the difference the harness must report for it.
type mutationCase struct {
	kind     MutationKind
	path     string // file the file mutations act on, relative to the step
	scenario string
	artefact string
	facet    string
}

var mutationCases = []mutationCase{
	{MutateStdoutLine, "", "help", "stdout", ""},
	{MutateExitCode, "", "version", "exit", ""},
	{MutateMissingFile, ".specnaut/installed.lock", "init-claude-local", "tree:project/.specnaut/installed.lock", "presence"},
	{MutateAlteredFile, ".claude/CLAUDE.md", "init-claude-local", "tree:project/.claude/CLAUDE.md", "content"},
}

// TestMutationsAreCaught diffs the binary against a mutant of itself, once per
// mutation kind, and requires red naming the scenario and the artefact. A
// harness that has never failed proves nothing; this is where it fails on
// purpose, on every run.
func TestMutationsAreCaught(t *testing.T) {
	a, _ := Binaries(t)
	requireUnix(t)
	all := loadScenarios(t)
	for _, c := range mutationCases {
		t.Run(string(c.kind), func(t *testing.T) {
			mutant, err := NewMutant(a, c.kind, c.path)
			if err != nil {
				t.Fatal(err)
			}
			diffs := runPair(t, a, mutant, pick(t, all, c.scenario))
			if !caught(diffs, c) {
				t.Errorf("the %s mutant went unnoticed: want %s / %s (%s), got %v",
					c.kind, c.scenario, c.artefact, c.facet, diffs)
			}
			for _, d := range diffs {
				if d.Scenario != c.scenario {
					t.Errorf("a difference outside the mutated scenario: %v", d)
				}
			}
		})
	}
}

func caught(diffs []Difference, c mutationCase) bool {
	for _, d := range diffs {
		if d.Scenario == c.scenario && d.Artefact == c.artefact && d.Facet == c.facet {
			return true
		}
	}
	return false
}

func pick(t *testing.T, all []Scenario, name string) []Scenario {
	t.Helper()
	for _, s := range all {
		if s.Name == name {
			return []Scenario{s}
		}
	}
	t.Fatalf("no scenario %q", name)
	return nil
}
