package lockfile

import (
	"errors"
	"path"
	"regexp"
	"strings"
)

// Lock keys stay inside the project (cli#574). Two halves, as in TypeScript:
//
//   - SafeDestination, the string half (`assertSafeDestination` in
//     src/domain/template.ts): a key is a project-relative file name, or the
//     lock is refused. A committed lock comes from whoever pushed it, and a
//     key of `../../../../etc/passwd` used to be read.
//   - the filesystem half, which TypeScript does with realPath comparisons
//     (fs_containment.ts) and Go does with an *os.Root: every contained read
//     goes through one, and the kernel refuses a symlink leading out. The
//     root itself is vetted by RefuseRoot before it is opened.
//
// Nothing else checks containment; a `strings.HasPrefix` test in a caller is
// the duplicate this file exists to prevent.

var trailingName = regexp.MustCompile(`[. ]$`)

// SafeDestination refuses a destination that is absolute, escapes with `..`,
// names the project itself, or ends in a name the filesystem may read as
// something else (a trailing separator, dot or space). Pure: no I/O.
func SafeDestination(dest string) error {
	n := normalize(dest)
	switch {
	case strings.HasPrefix(n, "/"):
		return errors.New("Unsafe destination (absolute path): " + dest)
	case strings.TrimRight(n, `\/`) == ".":
		return errors.New("Unsafe destination (the target directory itself): " + dest)
	case n == ".." || strings.HasPrefix(n, "../") || strings.Contains(n, "/../") || strings.HasSuffix(n, "/.."):
		return errors.New("Unsafe destination (escape attempt): " + dest)
	}
	if strings.HasSuffix(n, "/") || strings.HasSuffix(n, `\`) || anySegment(n, trailingName) {
		return errors.New("Unsafe destination (a name the filesystem may read differently): " + dest)
	}
	return nil
}

func anySegment(n string, re *regexp.Regexp) bool {
	for _, s := range strings.FieldsFunc(n, func(r rune) bool { return r == '/' || r == '\\' }) {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}

// normalize is @std/path's POSIX normalize: lexical, `.`/`..` resolved, an
// empty path is ".", and a trailing separator is kept (path.Clean drops it).
func normalize(p string) string {
	if p == "" {
		return "."
	}
	n := path.Clean(p)
	if strings.HasSuffix(p, "/") && n != "/" {
		n += "/"
	}
	return n
}

// RefuseRoot vets a resolved project directory before it is opened as the
// root of contained reads (`resolveProjectRoot` in fs_containment.ts): never
// the filesystem root, never the home directory. A root reached through a
// link that resolves somewhere broad would make everything under it count as
// inside. Both arguments are already resolved; home may be "".
func RefuseRoot(root, home string) error {
	if root == "/" {
		return errors.New("refusing to operate with the filesystem root as the project: " + root)
	}
	if home != "" && root == home {
		return errors.New("refusing to operate with the home directory as the project: " + root)
	}
	return nil
}
