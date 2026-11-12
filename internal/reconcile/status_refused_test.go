package reconcile

import (
	"errors"
	"io/fs"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/specnaut/specnaut-cli/internal/lockfile"
)

// The staged copies `--status` reports instead of listing or hiding them
// (cli#765), and the staging folder it refuses to list at all (cli#687).

func link(target string) *fstest.MapFile {
	return &fstest.MapFile{Data: []byte(target), Mode: fs.ModeSymlink}
}

// A staged copy the store refuses to read (cli#765) is reported, never thrown:
// the upgrade walk parses this JSON. The words are leftAlone's around
// stagedEntryRefusal's, as TypeScript prints them.
func TestStatusReportsAStagedLinkItRefusesToRead(t *testing.T) {
	tree := fstest.MapFS{
		".specnaut/installed.lock":              lockWith("claude", "a/plain.md", "a/tool", "b/dangling"),
		"a/plain.md":                            file("local"),
		"src/tool.ts":                           file("the user's own file"),
		".specnaut/upgrade-staging/a/plain.md":  file("up"),
		".specnaut/upgrade-staging/a/tool":      link("../../../src/tool.ts"),
		".specnaut/upgrade-staging/b/dangling":  link("nowhere"),
		".specnaut/upgrade-staging/b/untracked": link("../../../src/tool.ts"),
	}
	got, err := Status(project(tree, new(int)))
	if err != nil {
		t.Fatal(err)
	}
	if !equal(got.Pending, []string{"a/plain.md"}) {
		t.Errorf("pending = %q, want only the plain copy", got.Pending)
	}
	var paths []string
	for _, r := range got.Refused {
		paths = append(paths, r.Path)
	}
	if !equal(paths, []string{"a/tool", "b/dangling"}) {
		t.Fatalf("refused = %q, want the two tracked links and not the untracked one", paths)
	}
	at := func(s string) string { return filepath.FromSlash(s) }
	want := "left .specnaut/upgrade-staging/a/tool in place — " +
		"refusing to read a staged path that is a link or lies behind one:\n" +
		"  path:     " + at("/cwd/p/.specnaut/upgrade-staging/a/tool") + "\n" +
		"  resolves: " + at("/real/p/.specnaut/upgrade-staging/a/tool") + "\n" +
		"  project:  /real/p\n" +
		"Specnaut reads and deletes only the plain copies it staged inside the staging folder.\n" +
		"It is not a plain staged copy: check where that link points, then remove the link " +
		"itself, never what it points at."
	if got.Refused[0].Reason != want {
		t.Errorf("reason:\n%s\nwant\n%s", got.Refused[0].Reason, want)
	}
}

// Only a PathRefusal is reported: any other error, here the project refused
// as the home directory, still ends the run, as TypeScript rethrows it.
func TestStatusEndsOnAnErrorThatIsNotARefusal(t *testing.T) {
	tree := fstest.MapFS{
		".specnaut/installed.lock":       lockWith("claude", "a.md"),
		".specnaut/upgrade-staging/a.md": file("up"),
	}
	home := errors.New("refusing to operate with the home directory as the project: /h")
	_, err := Status(Project{Dir: "/h", Plain: tree, Contained: func() (lockfile.Contained, error) {
		return lockfile.Contained{}, home
	}})
	if !errors.Is(err, home) {
		t.Errorf("err = %v, want the home refusal", err)
	}
}

// A staging folder reached through a link is refused before anything is
// listed (cli#687), as FsStagingStore.list refuses it: what it would list is
// the link's target. TypeScript throws it past main.ts.
func TestStatusRefusesAStagingFolderReachedThroughALink(t *testing.T) {
	for at, tree := range map[string]fstest.MapFS{
		".specnaut": {
			".specnaut":                      link("elsewhere"),
			"elsewhere/installed.lock":       lockWith("claude", "a.md"),
			"elsewhere/upgrade-staging/a.md": file("up"),
			"a.md":                           file("local"),
		},
		StagingDir: {
			".specnaut/installed.lock": lockWith("claude", "a.md"),
			StagingDir:                 link("../src"),
			"src/a.md":                 file("the user's own file"),
			"a.md":                     file("local"),
		},
	} {
		_, err := Status(project(tree, new(int)))
		var refused *PathRefusal
		want := "refusing to use a staging directory reached through a symlink:\n" +
			"  path:    " + filepath.FromSlash("/cwd/p/"+at) + "\n" +
			"  project: /cwd/p\n" +
			"Specnaut stages its own copies there and deletes them; through a link, it would " +
			"delete whatever the link points at."
		if !errors.As(err, &refused) || refused.Name() != "ContainmentRefusal" || err.Error() != want {
			t.Errorf("%s linked: err = %v, want a ContainmentRefusal saying\n%s", at, err, want)
		}
	}
}
