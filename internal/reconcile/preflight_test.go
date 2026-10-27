package reconcile

import (
	"errors"
	"io/fs"
	"testing"
	"testing/fstest"

	"github.com/specnaut/specnaut-cli/internal/lockfile"
)

func TestPreflightReasonsInOrder(t *testing.T) {
	lock := &lockfile.Lock{Entries: map[string]lockfile.Entry{"a.md": {}, "b.md": {}, "c.md": {}}}
	tree := fstest.MapFS{
		".specnaut/upgrade-staging/a.md": file("up"),
		"a.md":                           file("local"),
		".specnaut/upgrade-staging/b.md": file("up"),
		"c.md":                           file("local"),
	}
	files := newFiles(func() (fs.FS, error) { return tree, nil })
	for _, c := range []struct {
		lock *lockfile.Lock
		path string
		want Refusal
	}{
		{nil, "a.md", NoMarker},
		{lock, "z.md", NoLockEntry},
		{lock, "c.md", NoStaging},
		{lock, "b.md", NoProjectFile},
		{lock, "a.md", Ready},
	} {
		got, err := Preflight(c.lock, files, c.path)
		if err != nil || got.Refusal != c.want {
			t.Errorf("Preflight(%s) = %q, %v; want %q", c.path, got.Refusal, err, c.want)
		}
	}
	ready, _ := Preflight(lock, files, "a.md")
	if string(ready.Staged) != "up" || string(ready.OnDisk) != "local" {
		t.Errorf("ready carries staged %q, on disk %q", ready.Staged, ready.OnDisk)
	}
}

func TestPreflightReadsNormalisedPaths(t *testing.T) {
	lock := &lockfile.Lock{Entries: map[string]lockfile.Entry{"a//b.md": {}}}
	tree := fstest.MapFS{".specnaut/upgrade-staging/a/b.md": file("up"), "a/b.md": file("local")}
	got, err := Preflight(lock, newFiles(func() (fs.FS, error) { return tree, nil }), "a//b.md")
	if err != nil || got.Refusal != Ready {
		t.Errorf("a//b.md resolves to a/b.md as @std/path resolve does; got %q, %v", got.Refusal, err)
	}
}

func TestPreflightPropagatesAContainmentRefusal(t *testing.T) {
	lock := &lockfile.Lock{Entries: map[string]lockfile.Entry{"a.md": {}}}
	refused := errors.New("refusing to operate with the filesystem root as the project: /")
	_, err := Preflight(lock, newFiles(func() (fs.FS, error) { return nil, refused }), "a.md")
	if !errors.Is(err, refused) {
		t.Errorf("err = %v, want the root refusal", err)
	}
}

func TestPreflightRefusesAnUnsafePath(t *testing.T) {
	lock := &lockfile.Lock{Entries: map[string]lockfile.Entry{"../x": {}}} // parseLock forbids it; the read checks again
	_, err := Preflight(lock, newFiles(func() (fs.FS, error) { return fstest.MapFS{}, nil }), "../x")
	if err == nil {
		t.Error("an escaping path was read")
	}
}
