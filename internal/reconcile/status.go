package reconcile

import (
	"errors"
	"fmt"
	"io/fs"
	"strings"

	"github.com/specnaut/specnaut-cli/internal/js"
	"github.com/specnaut/specnaut-cli/internal/lockfile"
)

// Project is the project directory, in the two views TypeScript reads it in.
type Project struct {
	// Plain is the directory as Deno.readTextFile and Deno.readDir see it:
	// links followed wherever they lead. FsLockStore reads the lock this way,
	// and FsStagingStore.list walks the staging tree this way.
	Plain fs.FS
	// Contained opens the project for the reads TypeScript guards with
	// assertInsideProject — an *os.Root's FS in the binary.
	Contained func() (fs.FS, error)
}

// Status is the queue behind `reconcile --status`: staged paths that
// `reconcile <path>` would resolve, in the staging walk's order. A staged
// copy it would refuse is pending nothing, so it is not listed; this is a
// read and deletes nothing. The slice is never nil: it prints as `[]`.
func Status(p Project) ([]string, error) {
	lock, err := lockfile.Read(p.Plain)
	if err != nil {
		return nil, err
	}
	staged, err := listStaged(p.Plain)
	if err != nil {
		return nil, err
	}
	files := newFiles(p.Contained)
	out := []string{}
	for _, path := range staged {
		checked, err := Preflight(lock, files, path)
		if err != nil {
			return nil, err
		}
		if checked.Refusal == Ready {
			out = append(out, path)
		}
	}
	return out, nil
}

// listStaged is FsStagingStore.list: every non-directory under the staging
// directory, relative to it, in `@std/fs` walk order — pre-order, each
// directory in the order the OS returns it (unsorted; fs.WalkDir sorts, and
// would print a different queue), links listed and never followed.
func listStaged(fsys fs.FS) ([]string, error) {
	info, err := fs.Stat(fsys, StagingDir)
	if errors.Is(err, fs.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []string{}
	if !info.IsDir() {
		return out, nil
	}
	return out, walk(fsys, StagingDir, "", &out)
}

func walk(fsys fs.FS, dir, rel string, out *[]string) error {
	entries, err := readDirUnsorted(fsys, dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		name := rel + e.Name()
		// IsDir is the entry's own type (lstat): a link to a directory is
		// not a directory here, so it is listed and never followed.
		if !e.IsDir() {
			*out = append(*out, strings.ReplaceAll(name, `\`, "/"))
			continue
		}
		if err := walk(fsys, dir+"/"+e.Name(), name+"/", out); err != nil {
			return err
		}
	}
	return nil
}

func readDirUnsorted(fsys fs.FS, dir string) ([]fs.DirEntry, error) {
	f, err := fsys.Open(dir)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	d, ok := f.(fs.ReadDirFile)
	if !ok {
		return nil, fmt.Errorf("%s: not a directory", dir)
	}
	return d.ReadDir(-1)
}

// RenderStatus is reconcile_handler.ts's
// `JSON.stringify({ pending, stagingDir }, null, 2)`: same keys, same order,
// two-space indent, `[]` and `null` when nothing is pending.
func RenderStatus(pending []string) string {
	if len(pending) == 0 {
		return "{\n  \"pending\": [],\n  \"stagingDir\": null\n}"
	}
	quoted := make([]string, len(pending))
	for i, p := range pending {
		quoted[i] = "    " + js.Quote(p)
	}
	return "{\n  \"pending\": [\n" + strings.Join(quoted, ",\n") + "\n  ],\n  \"stagingDir\": " +
		js.Quote(StagingDir) + "\n}"
}
