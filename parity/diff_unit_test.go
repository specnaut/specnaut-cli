package parity

import (
	"io/fs"
	"reflect"
	"testing"
)

func rec(name string, steps []Step, tree ...Entry) *Record {
	return &Record{Scenario: name, Steps: steps, Tree: tree}
}

func file(path, content string) Entry { return Entry{Path: path, Mode: 0o644, Content: content} }

func TestDiffIdenticalRecordsAgree(t *testing.T) {
	r := rec("s", []Step{{Args: []string{"specnaut"}, Stdout: "x\n"}}, file("a", "1"))
	if d := Diff(map[string]*Record{"s": r}, map[string]*Record{"s": r}); len(d) != 0 {
		t.Errorf("got %v", d)
	}
}

func TestDiffNamesScenarioAndArtefact(t *testing.T) {
	step := Step{Args: []string{"specnaut", "--help"}, Stdout: "a\nb\n", Stderr: "", Exit: 0}
	other := step
	other.Stdout, other.Stderr, other.Exit = "a\nc\n", "warn\n", 2
	exec := &Entry{Path: "x.sh", Mode: 0o755, Content: "#!"}
	a := rec("s", []Step{step}, file("both", "1"), file("only-a", ""), file("x.sh", "#!"))
	b := rec("s", []Step{other}, file("both", "2"), file("only-b", ""), *exec)
	got := artefacts(Diff(map[string]*Record{"s": a}, map[string]*Record{"s": b}))
	want := []string{
		"exit", "stdout", "stderr",
		"tree:both (content)", "tree:only-a (presence)", "tree:only-b (presence)", "tree:x.sh (mode)",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %v\nwant %v", got, want)
	}
}

func TestDiffDetailQuotesTheFirstDifferingLine(t *testing.T) {
	a := rec("s", []Step{{Args: []string{"specnaut"}, Stdout: "same\nleft\n"}})
	b := rec("s", []Step{{Args: []string{"specnaut"}, Stdout: "same\nright\n"}})
	d := Diff(map[string]*Record{"s": a}, map[string]*Record{"s": b})
	want := "s: stdout: step 1 `specnaut`: line 2: A \"left\", B \"right\""
	if len(d) != 1 || d[0].String() != want {
		t.Errorf("got %v, want %q", d, want)
	}
}

func TestDiffStepsAndRecords(t *testing.T) {
	one := rec("s", []Step{{}})
	two := rec("s", []Step{{}, {}})
	got := artefacts(Diff(map[string]*Record{"s": one, "only-a": one}, map[string]*Record{"s": two, "only-b": one}))
	want := []string{"record", "record", "steps"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestDiffSeesTypeChanges(t *testing.T) {
	a := rec("s", nil, Entry{Path: "p", Mode: fs.ModeDir | 0o755})
	b := rec("s", nil, Entry{Path: "p", Mode: fs.ModeSymlink | 0o777, Content: "target"})
	if got := artefacts(Diff(map[string]*Record{"s": a}, map[string]*Record{"s": b})); len(got) != 2 {
		t.Errorf("a directory replaced by a symlink must differ in mode and content, got %v", got)
	}
}

func artefacts(ds []Difference) []string {
	out := []string{}
	for _, d := range ds {
		s := d.Artefact
		if d.Facet != "" {
			s += " (" + d.Facet + ")"
		}
		out = append(out, s)
	}
	return out
}
