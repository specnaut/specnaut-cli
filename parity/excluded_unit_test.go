package parity

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCredentialScenariosNeverRunWhereAKeyringIsReachable(t *testing.T) {
	for name := range credentialScenarios {
		if _, ok := Excluded(name, HostFor("darwin"), Pair{}); !ok {
			t.Errorf("%s runs on darwin, where the login keychain is always reachable", name)
		}
		if why, ok := Excluded(name, HostFor("linux"), Pair{}); ok {
			t.Errorf("%s excluded on linux (%s), where env.go removes the session bus", name, why)
		}
	}
}

func TestUncaughtTraceScenariosAreComparedWithinOneImplementation(t *testing.T) {
	for name := range uncaughtTrace {
		if _, ok := Excluded(name, HostFor("linux"), Pair{}); ok {
			t.Errorf("%s excluded from a same-implementation pair", name)
		}
		if _, ok := Excluded(name, HostFor("linux"), Pair{CrossImpl: true}); !ok {
			t.Errorf("%s compared across implementations", name)
		}
	}
}

func TestOnlyPortedScenariosAreComparedAcrossImplementations(t *testing.T) {
	cross, same := Pair{CrossImpl: true}, Pair{}
	for _, name := range PortedToGo {
		if why, ok := Excluded(name, HostFor("linux"), cross); ok {
			t.Errorf("%s is ported, yet excluded from Go against TypeScript: %s", name, why)
		}
	}
	for _, name := range []string{"init", "upgrade-claude-local", "gate"} {
		if _, ok := Excluded(name, HostFor("linux"), cross); !ok {
			t.Errorf("%s is not ported, yet compared Go against TypeScript", name)
		}
		if why, ok := Excluded(name, HostFor("linux"), same); ok {
			t.Errorf("%s excluded from a same-implementation pair: %s", name, why)
		}
	}
}

func TestTheHarnessExcludesWindowsHostsWithAReason(t *testing.T) {
	if why, ok := HostExcluded(HostFor("windows")); !ok || why == "" {
		t.Errorf("windows: excluded=%v, reason %q", ok, why)
	}
	for _, goos := range []string{"darwin", "linux"} {
		if why, ok := HostExcluded(HostFor(goos)); ok {
			t.Errorf("%s excluded: %s", goos, why)
		}
	}
}

func TestCredentialGuard(t *testing.T) {
	mac, linux := HostFor("darwin"), HostFor("linux")
	cases := []struct {
		scenario string
		args     string
		host     Host
		refused  bool
	}{
		{"init-claude-cloud", "init --here --backlog cloud --spec-backend cloud", mac, false},
		{"stray", "cloud orgs", mac, true},
		{"stray", "--api-url x gate status", mac, true},
		{"stray", "init --title spec", mac, true}, // over-approximation: refuse, never guess
		{"stray", "cloud orgs", linux, false},
		{"parser", "cloud bogus", mac, false},
	}
	for _, c := range cases {
		err := CredentialGuard(c.scenario, strings.Fields(c.args), c.host)
		if (err != nil) != c.refused {
			t.Errorf("%s %q on %s: refused=%v, want %v", c.scenario, c.args, c.host.GOOS, err != nil, c.refused)
		}
	}
}

// TestEveryScenarioIsClassified replays the guard over every scripted step as
// if on macOS, without running a binary. On a Linux CI runner the guard is
// off, so this is what keeps an unclassified credential scenario from being
// found first on a developer's laptop.
func TestEveryScenarioIsClassified(t *testing.T) {
	scenarios, err := Scenarios(t.TempDir(), "testdata")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range scenarios {
		if _, excluded := Excluded(s.Name, HostFor("darwin"), Pair{}); excluded {
			continue
		}
		data, err := os.ReadFile(s.File)
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range scriptLines(string(data)) {
			f := strings.Fields(line)
			if len(f) > 0 && (f[0] == "specnaut" || f[0] == "specflow") {
				if err := CredentialGuard(s.Name, f[1:], HostFor("darwin")); err != nil {
					t.Error(err)
				}
			}
		}
	}
}

func TestEveryClassifiedScenarioExists(t *testing.T) {
	for _, m := range []map[string]string{credentialScenarios, uncaughtTrace, credentialFree} {
		for name, why := range m {
			if why == "" {
				t.Errorf("%s: no reason", name)
			}
			if _, err := os.Stat(filepath.Join("testdata", name+".txtar")); err != nil {
				t.Errorf("%s is classified but has no script: %v", name, err)
			}
		}
	}
	for _, name := range PortedToGo {
		if _, err := os.Stat(filepath.Join("testdata", name+".txtar")); err != nil {
			t.Errorf("%s is declared ported but has no script: %v", name, err)
		}
	}
	for _, e := range Unrunnable {
		if e.Reason == "" {
			t.Errorf("%s: no reason", e.Scenario)
		}
		if _, err := os.Stat(filepath.Join("testdata", e.Scenario+".txtar")); err == nil {
			t.Errorf("%s is declared unrunnable but has a script", e.Scenario)
		}
	}
}

// scriptLines is the script part of a txtar, `!` prefixes dropped.
func scriptLines(data string) []string {
	if i := strings.Index(data, "\n-- "); i >= 0 {
		data = data[:i]
	}
	var out []string
	for _, l := range strings.Split(data, "\n") {
		out = append(out, strings.TrimPrefix(strings.TrimSpace(l), "! "))
	}
	return out
}
