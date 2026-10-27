package parity

import (
	"regexp"
	"strings"
)

// Context is what the rules may depend on: where one scenario ran, and the
// identity of the binary that ran it.
type Context struct {
	Work             string // the scenario's $WORK
	Version          string // the binary's version
	TemplatesVersion string // the templates version it ships
	VersionsDiffer   bool   // the two binaries' `--version` outputs differ
}

// Rule is one declared normalisation: what it rewrites, into what, and why.
//
// Pattern is an RE2 expression. The placeholders {{WORK}}, {{VERSION}} and
// {{TEMPLATES_VERSION}} expand to the quoted context values; a rule whose
// placeholder value is empty does not apply. Replacement may use $1-style
// group references.
type Rule struct {
	Name        string
	Pattern     string
	Replacement string
	Why         string
	When        func(Context) bool // nil: always
}

// versionEdge keeps a version rule from matching inside a longer number:
// 7.0.2 must not rewrite 17.0.2, 7.0.21 or 7.0.2.1, but does rewrite the tag
// v7.0.2 and a version ending a sentence.
const versionEdge = `(^|[^0-9.])`
const versionTail = `(\.?(?:[^0-9.]|$))`

// Rules is the whole normalisation table. Nothing else in the harness rewrites
// a record: a value that varies between two runs of one binary and is not
// absorbed here is a difference, by design.
var Rules = []Rule{
	{
		Name:        "work-dir",
		Pattern:     `{{WORK}}`,
		Replacement: `<WORK>`,
		Why:         "each scenario runs in a fresh temporary directory, so absolute paths printed or written by the CLI differ on every run",
	},
	{
		Name:        "loopback-port",
		Pattern:     `127\.0\.0\.1:[0-9]+`,
		Replacement: `127.0.0.1:<PORT>`,
		Why:         "every stub listens on a port the kernel picks per scenario; the CLI echoes stub URLs (e.g. `logged out of http://127.0.0.1:…`)",
	},
	{
		Name:        "iso-timestamp",
		Pattern:     `[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z`,
		Replacement: `<TIMESTAMP>`,
		Why:         "installed.lock records installed_at per entry and the upgrade marker records `at`, both from the wall clock",
	},
	{
		Name:        "binary-version",
		Pattern:     versionEdge + `{{VERSION}}` + versionTail,
		Replacement: `${1}<VERSION>${2}`,
		Why:         "two releases print and record their own version; only when the two `--version` outputs differ, or the version rule would hide a pin",
		When:        func(c Context) bool { return c.VersionsDiffer },
	},
	{
		Name:        "templates-version",
		Pattern:     versionEdge + `{{TEMPLATES_VERSION}}` + versionTail,
		Replacement: `${1}<TEMPLATES_VERSION>${2}`,
		Why:         "installed.lock stamps every entry with the templates version; same condition as binary-version",
		When:        func(c Context) bool { return c.VersionsDiffer },
	},
}

// Normaliser is Rules compiled for one Context.
type Normaliser struct {
	rules []compiled
}

type compiled struct {
	re          *regexp.Regexp
	replacement string
}

// Compile prepares the rules that apply to c.
func Compile(c Context) Normaliser {
	var n Normaliser
	for _, r := range Rules {
		if re := r.compile(c); re != nil {
			n.rules = append(n.rules, compiled{re, r.Replacement})
		}
	}
	return n
}

// Apply rewrites s with every applicable rule, in table order.
func (n Normaliser) Apply(s string) string {
	for _, r := range n.rules {
		// Applied twice: adjacent matches share the boundary character the
		// version rules consume, so one pass leaves every second one. The
		// other rules' replacements never match their own pattern, so the
		// second pass is a no-op for them.
		s = r.re.ReplaceAllString(s, r.replacement)
		s = r.re.ReplaceAllString(s, r.replacement)
	}
	return s
}

// Normalise is Compile(c).Apply(s), for one-off use.
func Normalise(s string, c Context) string { return Compile(c).Apply(s) }

// compile expands the rule's placeholders for c, or returns nil when the rule
// does not apply to c.
func (r Rule) compile(c Context) *regexp.Regexp {
	if r.When != nil && !r.When(c) {
		return nil
	}
	values := map[string]string{
		"{{WORK}}":              c.Work,
		"{{VERSION}}":           c.Version,
		"{{TEMPLATES_VERSION}}": c.TemplatesVersion,
	}
	pattern := r.Pattern
	for placeholder, value := range values {
		if !strings.Contains(pattern, placeholder) {
			continue
		}
		if value == "" {
			return nil
		}
		pattern = strings.ReplaceAll(pattern, placeholder, regexp.QuoteMeta(value))
	}
	return regexp.MustCompile(pattern)
}
