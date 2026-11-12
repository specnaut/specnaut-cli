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
	// Dir is the directory as Deno.cwd() reports it: getcwd's answer, never
	// $PWD. The staging refusals name paths under it.
	Dir string
	// Plain is the directory as Deno.readTextFile and Deno.readDir see it:
	// links followed wherever they lead. FsLockStore reads the lock this way,
	// and FsStagingStore.list walks the staging tree this way.
	Plain fs.FS
	// Contained opens the project for the reads TypeScript guards with
	// assertInsideProject — an *os.Root's FS in the binary.
	Contained func() (lockfile.Contained, error)
}

// Refused is a staged copy the store refused to read (RefusedCopy in
// reconcile_path.ts), and the words that say why and what to do.
type Refused struct{ Path, Reason string }

// Queue is what `reconcile --status` prints: the pending queue, and the copies
// no command may act on. Neither slice is nil: each prints as `[]`.
type Queue struct {
	Pending []string
	Refused []Refused
}

// Status is ListPendingReconciliationsUseCase: staged paths `reconcile
// <path>` would resolve, in the staging walk's order. A copy refused by status
// (untracked, no project file) pends nothing and is hidden; one the store
// refuses to read — a link (cli#765) — is reported in Refused instead, in
// leftAlone's words: hiding it would leave a link nobody is told about. Any
// other error still ends the run. This is a read and deletes nothing.
func Status(p Project) (Queue, error) {
	lock, err := lockfile.Read(p.Plain)
	if err != nil {
		return Queue{}, err
	}
	staged, err := listStaged(p.Plain, p.Dir)
	if err != nil {
		return Queue{}, err
	}
	files := newFiles(p.Dir, p.Contained)
	q := Queue{Pending: []string{}, Refused: []Refused{}}
	for _, path := range staged {
		checked, err := Preflight(lock, files, path)
		var refusal *PathRefusal
		switch {
		case errors.As(err, &refusal):
			q.Refused = append(q.Refused, Refused{lockfile.TerminalText(path), leftAlone(StagingDir+"/"+path, refusal)})
		case err != nil:
			return Queue{}, err
		case checked.Refusal == Ready:
			q.Pending = append(q.Pending, path)
		}
	}
	return q, nil
}

// listStaged is FsStagingStore.list: every non-directory under the staging
// directory, relative to it, in `@std/fs` walk order — pre-order, each
// directory in the order the OS returns it (unsorted; fs.WalkDir sorts, and
// would print a different queue), links listed and never followed. A staging
// folder reached through a link is refused before anything is listed.
func listStaged(fsys fs.FS, dir string) ([]string, error) {
	if err := refuseLinkedStaging(fsys, dir); err != nil {
		return nil, err
	}
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

// refuseLinkedStaging is assertStagingNotLinked (cli#687): `.specnaut` and the
// staging folder are each refused as a link, since through one everything
// listed would be the link's target. A level that does not exist ends the
// check, as nothing below it can be listed.
func refuseLinkedStaging(fsys fs.FS, dir string) error {
	for _, rel := range []string{".specnaut", StagingDir} {
		info, err := fs.Lstat(fsys, rel)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			return linkedStagingRefusal(dir, rel)
		}
	}
	return nil
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
// `JSON.stringify({ pending, stagingDir, refused }, null, 2)`: same keys, same
// order, two-space indent, `[]` for an empty list, and `stagingDir` null when
// nothing is pending, refused copies or not.
func RenderStatus(q Queue) string {
	stagingDir := "null"
	if len(q.Pending) > 0 {
		stagingDir = js.Quote(StagingDir)
	}
	pending := make([]string, len(q.Pending))
	for i, p := range q.Pending {
		pending[i] = js.Quote(p)
	}
	refused := make([]string, len(q.Refused))
	for i, r := range q.Refused {
		refused[i] = "{\n      \"path\": " + js.Quote(r.Path) + ",\n      \"reason\": " +
			js.Quote(r.Reason) + "\n    }"
	}
	return "{\n  \"pending\": " + jsonArray(pending) + ",\n  \"stagingDir\": " + stagingDir +
		",\n  \"refused\": " + jsonArray(refused) + "\n}"
}

// jsonArray is a top-level key's array as JSON.stringify(…, null, 2) lays it
// out, from elements already rendered: `[]` when empty, else one per line.
func jsonArray(items []string) string {
	if len(items) == 0 {
		return "[]"
	}
	return "[\n    " + strings.Join(items, ",\n    ") + "\n  ]"
}
