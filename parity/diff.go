package parity

import (
	"fmt"
	"sort"
	"strings"
)

// Difference is one way two records of a scenario disagree.
//
// Artefact is `stdout`, `stderr` or `exit` (Detail names the step), `steps`
// when the scenarios ran the binary a different number of times, `record`
// when only one binary produced a record, or `tree:<path>` for a node of the
// resulting tree, with Facet `presence`, `mode` or `content`.
type Difference struct {
	Scenario string
	Artefact string
	Facet    string
	Detail   string
}

func (d Difference) String() string {
	if d.Facet != "" {
		return fmt.Sprintf("%s: %s (%s): %s", d.Scenario, d.Artefact, d.Facet, d.Detail)
	}
	return fmt.Sprintf("%s: %s: %s", d.Scenario, d.Artefact, d.Detail)
}

// Diff compares two runs scenario by scenario. Any difference is reported;
// nothing is tolerated here — whatever two runs may legitimately differ by is
// a rule in normalise.go, applied before a record exists.
func Diff(a, b map[string]*Record) []Difference {
	var out []Difference
	for _, name := range unionKeys(a, b) {
		ra, rb := a[name], b[name]
		switch {
		case ra == nil:
			out = append(out, Difference{name, "record", "", "only B produced a record"})
		case rb == nil:
			out = append(out, Difference{name, "record", "", "only A produced a record"})
		default:
			out = append(out, diffRecord(ra, rb)...)
		}
	}
	return out
}

func diffRecord(a, b *Record) []Difference {
	name := a.Scenario
	var out []Difference
	if len(a.Steps) != len(b.Steps) {
		out = append(out, Difference{name, "steps", "", fmt.Sprintf("A ran the binary %d time(s), B %d", len(a.Steps), len(b.Steps))})
	}
	for i := 0; i < min(len(a.Steps), len(b.Steps)); i++ {
		out = append(out, diffStep(name, i+1, a.Steps[i], b.Steps[i])...)
	}
	return append(out, diffTree(name, a.Tree, b.Tree)...)
}

func diffStep(name string, n int, a, b Step) []Difference {
	where := fmt.Sprintf("step %d `%s`", n, strings.Join(a.Args, " "))
	var out []Difference
	if a.Exit != b.Exit {
		out = append(out, Difference{name, "exit", "", fmt.Sprintf("%s: A exited %d, B %d", where, a.Exit, b.Exit)})
	}
	if a.Stdout != b.Stdout {
		out = append(out, Difference{name, "stdout", "", where + ": " + firstLineDiff(a.Stdout, b.Stdout)})
	}
	if a.Stderr != b.Stderr {
		out = append(out, Difference{name, "stderr", "", where + ": " + firstLineDiff(a.Stderr, b.Stderr)})
	}
	return out
}

func diffTree(name string, a, b []Entry) []Difference {
	ia, ib := indexTree(a), indexTree(b)
	var out []Difference
	for _, p := range unionKeys(ia, ib) {
		ea, inA := ia[p]
		eb, inB := ib[p]
		art := "tree:" + p
		switch {
		case !inA:
			out = append(out, Difference{name, art, "presence", "only in B"})
		case !inB:
			out = append(out, Difference{name, art, "presence", "only in A"})
		default:
			if ea.Mode != eb.Mode {
				out = append(out, Difference{name, art, "mode", fmt.Sprintf("A %v, B %v", ea.Mode, eb.Mode)})
			}
			if ea.Content != eb.Content {
				out = append(out, Difference{name, art, "content", firstLineDiff(ea.Content, eb.Content)})
			}
		}
	}
	return out
}

func indexTree(t []Entry) map[string]Entry {
	m := make(map[string]Entry, len(t))
	for _, e := range t {
		m[e.Path] = e
	}
	return m
}

// firstLineDiff names the first line where two texts part, quoting both sides.
func firstLineDiff(a, b string) string {
	la, lb := strings.Split(a, "\n"), strings.Split(b, "\n")
	for i := 0; i < max(len(la), len(lb)); i++ {
		var x, y string
		if i < len(la) {
			x = la[i]
		}
		if i < len(lb) {
			y = lb[i]
		}
		if x != y || i >= len(la) || i >= len(lb) {
			return fmt.Sprintf("line %d: A %s, B %s", i+1, clip(x, i < len(la)), clip(y, i < len(lb)))
		}
	}
	return "same lines, different bytes"
}

func clip(s string, present bool) string {
	if !present {
		return "<no line>"
	}
	if len(s) > 160 {
		s = s[:160] + "…"
	}
	return fmt.Sprintf("%q", s)
}

func unionKeys[V any](a, b map[string]V) []string {
	seen := map[string]bool{}
	for k := range a {
		seen[k] = true
	}
	for k := range b {
		seen[k] = true
	}
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
