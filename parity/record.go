package parity

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"sync"

	"github.com/rogpeppe/go-internal/testscript"

	"github.com/specnaut/specnaut-cli/parity/stubs"
)

// Step is one invocation of the binary inside a scenario.
type Step struct {
	Args   []string
	Stdout string
	Stderr string
	Exit   int
}

// Entry is one node of the tree a scenario leaves under $WORK.
type Entry struct {
	Path    string      // relative to $WORK, slash-separated
	Mode    fs.FileMode // type bits and permissions
	Content string      // file bytes, or a symlink's target; empty for a directory
}

// Record is everything one scenario produced, normalised once through Rules.
type Record struct {
	Scenario string
	Steps    []Step
	Tree     []Entry
	Hits     map[string]int      // stub hits; checked, never diffed
	HitLog   map[string][]string // what each stub was asked
	Err      error               // a failure to capture the tree

	norm Normaliser // Rules, compiled for this scenario and binary
}

// skippedRoots are the top-level $WORK entries left out of the tree. `.tmp` is
// testscript's TMPDIR: whatever lands there has a random name by construction.
var skippedRoots = map[string]bool{".tmp": true}

// Recorder collects the records of one binary's run, keyed by scenario.
type Recorder struct {
	bin            *Binary
	versionsDiffer bool

	mu      sync.Mutex
	records map[string]*Record
	started map[string]bool
}

// NewRecorder records runs of bin. versionsDiffer switches the version rules
// on (see normalise.go).
func NewRecorder(bin *Binary, versionsDiffer bool) *Recorder {
	return &Recorder{bin: bin, versionsDiffer: versionsDiffer, records: map[string]*Record{}, started: map[string]bool{}}
}

// Track wraps a testscript Setup hook so the recorder knows which scenarios
// started. A started scenario with no record never ran the binary — the
// failure a script that drives nothing would otherwise pass with.
func (r *Recorder) Track(setup func(*testscript.Env) error) func(*testscript.Env) error {
	return func(e *testscript.Env) error {
		named, ok := e.T().(interface{ Name() string })
		if !ok {
			return errors.New("parity: testscript.T has no Name; cannot track the scenario")
		}
		r.mu.Lock()
		r.started[path.Base(named.Name())] = true
		r.mu.Unlock()
		return setup(e)
	}
}

// Started reports whether a scenario's script began.
func (r *Recorder) Started(name string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.started[name]
}

// RecordProblems is what is wrong with a started scenario's record: none at
// all (the script never ran the binary, so it asserted nothing), a tree that
// could not be captured, or stub hits that disagree with its `# uses:`.
func RecordProblems(bin *Binary, s Scenario, r *Record) []string {
	switch {
	case r == nil:
		return []string{fmt.Sprintf("%s/%s: the scenario never ran the binary", bin.Label, s.Name)}
	case r.Err != nil:
		return []string{fmt.Sprintf("%s/%s: capturing the tree: %v", bin.Label, s.Name, r.Err)}
	}
	var out []string
	for _, p := range stubs.CheckHits(s.Uses, r.Hits) {
		out = append(out, fmt.Sprintf("%s/%s: %s (stub log: %v)", bin.Label, s.Name, p, r.HitLog))
	}
	return out
}

// Records returns the collected records.
func (r *Recorder) Records() map[string]*Record {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]*Record, len(r.records))
	for k, v := range r.records {
		out[k] = v
	}
	return out
}

// Commands are the script commands that run the binary: `specnaut` and its
// legacy name `specflow`. Without `!` a non-zero exit is recorded, not a
// failure — the record is the assertion. With `!` the step must also fail,
// which is how a scenario states that a request was refused.
func (r *Recorder) Commands() map[string]func(*testscript.TestScript, bool, []string) {
	return map[string]func(*testscript.TestScript, bool, []string){
		"specnaut": func(ts *testscript.TestScript, neg bool, args []string) { r.run(ts, neg, args, false) },
		"specflow": func(ts *testscript.TestScript, neg bool, args []string) { r.run(ts, neg, args, true) },
	}
}

func (r *Recorder) run(ts *testscript.TestScript, neg bool, args []string, legacy bool) {
	scene := SceneOf(ts)
	if err := CredentialGuard(ts.Name(), args, CurrentHost()); err != nil {
		ts.Fatalf("%v", err)
	}
	path := r.bin.Path
	if legacy {
		var err error
		path, err = r.bin.LegacyPath()
		ts.Check(err)
	}
	exit := exitCode(ts, ts.Exec(path, args...))
	if neg && exit == 0 {
		ts.Fatalf("specnaut %v: expected a non-zero exit, got 0", args)
	}
	rec := r.recordFor(ts, scene)
	n := rec.norm
	rec.Steps = append(rec.Steps, Step{
		Args:   append([]string{commandName(legacy)}, args...),
		Stdout: n.Apply(ts.ReadFile("stdout")),
		Stderr: n.Apply(ts.ReadFile("stderr")),
		Exit:   exit,
	})
}

func commandName(legacy bool) string {
	if legacy {
		return "specflow"
	}
	return "specnaut"
}

// exitCode maps an Exec error to the binary's exit status. Anything other
// than a clean exit status — the binary could not start — fails the script.
func exitCode(ts *testscript.TestScript, err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	ts.Fatalf("running the binary: %v", err)
	return -1
}

// recordFor returns the scenario's record, creating it on the first step and
// arranging for the tree and the stub hits to be captured once the script
// ends. A scenario that never runs the binary therefore has no record, and the
// driver reports it.
func (r *Recorder) recordFor(ts *testscript.TestScript, scene *Scene) *Record {
	r.mu.Lock()
	defer r.mu.Unlock()
	name := ts.Name()
	if rec, ok := r.records[name]; ok {
		return rec
	}
	work := ts.Getenv("WORK")
	rec := &Record{Scenario: name, norm: Compile(Context{
		Work:             work,
		Version:          r.bin.Version,
		TemplatesVersion: r.bin.TemplatesVersion,
		VersionsDiffer:   r.versionsDiffer,
	})}
	r.records[name] = rec
	ts.Defer(func() {
		rec.Tree, rec.Err = captureTree(work, rec.norm)
		rec.Hits, rec.HitLog = scene.Stubs.Hits(), scene.Stubs.Log()
	})
	return rec
}

// captureTree walks $WORK — the project, $WORK/home, and anything else the
// binary wrote — and records every node, normalised.
func captureTree(work string, n Normaliser) ([]Entry, error) {
	var tree []Entry
	err := filepath.WalkDir(work, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(work, path)
		if err != nil || rel == "." {
			return err
		}
		rel = filepath.ToSlash(rel)
		if skippedRoots[rel] {
			return filepath.SkipDir
		}
		e, err := entryOf(path, d)
		if err != nil {
			return err
		}
		e.Path = n.Apply(rel)
		e.Content = n.Apply(e.Content)
		tree = append(tree, e)
		return nil
	})
	sort.Slice(tree, func(i, j int) bool { return tree[i].Path < tree[j].Path })
	return tree, err
}

func entryOf(path string, d fs.DirEntry) (Entry, error) {
	info, err := d.Info()
	if err != nil {
		return Entry{}, err
	}
	e := Entry{Mode: info.Mode()}
	switch {
	case d.Type()&fs.ModeSymlink != 0:
		e.Content, err = os.Readlink(path)
	case d.Type().IsRegular():
		var data []byte
		data, err = os.ReadFile(path)
		e.Content = string(data)
	}
	return e, err
}
