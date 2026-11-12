// Package reconcile is the Go port of `specnaut reconcile`: so far the
// `--status` listing (src/application/reconcile_path.ts
// ListPendingReconciliationsUseCase) and the preflight it shares with
// `reconcile <path>`.
package reconcile

import (
	"errors"
	"io/fs"
	"path"
	"path/filepath"
	"sync"

	"github.com/specnaut/specnaut-cli/internal/lockfile"
)

// StagingDir is where `upgrade` leaves the upstream copy of a preserved file.
const StagingDir = ".specnaut/upgrade-staging"

// Refusal is why `reconcile <path>` refuses a path; Ready when it does not.
type Refusal string

// The refusals, in the order Preflight checks them (reconcile_handler.ts
// prints one message per kind).
const (
	Ready         Refusal = ""
	NoMarker      Refusal = "no-marker"
	NoLockEntry   Refusal = "no-lock-entry"
	NoStaging     Refusal = "no-staging"
	NoProjectFile Refusal = "no-project-file"
)

// Checked is a preflight verdict, with what a ready path needs to resolve.
type Checked struct {
	Refusal        Refusal
	Staged, OnDisk []byte
}

// Files reads project files through the contained view, which is opened at
// most once and only when a read needs it — in TypeScript resolveProjectRoot
// (and its refusal of `/` and $HOME) runs only when a path is checked. dir is
// the project directory as the process reports it.
type Files struct {
	dir  string
	open func() (lockfile.Contained, error)
}

func newFiles(dir string, open func() (lockfile.Contained, error)) Files {
	return Files{dir: dir, open: sync.OnceValues(open)}
}

// read returns a project-relative file, or found=false when it is absent.
// The string check repeats parseLock's on purpose: a caller may hand in a
// path that never was a lock key.
func (f Files) read(rel string) (data []byte, found bool, err error) {
	if err := lockfile.SafeDestination(rel); err != nil {
		return nil, false, err
	}
	c, err := f.open()
	if err != nil {
		return nil, false, err
	}
	data, err = fs.ReadFile(c.FS, path.Clean(rel))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	return data, err == nil, err
}

// readStaged is FsStagingStore.read: the staged copy of p, found=false when
// nothing is staged there. It judges the entry itself, never where it leads
// (cli#765): a read that followed a staged link took the link's target for
// the upstream copy, so a link — to a file, a folder, out of the project or to
// nothing — is a PathRefusal, whatever it points at.
//
// Only the entry is judged, and `resolves` is where it already is: every path
// `--status` hands in comes from listStaged, which never descends a link, so
// its folders are real. `reconcile <path>` can name a path behind a linked
// folder; it is not ported yet, and its port brings stagedEntry's resolution
// of the folders (fs_staging_store.ts) with it.
func (f Files) readStaged(p string) (data []byte, found bool, err error) {
	rel := path.Clean(StagingDir + "/" + p)
	if err := lockfile.SafeDestination(rel); err != nil {
		return nil, false, err
	}
	c, err := f.open()
	if err != nil {
		return nil, false, err
	}
	info, err := fs.Lstat(c.FS, rel)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		native := filepath.FromSlash(rel)
		return nil, false, stagedEntryRefusal(c.Root, filepath.Join(f.dir, native),
			filepath.Join(c.Root, native), "read")
	}
	return f.read(rel)
}

// Preflight is every reason `reconcile <path>` refuses a path, in one place.
// `reconcile --status` asks the same question, because a listing that
// consulted nothing named paths `reconcile` then refused, and a queue nobody
// could empty kept the review marker alive forever (#613). A second spelling
// of these checks is how they would drift apart again. A staged copy the
// store refuses to read is a *PathRefusal error, which `--status` reports.
func Preflight(lock *lockfile.Lock, files Files, p string) (Checked, error) {
	if lock == nil {
		return Checked{Refusal: NoMarker}, nil
	}
	if !lock.Has(p) {
		return Checked{Refusal: NoLockEntry}, nil
	}
	if err := lockfile.SafeDestination(p); err != nil {
		return Checked{}, err
	}
	staged, ok, err := files.readStaged(p)
	if err != nil || !ok {
		return Checked{Refusal: NoStaging}, err
	}
	onDisk, ok, err := files.read(p)
	if err != nil || !ok {
		return Checked{Refusal: NoProjectFile}, err
	}
	return Checked{Refusal: Ready, Staged: staged, OnDisk: onDisk}, nil
}
