package parity

import (
	"runtime"
	"slices"
	"testing"

	"github.com/rogpeppe/go-internal/testscript"

	"github.com/specnaut/specnaut-cli/parity/stubs"
)

// TestMain installs the command shims and the mutant on PATH (testscript.Main
// re-enters this test binary under their names), then runs the tests.
func TestMain(m *testing.M) {
	testscript.Main(withCleanup{m}, map[string]func(){
		"gh":       stubs.GhMain,
		"glab":     stubs.GlabMain,
		MutantName: MutantMain,
	})
}

type withCleanup struct{ m *testing.M }

func (w withCleanup) Run() int {
	defer RunCleanups()
	return w.m.Run()
}

// TestParity runs every scenario against SPECNAUT_BIN. With SPECNAUT_BIN_B set
// it runs them against that binary too and fails on every difference.
func TestParity(t *testing.T) {
	a, b := Binaries(t)
	requireUnix(t)
	scenarios := loadScenarios(t)
	if b == nil {
		runBinary(t, a, scenarios, Pair{}, false)
		return
	}
	diffs := runPair(t, a, b, scenarios)
	for _, d := range diffs {
		t.Error(d)
	}
	t.Logf("%d scenarios, %d difference(s)", len(scenarios), len(diffs))
}

// TestMatrixMatchesHelp holds the declared harness and backend lists to the
// ones the binary advertises.
func TestMatrixMatchesHelp(t *testing.T) {
	a, _ := Binaries(t)
	requireUnix(t)
	help, err := a.Help()
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		what     string
		declared []string
		read     func(string) ([]string, error)
	}{{"harnesses", Harnesses, HelpHarnesses}, {"backends", Backends, HelpBackends}} {
		got, err := c.read(help)
		if err != nil {
			t.Fatal(err)
		}
		if !sameSet(got, c.declared) {
			t.Errorf("%s: --help lists %v, matrix.go declares %v", c.what, got, c.declared)
		}
	}
}

func sameSet(a, b []string) bool {
	x, y := slices.Clone(a), slices.Clone(b)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(x, y)
}

// requireUnix: the harness covers macOS and Linux hosts; Windows gets the
// build and the keychain probe, not the harness.
func requireUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the parity harness runs on macOS and Linux hosts only")
	}
}

func loadScenarios(t *testing.T) []Scenario {
	t.Helper()
	s, err := Scenarios(t.TempDir(), "testdata")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// runPair records both binaries and diffs the records.
func runPair(t *testing.T, a, b *Binary, scenarios []Scenario) []Difference {
	t.Helper()
	pair := Pair{CrossImpl: a.Impl != b.Impl}
	differ := a.VersionLine != b.VersionLine
	ra := runBinary(t, a, scenarios, pair, differ)
	rb := runBinary(t, b, scenarios, pair, differ)
	return Diff(ra, rb)
}

// runBinary runs every scenario that is not excluded against bin, then checks
// that each one ran the binary, captured its tree, and reached exactly the
// stubs it declared.
func runBinary(t *testing.T, bin *Binary, scenarios []Scenario, pair Pair, versionsDiffer bool) map[string]*Record {
	t.Helper()
	rec := NewRecorder(bin, versionsDiffer)
	var run []Scenario
	t.Run(bin.Label, func(t *testing.T) {
		run = reportExclusions(t, scenarios, pair)
		cmds := rec.Commands()
		for name, c := range Commands() {
			cmds[name] = c
		}
		testscript.Run(t, testscript.Params{
			Files:               files(run),
			Setup:               rec.Track(Setup(bin)),
			Cmds:                cmds,
			RequireExplicitExec: true,
		})
	})
	records := rec.Records()
	for _, s := range run {
		if rec.Started(s.Name) { // not started: filtered out by -run
			checkRecord(t, bin, s, records[s.Name])
		}
	}
	return records
}

func checkRecord(t *testing.T, bin *Binary, s Scenario, r *Record) {
	t.Helper()
	switch {
	case r == nil:
		t.Errorf("%s/%s: the scenario never ran the binary", bin.Label, s.Name)
	case r.Err != nil:
		t.Errorf("%s/%s: capturing the tree: %v", bin.Label, s.Name, r.Err)
	default:
		for _, p := range stubs.CheckHits(s.Uses, r.Hits) {
			t.Errorf("%s/%s: %s (stub log: %v)", bin.Label, s.Name, p, r.HitLog)
		}
	}
}

// reportExclusions turns every exclusion into a visible SKIP and returns the
// scenarios left to run.
func reportExclusions(t *testing.T, scenarios []Scenario, pair Pair) []Scenario {
	host := CurrentHost()
	for _, e := range Unrunnable {
		t.Run(e.Scenario, func(t *testing.T) { t.Skip("excluded: " + e.Reason) })
	}
	var run []Scenario
	for _, s := range scenarios {
		if why, ok := Excluded(s.Name, host, pair); ok {
			t.Run(s.Name, func(t *testing.T) { t.Skip("excluded: " + why) })
			continue
		}
		run = append(run, s)
	}
	return run
}

func files(s []Scenario) []string {
	out := make([]string, len(s))
	for i, x := range s {
		out[i] = x.File
	}
	return out
}
