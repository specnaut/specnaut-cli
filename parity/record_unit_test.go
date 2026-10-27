package parity

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/rogpeppe/go-internal/testscript"
)

func TestCaptureTreeRecordsPathModeAndContent(t *testing.T) {
	work := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(work, "project", ".specnaut"), 0o755))
	must(t, os.MkdirAll(filepath.Join(work, "home"), 0o700))
	must(t, os.MkdirAll(filepath.Join(work, ".tmp", "deno-compile-x"), 0o755))
	write(t, work, "project/.specnaut/installed.lock", "installed_at: '2026-10-27T18:43:25.972Z'\n", 0o644)
	write(t, work, "project/run.sh", "cd "+work+"/project\n", 0o755)
	write(t, work, ".tmp/deno-compile-x/junk", "random", 0o644)
	must(t, os.Symlink("run.sh", filepath.Join(work, "project", "link")))

	tree, err := captureTree(work, Compile(Context{Work: work}))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Entry{}
	for _, e := range tree {
		got[e.Path] = e
	}
	if _, ok := got[".tmp"]; ok {
		t.Error("testscript's TMPDIR must not be recorded")
	}
	if e := got["home"]; !e.Mode.IsDir() || e.Mode.Perm() != 0o700 {
		t.Errorf("home: mode %v, want a 0700 directory", e.Mode)
	}
	if e := got["project/run.sh"]; e.Mode.Perm() != 0o755 || e.Content != "cd <WORK>/project\n" {
		t.Errorf("run.sh: %v %q — want 0755, normalised once", e.Mode, e.Content)
	}
	if e := got["project/.specnaut/installed.lock"]; e.Content != "installed_at: '<TIMESTAMP>'\n" {
		t.Errorf("lock: %q", e.Content)
	}
	if e := got["project/link"]; e.Mode&fs.ModeSymlink == 0 || e.Content != "run.sh" {
		t.Errorf("link: %v %q — want a symlink recording its target", e.Mode, e.Content)
	}
	for i := 1; i < len(tree); i++ {
		if tree[i-1].Path >= tree[i].Path {
			t.Fatalf("tree not sorted at %q", tree[i].Path)
		}
	}
}

func write(t *testing.T, root, rel, content string, mode os.FileMode) {
	t.Helper()
	p := filepath.Join(root, rel)
	must(t, os.WriteFile(p, []byte(content), mode))
	must(t, os.Chmod(p, mode)) // independent of the umask
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// A scenario whose script never runs the binary asserts nothing; the driver
// must name it, not pass it.
func TestAScenarioThatNeverRanTheBinaryIsReported(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "idle.txtar", "env X=1\n", 0o644)
	bin := &Binary{Label: "A"}
	rec := NewRecorder(bin, false)
	t.Run("run", func(t *testing.T) { // its parallel scripts end with this subtest
		testscript.Run(t, testscript.Params{
			Files: []string{filepath.Join(dir, "idle.txtar")},
			Setup: rec.Track(func(*testscript.Env) error { return nil }),
		})
	})
	if !rec.Started("idle") {
		t.Fatal("Track did not see the scenario start")
	}
	got := RecordProblems(bin, Scenario{Name: "idle"}, rec.Records()["idle"])
	if want := "A/idle: the scenario never ran the binary"; len(got) != 1 || got[0] != want {
		t.Errorf("problems = %q, want [%q]", got, want)
	}
	if rec.Started("other") {
		t.Error("a scenario that never started reads as started")
	}
}

func TestRecordProblemsChecksTheDeclaredStubs(t *testing.T) {
	bin := &Binary{Label: "A"}
	if got := RecordProblems(bin, Scenario{Name: "s"}, &Record{Hits: map[string]int{}}); len(got) != 0 {
		t.Errorf("a clean record has problems: %q", got)
	}
	if got := RecordProblems(bin, Scenario{Name: "s", Uses: []string{"cloud"}}, &Record{Hits: map[string]int{}}); len(got) != 1 {
		t.Errorf("a declared stub with no hit went unreported: %q", got)
	}
}
