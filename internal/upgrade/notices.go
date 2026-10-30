// Package upgrade holds the parts of `specnaut upgrade` the Go port carries
// ahead of the command itself: the notices about project files a retired
// mechanism used to read (src/application/upgrade_retired_notices.ts). It is
// application logic, so it sits beside internal/reconcile rather than in
// internal/cli, the presentation layer; dispatch answers `upgrade` with the
// not-ported notice until the command is ported and calls this.
package upgrade

import (
	"fmt"
	"strings"
)

// Reader is the FsReader port the notices read through. How the project is
// walked (containment, links) is the reader's business: the notices only
// decide which of the listed files are the user's and what they say.
type Reader interface {
	// ListFiles is FsReader.listFiles: the files under the folder rel, sorted.
	ListFiles(rel string) ([]string, error)
	// ReadText is FsReader.readText; found is false where TypeScript has null.
	ReadText(rel string) (text string, found bool, err error)
	// Exists is `FsReader.readEntry(rel) !== null`.
	Exists(rel string) (bool, error)
}

// RetiredExtensionsPath is RETIRED_EXTENSIONS_PATH: where the phase docs used
// to look for extension hooks, read by no release since spec 041.
const RetiredExtensionsPath = ".specnaut/extensions.yml"

// addendaRoot is ADDENDA_ROOT of src/domain/addendum_audit.ts.
const addendaRoot = ".specnaut/addenda"

// AgentFolder is one harness's agent folder, AgentFolder in
// src/domain/agent_folders.ts.
type AgentFolder struct {
	Dir    string `json:"dir"`
	Ext    string `json:"ext"`
	Prefix string `json:"prefix"`
}

// AgentFolders are the non-null entries of AGENT_FOLDERS, in its order; the
// golden holds this list to TypeScript's.
var AgentFolders = []AgentFolder{
	{".claude/agents", ".md", ""},
	{".codex/agents", ".toml", ""},
	{".opencode/agents", ".md", "specnaut-"},
	{".agents/agents", ".md", "specnaut-"},
}

// RetiredAgents is RETIRED_AGENTS in its order, which is the order a line
// lists its moves in.
var RetiredAgents = []struct{ Name, Successor string }{
	{"review-coordinator", "the main session runs phases/review.md"},
	{"test-reviewer", "code-reviewer"},
	{"ui-ux-designer", "/design"},
	{"workflow-manager", "the main session / /task"},
	{"qa-tester", "the main session / /task"},
	{"devops-sre", "the main session / /task"},
}

// RetiredConfigNotices is retiredConfigNotices: what upgrade says about project
// files a retired mechanism used to read. tracked is every path the lock
// records — the files that are Specnaut's. Read-only.
func RetiredConfigNotices(r Reader, tracked map[string]bool) ([]string, error) {
	out := []string{}
	ok, err := r.Exists(RetiredExtensionsPath)
	if err != nil {
		return nil, err
	}
	if ok {
		out = append(out, RetiredExtensionsPath+" is no longer read — the /task phases dropped their extension "+
			"hooks. Move each hook into the phase's addendum, .specnaut/addenda/task/<phase>.md")
	}
	agents, err := retiredAgentNotices(r, tracked)
	if err != nil {
		return nil, err
	}
	return append(out, agents...), nil
}

// retiredAgentNotices is one line per user-owned file that names a retired
// agent, then the rule for the seeds those agents leave.
func retiredAgentNotices(r Reader, tracked map[string]bool) ([]string, error) {
	paths, err := userDispatchFiles(r, tracked)
	if err != nil {
		return nil, err
	}
	lines := []string{}
	for _, p := range paths {
		text, found, err := r.ReadText(p)
		if err != nil {
			return nil, err
		}
		if !found {
			continue
		}
		var moves []string
		for _, a := range RetiredAgents {
			if names(text, a.Name) {
				moves = append(moves, a.Name+" → "+a.Successor)
			}
		}
		if len(moves) > 0 {
			lines = append(lines, fmt.Sprintf("%s names a retired agent — %s", p, strings.Join(moves, "; ")))
		}
	}
	if len(lines) == 0 {
		return lines, nil
	}
	return append(lines, "A retired agent's customised memory seeds are kept until `specnaut upgrade --force`, "+
		"which backs them up"), nil
}

// userDispatchFiles is every addendum, then each agent file directly in an
// agent folder that the lock does not record. An agent's memory folder holds
// seeds and their backups, not dispatches.
func userDispatchFiles(r Reader, tracked map[string]bool) ([]string, error) {
	out, err := r.ListFiles(addendaRoot)
	if err != nil {
		return nil, err
	}
	for _, f := range AgentFolders {
		listed, err := r.ListFiles(f.Dir)
		if err != nil {
			return nil, err
		}
		for _, p := range listed {
			rest := strings.TrimPrefix(p, f.Dir+"/")
			if strings.HasSuffix(p, f.Ext) && !strings.Contains(rest, "/") && !tracked[p] {
				out = append(out, p)
			}
		}
	}
	return out, nil
}

// names is the whole-word test `(?<![\w-])name(?![\w-])`: Go's regexp has no
// lookaround, so the neighbours are checked by hand. JavaScript's `\w`
// without the `u` flag is ASCII, so a byte test is the same answer.
func names(text, name string) bool {
	for i := 0; ; {
		j := strings.Index(text[i:], name)
		if j < 0 {
			return false
		}
		start, end := i+j, i+j+len(name)
		if (start == 0 || !wordByte(text[start-1])) && (end == len(text) || !wordByte(text[end])) {
			return true
		}
		i = start + 1
	}
}

func wordByte(b byte) bool {
	return b == '-' || b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}
