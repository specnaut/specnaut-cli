package upgrade

import (
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/specnaut/specnaut-cli/internal/golden"
)

// The goldens are internal/testdata/golden.ts's output: retiredConfigNotices
// run on the same in-memory projects, and AGENT_FOLDERS itself.

type noticeCase struct {
	Name    string            `json:"name"`
	Files   map[string]string `json:"files"`
	Tracked []string          `json:"tracked"`
	Lines   []string          `json:"lines"`
}

// memory is golden.ts's memoryReader: the files as given, listed by prefix.
type memory map[string]string

func (m memory) ListFiles(rel string) ([]string, error) {
	out := []string{}
	for p := range m {
		if strings.HasPrefix(p, rel+"/") {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out, nil
}

func (m memory) ReadText(rel string) (string, bool, error) {
	t, ok := m[rel]
	return t, ok, nil
}

func (m memory) Exists(rel string) (bool, error) {
	_, ok := m[rel]
	return ok, nil
}

func TestRetiredConfigNoticesMatchesTypeScript(t *testing.T) {
	for _, c := range golden.Load[noticeCase](t, "testdata/notices_golden.jsonl", 7) {
		tracked := map[string]bool{}
		for _, p := range c.Tracked {
			tracked[p] = true
		}
		got, err := RetiredConfigNotices(memory(c.Files), tracked)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		if !slices.Equal(got, c.Lines) {
			t.Errorf("%s:\n got %q\nwant %q", c.Name, got, c.Lines)
		}
	}
}

func TestAgentFoldersMatchTypeScript(t *testing.T) {
	want := golden.Load[AgentFolder](t, "testdata/agent_folders_golden.jsonl", 4)
	if !slices.Equal(AgentFolders, want) {
		t.Errorf("AgentFolders = %v; AGENT_FOLDERS = %v", AgentFolders, want)
	}
}
