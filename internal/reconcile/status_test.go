package reconcile

import (
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"

	"github.com/specnaut/specnaut-cli/internal/lockfile"
)

func lockWith(harness string, keys ...string) *fstest.MapFile {
	body := "version: 2\nharness: " + harness + "\ntemplates_version: 0.0.1\nentries:\n"
	for _, k := range keys {
		body += "  '" + k + "':\n    sha256: x\n    installed_at: y\n    templates_version: z\n"
	}
	return &fstest.MapFile{Data: []byte(body)}
}

func file(s string) *fstest.MapFile { return &fstest.MapFile{Data: []byte(s)} }

// project serves one in-memory tree as both views, and counts how often the
// contained view is opened.
func project(tree fstest.MapFS, opened *int) Project {
	return Project{Plain: tree, Contained: func() (fs.FS, error) {
		*opened++
		return tree, nil
	}}
}

func TestStatusListsOnlyWhatReconcileWouldResolve(t *testing.T) {
	tree := fstest.MapFS{
		".specnaut/installed.lock":            lockWith("claude", "a/one.md", "a/two.md", "b/r&d.md", "a/gone.md"),
		"a/one.md":                            file("local"),
		"a/two.md":                            file("local"),
		"b/r&d.md":                            file("local"),
		".specnaut/upgrade-staging/a/one.md":  file("up"),
		".specnaut/upgrade-staging/a/two.md":  file("up"),
		".specnaut/upgrade-staging/b/r&d.md":  file("up"),
		".specnaut/upgrade-staging/c/x.md":    file("not in the lock"),
		".specnaut/upgrade-staging/a/gone.md": file("no project file"),
	}
	var opened int
	got, err := Status(project(tree, &opened))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"a/one.md", "a/two.md", "b/r&d.md"} // MapFS lists sorted; the OS does not
	if !equal(got, want) {
		t.Errorf("Status = %q, want %q", got, want)
	}
	if opened != 1 {
		t.Errorf("the contained view was opened %d times, want once", opened)
	}
}

func TestStatusWithNothingStagedNeverOpensTheContainedView(t *testing.T) {
	for name, tree := range map[string]fstest.MapFS{
		"no project":          {},
		"no staging":          {".specnaut/installed.lock": lockWith("claude", "a.md")},
		"staging is a file":   {".specnaut/upgrade-staging": file("x")},
		"staged but no lock":  {".specnaut/upgrade-staging/a.md": file("x")},
		"staged, not tracked": {".specnaut/installed.lock": lockWith("claude"), ".specnaut/upgrade-staging/a.md": file("x")},
	} {
		var opened int
		got, err := Status(Project{Plain: tree, Contained: func() (fs.FS, error) {
			opened++
			return nil, errors.New("refusing to operate with the home directory as the project")
		}})
		if err != nil || got == nil || len(got) != 0 || opened != 0 {
			t.Errorf("%s: Status = %q (nil=%v), %v; contained opened %d times", name, got, got == nil, err, opened)
		}
	}
}

func TestStatusRefusesARemovedHarnessBeforeListing(t *testing.T) {
	tree := fstest.MapFS{".specnaut/installed.lock": lockWith("windsurf", "a.md")}
	_, err := Status(project(tree, new(int)))
	var removed *lockfile.RemovedHarnessError
	if !errors.As(err, &removed) || removed.Harness != "windsurf" {
		t.Errorf("err = %v, want a RemovedHarnessError for windsurf", err)
	}
}

func TestStatusYieldsASymlinkAsAnEntry(t *testing.T) {
	tree := fstest.MapFS{
		".specnaut/installed.lock":         lockWith("claude", "link"),
		".specnaut/upgrade-staging/link":   &fstest.MapFile{Data: []byte("elsewhere"), Mode: fs.ModeSymlink},
		".specnaut/upgrade-staging/sub/a":  file("x"),
		".specnaut/upgrade-staging/dirlnk": &fstest.MapFile{Data: []byte("sub"), Mode: fs.ModeSymlink},
	}
	got, err := listStaged(tree)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"dirlnk", "link", "sub/a"}; !equal(got, want) {
		t.Errorf("listStaged = %q, want %q (a link is listed, never followed)", got, want)
	}
}

func TestRenderStatus(t *testing.T) {
	if got, want := RenderStatus([]string{}), "{\n  \"pending\": [],\n  \"stagingDir\": null\n}"; got != want {
		t.Errorf("empty:\n%s\nwant\n%s", got, want)
	}
	got := RenderStatus([]string{"a/one.md", "b/r&d.md"})
	want := "{\n  \"pending\": [\n    \"a/one.md\",\n    \"b/r&d.md\"\n  ],\n  \"stagingDir\": \".specnaut/upgrade-staging\"\n}"
	if got != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
