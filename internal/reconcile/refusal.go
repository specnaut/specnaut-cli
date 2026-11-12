package reconcile

import (
	"path/filepath"

	"github.com/specnaut/specnaut-cli/internal/lockfile"
)

// PathRefusal is src/application/path_refusal.ts's PathRefusal: a path the
// staging store refused because of where it leads, which a caller may report
// instead of failing on. Name is the JavaScript class TypeScript throws, so an
// uncaught one is reported as Deno reports it.
type PathRefusal struct{ class, msg string }

func (e *PathRefusal) Error() string { return e.msg }

// Name is the JavaScript class this refusal stands for.
func (e *PathRefusal) Name() string { return e.class }

// stagedEntryRefusal is fs_refusals.ts's: a staged path that is a link, or
// lies behind one (cli#751, cli#765). abs is the path as the project directory
// names it, resolved where it lands with the folders resolved, root the
// project resolved through links.
func stagedEntryRefusal(root, abs, resolved, action string) error {
	return &PathRefusal{"ContainmentRefusal", "refusing to " + action +
		" a staged path that is a link or lies behind one:\n" +
		"  path:     " + lockfile.TerminalText(abs) + "\n" +
		"  resolves: " + lockfile.TerminalText(resolved) + "\n" +
		"  project:  " + lockfile.TerminalText(root) + "\n" +
		"Specnaut reads and deletes only the plain copies it staged inside the staging folder."}
}

// linkedStagingRefusal is fs_refusals.ts's: the staging tree reached through a
// link (cli#687), where everything listed would be the link's target. dir is
// the project directory as the process reports it, which TypeScript names here.
func linkedStagingRefusal(dir, rel string) error {
	return &PathRefusal{"ContainmentRefusal",
		"refusing to use a staging directory reached through a symlink:\n" +
			"  path:    " + lockfile.TerminalText(filepath.Join(dir, filepath.FromSlash(rel))) + "\n" +
			"  project: " + lockfile.TerminalText(dir) + "\n" +
			"Specnaut stages its own copies there and deletes them; through a link, it would " +
			"delete whatever the link points at."}
}

// leftAlone is upgrade_staging.ts's: the words for a staged path the store
// refused. "Safe to delete by hand" would invite deleting what a link points
// at, a file Specnaut never wrote, so the advice names the link itself.
func leftAlone(path string, err *PathRefusal) string {
	return "left " + lockfile.TerminalText(path) + " in place — " + lockfile.InertText(err.Error()) + "\n" +
		"It is not a plain staged copy: check where that link points, then remove the link " +
		"itself, never what it points at."
}
