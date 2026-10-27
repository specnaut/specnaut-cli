// Package lockfile reads `.specnaut/installed.lock`, the record of what a
// project has installed. It is the Go port of `parseLock` in
// `src/domain/installed_lock.ts` and of `FsLockStore.read`.
package lockfile

import (
	"errors"
	"fmt"
	"io/fs"
	"slices"
	"strings"

	"github.com/specnaut/specnaut-cli/internal/js"
)

// Path is where the lock lives, relative to the project directory.
const Path = ".specnaut/installed.lock"

// The value lists installed_lock.ts owns. parser.ts validates `--ai`,
// `--backlog`, `--scheme` and `--spec-backend` against the same ones.
var (
	KnownHarnesses      = []string{"claude", "cursor", "codex", "copilot", "opencode", "antigravity"}
	KnownBacklogBackend = []string{"local", "github", "gitlab", "cloud"}
	KnownVersionSchemes = []string{"semver", "date"}
	KnownSpecBackends   = []string{"local", "cloud"}
)

// RemovedHarnesses are harnesses Specnaut used to install, with the last
// release that still did. A lock naming one is a project the CLI left behind,
// not a corrupt file, so it gets a message saying what happened.
var RemovedHarnesses = map[string]string{"windsurf": "5.5.0"}

// IsRemovedHarness is `Object.hasOwn(REMOVED_HARNESSES, key)`.
func IsRemovedHarness(key string) bool {
	_, ok := RemovedHarnesses[key]
	return ok
}

// RemovedHarnessInitNotice is what `init --ai <removed>` prints: there is no
// project yet, so no migration.
func RemovedHarnessInitNotice(key string) string {
	return fmt.Sprintf("%s is no longer supported — %s was the last Specnaut release to install it. "+
		"Supported harnesses: %s.", key, RemovedHarnesses[key], strings.Join(KnownHarnesses, ", "))
}

func removedHarnessMigration(key string) string {
	return "To switch harness, run `specnaut init --here --force --ai <harness>` with one of: " +
		strings.Join(KnownHarnesses, ", ") + ". Files it replaces are backed up to *.specnaut.bak; " +
		"." + key + "/ is left in place for you to delete."
}

// RemovedHarnessError is a lock naming a removed harness. Every command that
// loads the lock reports it the same way (main.ts `run`), never as a trace.
type RemovedHarnessError struct{ Harness string }

func (e *RemovedHarnessError) Error() string {
	return fmt.Sprintf("this project was installed for %s, which Specnaut no longer supports "+
		"(%s was the last release to install it). Nothing was changed.\n%s",
		e.Harness, RemovedHarnesses[e.Harness], removedHarnessMigration(e.Harness))
}

// Entry is one installed file.
type Entry struct {
	SHA256           string
	InstalledAt      string
	TemplatesVersion string
}

// Lock is a parsed installed.lock. Only what the ported commands read is
// kept; parseLock's defaulting of the backend fields is not observable yet.
type Lock struct {
	Harness          string
	TemplatesVersion string
	Entries          map[string]Entry
}

// Has reports whether the lock tracks path.
func (l *Lock) Has(path string) bool {
	_, ok := l.Entries[path]
	return ok
}

// Read loads the lock from a project tree. No lock is (nil, nil), as
// FsLockStore returns null on NotFound; every other failure is an error.
func Read(project fs.FS) (*Lock, error) {
	data, err := fs.ReadFile(project, Path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return Parse(data)
}

// Parse is parseLock: the same checks, in the same order, so the same lock
// is refused for the same reason. Only a removed harness is a
// *RemovedHarnessError; every other refusal is the error TypeScript throws
// uncaught.
func Parse(data []byte) (*Lock, error) {
	v, err := decodeYAML(data)
	if err != nil {
		return nil, err
	}
	root, err := asObject(v, "lock root")
	if err != nil {
		return nil, err
	}
	version, _ := root["version"].(float64)
	if _, isNum := root["version"].(float64); !isNum || (version != 1 && version != 2) {
		return nil, fmt.Errorf("Unsupported lock version (expected 1 or 2): %s", jsString(root["version"]))
	}
	harness := "claude"
	if version == 2 {
		if harness, err = knownHarness(root["harness"]); err != nil {
			return nil, err
		}
	}
	tv, ok := root["templates_version"].(string)
	if !ok {
		return nil, errors.New("missing top-level templates_version")
	}
	entries, err := parseEntries(root["entries"])
	if err != nil {
		return nil, err
	}
	return &Lock{Harness: harness, TemplatesVersion: tv, Entries: entries}, nil
}

func knownHarness(v any) (string, error) {
	s, ok := v.(string)
	if ok && IsRemovedHarness(s) {
		return "", &RemovedHarnessError{Harness: s}
	}
	if !ok || !slices.Contains(KnownHarnesses, s) {
		return "", fmt.Errorf("Unsupported harness '%s' — known: %s", jsString(v), strings.Join(KnownHarnesses, ", "))
	}
	return s, nil
}

func parseEntries(v any) (map[string]Entry, error) {
	if v == nil {
		v = map[string]any{}
	}
	raw, err := asObject(v, "entries")
	if err != nil {
		return nil, err
	}
	out := make(map[string]Entry, len(raw))
	for path, value := range raw {
		if err := SafeDestination(path); err != nil {
			return nil, fmt.Errorf("entries[%s] is not a legal destination: %w", path, err)
		}
		e, err := asObject(value, "entries["+path+"]")
		if err != nil {
			return nil, err
		}
		entry, err := parseEntry(path, e)
		if err != nil {
			return nil, err
		}
		out[path] = entry
	}
	return out, nil
}

func parseEntry(path string, e map[string]any) (Entry, error) {
	var fields [3]string
	for i, name := range []string{"sha256", "installed_at", "templates_version"} {
		s, ok := e[name].(string)
		if !ok {
			return Entry{}, fmt.Errorf("entries[%s].%s must be string", path, name)
		}
		fields[i] = s
	}
	return Entry{SHA256: fields[0], InstalledAt: fields[1], TemplatesVersion: fields[2]}, nil
}

// asObject is installed_lock.ts's: anything `typeof "object"` and not null
// passes — an array included, read by its indices as Object.entries reads it.
func asObject(v any, name string) (map[string]any, error) {
	switch x := v.(type) {
	case map[string]any:
		return x, nil
	case []any:
		out := make(map[string]any, len(x))
		for i, e := range x {
			out[fmt.Sprint(i)] = e
		}
		return out, nil
	case opaque:
		return map[string]any{}, nil
	}
	return nil, fmt.Errorf("%s must be an object", name)
}

// jsString is `String(v)` for the values an error message may name.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "undefined"
	case string:
		return x
	case float64:
		return js.NumberToString(x)
	case bool:
		return fmt.Sprint(x)
	}
	return "[object Object]"
}
