package parity

import "testing"

func TestNormaliseRules(t *testing.T) {
	ctx := Context{Work: "/tmp/go-test-script123/script-x", Version: "7.0.2", TemplatesVersion: "7.0.3"}
	cases := []struct {
		name, in, want string
		differ         bool
	}{
		{"work dir", "Initializing into /tmp/go-test-script123/script-x/project", "Initializing into <WORK>/project", false},
		{"loopback port", "logged out of http://127.0.0.1:54321", "logged out of http://127.0.0.1:<PORT>", false},
		{"timestamp", "installed_at: '2026-10-27T18:43:25.972Z'", "installed_at: '<TIMESTAMP>'", false},
		{"timestamp, no fraction", "at: 2026-01-01T00:00:00Z", "at: <TIMESTAMP>", false},
		{"version kept when the versions agree", "specnaut 7.0.2 (templates 7.0.3)", "specnaut 7.0.2 (templates 7.0.3)", false},
		{"version rewritten when they differ", "specnaut 7.0.2 (templates 7.0.3)", "specnaut <VERSION> (templates <TEMPLATES_VERSION>)", true},
		{"adjacent versions", "7.0.2 7.0.2", "<VERSION> <VERSION>", true},
		{"a longer number is not the version", "17.0.2 and 7.0.21 and v7.0.2.1", "17.0.2 and 7.0.21 and v7.0.2.1", true},
		{"a tag is", "release v7.0.2.", "release v<VERSION>.", true},
		{"anything else is left alone", "random 1234 text", "random 1234 text", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx := ctx
			ctx.VersionsDiffer = c.differ
			if got := Normalise(c.in, ctx); got != c.want {
				t.Errorf("Normalise(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestRuleWithAnEmptyPlaceholderDoesNotApply(t *testing.T) {
	// A binary whose --version could not be parsed has no Version: the rule
	// must not degrade into a pattern that matches every boundary.
	got := Normalise("a b", Context{VersionsDiffer: true})
	if got != "a b" {
		t.Errorf("got %q", got)
	}
}

func TestEveryRuleSaysWhy(t *testing.T) {
	seen := map[string]bool{}
	for _, r := range Rules {
		if r.Name == "" || r.Why == "" || r.Pattern == "" {
			t.Errorf("rule %+v: name, pattern and why are all required", r)
		}
		if seen[r.Name] {
			t.Errorf("rule %q declared twice", r.Name)
		}
		seen[r.Name] = true
	}
}
