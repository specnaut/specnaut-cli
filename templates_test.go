package specnaut

import (
	"io/fs"
	"slices"
	"testing"
)

// notShipped are the files `//go:embed all:templates` carries that the
// manifest does not ship. The embed is a superset by construction (it takes
// the directory), so the extras are named here: a new file under templates/
// that is not in the manifest must be added to this list on purpose, or to
// the manifest.
var notShipped = []string{
	".gitkeep",
	"core/root/README.md",
	"core/skills/alias-example/SKILL.md",
	"manifest.json",
}

func embeddedFiles(t *testing.T) []string {
	t.Helper()
	var out []string
	err := fs.WalkDir(embedded, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			out = append(out, p[len(root)+1:])
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestManifestSourcesAreEmbedded(t *testing.T) {
	m, err := LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	embeddedSet := embeddedFiles(t)
	for _, src := range m.Sources() {
		if !slices.Contains(embeddedSet, src) {
			t.Errorf("manifest source %q is not embedded", src)
		}
	}
	if len(m.Sources()) == 0 {
		t.Fatal("the manifest lists no source")
	}
}

func TestEmbeddedMinusManifestIsTheNamedList(t *testing.T) {
	m, err := LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	var extras []string
	for _, f := range embeddedFiles(t) {
		if !slices.Contains(m.Sources(), f) {
			extras = append(extras, f)
		}
	}
	slices.Sort(extras)
	if !slices.Equal(extras, notShipped) {
		t.Errorf("embedded files outside the manifest = %q, want %q", extras, notShipped)
	}
}

func TestVersionComesFromTheManifest(t *testing.T) {
	m, err := LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	v, err := Version()
	if err != nil {
		t.Fatal(err)
	}
	if v == "" || v != m.Version {
		t.Errorf("Version() = %q, manifest says %q", v, m.Version)
	}
}

func TestReadTemplateOnlyReadsManifestSources(t *testing.T) {
	m, err := LoadManifest()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ReadTemplate(m.Sources()[0]); err != nil {
		t.Errorf("reading a manifest source: %v", err)
	}
	for _, name := range notShipped {
		if _, err := ReadTemplate(name); err == nil {
			t.Errorf("ReadTemplate(%q) succeeded; only manifest sources may be read", name)
		}
	}
}
