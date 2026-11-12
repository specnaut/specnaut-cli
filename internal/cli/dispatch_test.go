package cli

import (
	"bytes"
	"errors"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"

	specnaut "github.com/specnaut/specnaut-cli"
	"github.com/specnaut/specnaut-cli/internal/lockfile"
	"github.com/specnaut/specnaut-cli/internal/reconcile"
)

// run drives Run with an in-memory Env: no process, no colour, the given
// project tree. It returns the exit code and both streams.
func run(t *testing.T, tree fstest.MapFS, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := Run(Env{
		Args:      args,
		Stdout:    &stdout,
		Stderr:    &stderr,
		LookupEnv: func(k string) (string, bool) { return map[string]string{"NO_COLOR": "1"}[k], k == "NO_COLOR" },
		ExecPath:  "/usr/local/bin/specnaut",
		Project: func() (reconcile.Project, error) {
			return reconcile.Project{Dir: "/p", Plain: tree, Contained: func() (lockfile.Contained, error) {
				return lockfile.Contained{Root: "/p", FS: tree}, nil
			}}, nil
		},
	})
	return code, stdout.String(), stderr.String()
}

func TestRunExitPaths(t *testing.T) {
	version, err := specnaut.Version()
	if err != nil {
		t.Fatal(err)
	}
	lock := func(harness string) fstest.MapFS {
		return fstest.MapFS{".specnaut/installed.lock": {Data: []byte(
			"version: 2\nharness: " + harness + "\ntemplates_version: 0.0.1\nentries: {}\n")}}
	}
	stagedLink, linkedStaging := lock("claude"), lock("claude")
	stagedLink[".specnaut/installed.lock"] = &fstest.MapFile{Data: []byte("version: 2\nharness: claude\n" +
		"templates_version: 0.0.1\nentries:\n  a.md:\n    sha256: x\n    installed_at: y\n    templates_version: z\n")}
	stagedLink[".specnaut/upgrade-staging/a.md"] = &fstest.MapFile{Data: []byte("../../a.md"), Mode: fs.ModeSymlink}
	linkedStaging[".specnaut/upgrade-staging"] = &fstest.MapFile{Data: []byte("../src"), Mode: fs.ModeSymlink}
	for _, c := range []struct {
		name           string
		tree           fstest.MapFS
		args           []string
		code           int    // a literal: the exit code is the contract, not the constant
		stdout, stderr string // the whole stream, or a prefix when it ends in "…"
	}{
		{"help", nil, []string{"--help"}, 0, Help(Palette{}) + "\n", ""},
		{"no arguments", nil, nil, 0, Help(Palette{}) + "\n", ""},
		{"version", nil, []string{"-v"}, 0, VersionLine(Palette{}, version, version) + "\n", ""},
		{"unknown", nil, []string{"bogus"}, 2, "", `Unknown command: "bogus"` + "\n" + Help(Palette{}) + "\n"},
		{"init --ai removed", nil, []string{"init", "--ai", "windsurf"}, 1, "",
			"error: windsurf is no longer supported — 5.5.0 was the last Specnaut release to install it.…"},
		{"lock names a removed harness", lock("windsurf"), []string{"reconcile", "--status"}, 1, "",
			"error: this project was installed for windsurf, which Specnaut no longer supports…"},
		{"not ported", nil, []string{"upgrade"}, 3, "",
			"error: `specnaut upgrade` is not ported to this Go build yet; use the released binary for it\n"},
		{"reconcile --status", lock("claude"), []string{"reconcile", "--status"}, 0,
			"{\n  \"pending\": [],\n  \"stagingDir\": null,\n  \"refused\": []\n}\n", ""},
		{"reconcile --status, a staged link", stagedLink, []string{"reconcile", "--status"}, 0,
			"{\n  \"pending\": [],\n  \"stagingDir\": null,\n  \"refused\": [\n    {\n      \"path\": \"a.md\",\n" +
				"      \"reason\": \"left .specnaut/upgrade-staging/a.md in place — refusing to read a staged path…", ""},
		{"reconcile --status, a linked staging folder", linkedStaging, []string{"reconcile", "--status"}, 1, "",
			"error: Uncaught (in promise) ContainmentRefusal: refusing to use a staging directory reached through a symlink:\n…"},
		{"malformed lock", fstest.MapFS{".specnaut/installed.lock": {Data: []byte("version: [")}},
			[]string{"reconcile", "--status"}, 1, "", "error: Uncaught (in promise) SyntaxError: …"},
	} {
		code, stdout, stderr := run(t, c.tree, c.args...)
		if code != c.code || !matches(stdout, c.stdout) || !matches(stderr, c.stderr) {
			t.Errorf("%s: exit %d\nstdout %q\nstderr %q\nwant exit %d, stdout %q, stderr %q",
				c.name, code, stdout, stderr, c.code, c.stdout, c.stderr)
		}
	}
}

// matches is equality, or a prefix match when want ends in "…".
func matches(got, want string) bool {
	if p, ok := strings.CutSuffix(want, "…"); ok {
		return strings.HasPrefix(got, p)
	}
	return got == want
}

func TestRunWarnsUnderTheLegacyName(t *testing.T) {
	var stderr bytes.Buffer
	Run(Env{Args: []string{"-v"}, Stdout: &bytes.Buffer{}, Stderr: &stderr,
		LookupEnv: func(string) (string, bool) { return "", false }, ExecPath: `C:\bin\specflow.exe`})
	if !strings.HasPrefix(stderr.String(), "\x1b[33mwarning: the 'specflow' command is deprecated") {
		t.Errorf("stderr = %q", stderr.String())
	}
}

func TestRunReportsAProjectThatCannotOpen(t *testing.T) {
	var stderr bytes.Buffer
	code := Run(Env{Args: []string{"reconcile", "--status"}, Stdout: &bytes.Buffer{}, Stderr: &stderr,
		LookupEnv: func(string) (string, bool) { return "", false },
		Project:   func() (reconcile.Project, error) { return reconcile.Project{}, errors.New("no cwd") }})
	if code != 1 || !strings.Contains(stderr.String(), "Uncaught (in promise) Error: no cwd") {
		t.Errorf("exit %d, stderr %q", code, stderr.String())
	}
}
