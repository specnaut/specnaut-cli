// Package specnaut holds the template tree the binary ships, embedded as data.
//
// It lives at the module root because `//go:embed` cannot reach a parent
// directory, and templates/ sits beside go.mod.
package specnaut

import (
	"embed"
	"encoding/json"
	"fmt"
	"path"
	"slices"
	"sync"
)

// embedded is a SUPERSET of what ships: `all:` takes the whole directory,
// dotfiles included, so it also carries files the manifest does not list
// (templates_test.go names them). Nothing outside this file reads it, and
// nothing here walks it: every read goes through the manifest, which is the
// one list of shipped files — as `scripts/bundle-templates.ts` treats it.
//
//go:embed all:templates
var embedded embed.FS

const root = "templates"

// Entry is one shipped file, as templates/manifest.json declares it. Only the
// fields the Go port reads so far are decoded. A context-link entry
// (cli#680/#681) carries `link` instead of `source`: it ships no file.
type Entry struct {
	Source string `json:"source"`
	Link   string `json:"link"`
}

// Manifest is templates/manifest.json: the shipped file set and the version.
type Manifest struct {
	Version       string  `json:"version"`
	Core          []Entry `json:"core"`
	HarnessStatic []Entry `json:"harness_static"`
}

// Sources lists every shipped source path, relative to templates/.
func (m Manifest) Sources() []string {
	out := make([]string, 0, len(m.Core)+len(m.HarnessStatic))
	for _, e := range append(append([]Entry{}, m.Core...), m.HarnessStatic...) {
		if e.Link == "" {
			out = append(out, e.Source)
		}
	}
	return out
}

var manifest = sync.OnceValues(func() (Manifest, error) {
	data, err := embedded.ReadFile(path.Join(root, "manifest.json"))
	if err != nil {
		return Manifest{}, err
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Manifest{}, fmt.Errorf("templates/manifest.json: %w", err)
	}
	return m, nil
})

// LoadManifest decodes the embedded templates/manifest.json.
func LoadManifest() (Manifest, error) { return manifest() }

// Version is the binary's version. It is the manifest's, deliberately: the
// TypeScript binary keeps two values (`VERSION` and `TEMPLATES_VERSION`) that
// `scripts/bump-version.ts` holds equal, and a Go `version.go` constant would
// be a seventh file for that script to keep in step.
func Version() (string, error) {
	m, err := manifest()
	if err != nil {
		return "", err
	}
	if m.Version == "" {
		return "", fmt.Errorf("templates/manifest.json has no version")
	}
	return m.Version, nil
}

// ReadTemplate returns a shipped file's bytes. A path the manifest does not
// list is refused even when it is embedded, so the superset never leaks into
// what a command writes.
func ReadTemplate(source string) ([]byte, error) {
	m, err := manifest()
	if err != nil {
		return nil, err
	}
	if !slices.Contains(m.Sources(), source) {
		return nil, fmt.Errorf("%s is not a shipped template (absent from templates/manifest.json)", source)
	}
	return embedded.ReadFile(path.Join(root, source))
}
