// Package reconcile is the Go port of `specnaut reconcile`: so far the
// `--status` listing (src/application/reconcile_path.ts
// ListPendingReconciliationsUseCase) and the preflight it shares with
// `reconcile <path>`.
package reconcile

import (
	"errors"
	"io/fs"
	"path"
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
// (and its refusal of `/` and $HOME) runs only when a path is checked.
type Files struct{ open func() (fs.FS, error) }

func newFiles(open func() (fs.FS, error)) Files { return Files{open: sync.OnceValues(open)} }

// read returns a project-relative file, or found=false when it is absent.
// The string check repeats parseLock's on purpose: a caller may hand in a
// path that never was a lock key.
func (f Files) read(rel string) (data []byte, found bool, err error) {
	if err := lockfile.SafeDestination(rel); err != nil {
		return nil, false, err
	}
	fsys, err := f.open()
	if err != nil {
		return nil, false, err
	}
	data, err = fs.ReadFile(fsys, path.Clean(rel))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	return data, err == nil, err
}

// Preflight is every reason `reconcile <path>` refuses a path, in one place.
// `reconcile --status` asks the same question, because a listing that
// consulted nothing named paths `reconcile` then refused, and a queue nobody
// could empty kept the review marker alive forever (#613). A second spelling
// of these checks is how they would drift apart again.
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
	staged, ok, err := files.read(StagingDir + "/" + p)
	if err != nil || !ok {
		return Checked{Refusal: NoStaging}, err
	}
	onDisk, ok, err := files.read(p)
	if err != nil || !ok {
		return Checked{Refusal: NoProjectFile}, err
	}
	return Checked{Refusal: Ready, Staged: staged, OnDisk: onDisk}, nil
}
