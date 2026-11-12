package lockfile

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/specnaut/specnaut-cli/internal/golden"
)

// OpenContained is the filesystem half of cli#574: a read through it stays
// inside the project however a link inside the project points.
func TestOpenContainedRefusesALinkLeadingOut(t *testing.T) {
	outside, project := t.TempDir(), t.TempDir()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(outside, "secret"), []byte("x"), 0o600))
	must(os.WriteFile(filepath.Join(project, "a.md"), []byte("inside"), 0o600))
	must(os.Symlink(filepath.Join(outside, "secret"), filepath.Join(project, "escape")))

	c, err := OpenContained(project, "")
	must(err)
	if real, _ := filepath.EvalSymlinks(project); c.Root != real {
		t.Errorf("Root = %q, want the project resolved through links, %q", c.Root, real)
	}
	fsys := c.FS
	if data, err := fs.ReadFile(fsys, "a.md"); err != nil || string(data) != "inside" {
		t.Errorf("a.md = %q, %v", data, err)
	}
	if _, err := fs.ReadFile(fsys, "escape"); err == nil {
		t.Error("a link leading out of the project was read")
	}
}

func TestOpenContainedRefusesHomeThroughALink(t *testing.T) {
	home := t.TempDir()
	link := filepath.Join(t.TempDir(), "home-link")
	if err := os.Symlink(home, link); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenContained(link, home); err == nil {
		t.Error("the home directory, reached through a link, was opened as the project")
	}
	if _, err := OpenContained(home, link); err == nil {
		t.Error("HOME given as a link to the project was not resolved before the comparison")
	}
}

type textCase struct {
	Text  string `json:"text"`
	Shown string `json:"shown"`
}

func TestTerminalTextMatchesTypeScript(t *testing.T) {
	for _, c := range golden.Load[textCase](t, "testdata/terminal_text_golden.jsonl", 10) {
		if got := TerminalText(c.Text); got != c.Shown {
			t.Errorf("TerminalText(%q) = %q; terminalText: %q", c.Text, got, c.Shown)
		}
	}
}
