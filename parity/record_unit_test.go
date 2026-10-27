package parity

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
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
