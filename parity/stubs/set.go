// Package stubs holds the loopback test doubles every parity scenario runs
// against: the `gh` and `glab` command shims, the Specnaut Cloud HTTP API, and
// the deny proxy that stands in for every other host.
//
// Each stub answers only what the CLI's own code parses, names the TypeScript
// file it mirrors, binds 127.0.0.1 through httptest, and counts its hits. A hit
// count is what turns "the scenario used the stub" from an assumption into an
// observation: a scenario that declares a service and never reaches it fails,
// and so does one that reaches a service it did not declare.
package stubs

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"sync"
)

// Service names, as a scenario declares them in its `# uses:` header.
const (
	GH    = "gh"
	Glab  = "glab"
	Cloud = "cloud"
	Deny  = "deny"
)

// Services is every stub a scenario may declare.
var Services = []string{GH, Glab, Cloud, Deny}

// counter is a hit counter shared by a stub's handlers.
type counter struct {
	mu   sync.Mutex
	hits int
	log  []string
}

func (c *counter) hit(what string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.hits++
	c.log = append(c.log, what)
}

func (c *counter) snapshot() (int, []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.hits, slices.Clone(c.log)
}

// stub is one running service: its loopback server and its counter.
type stub struct {
	srv *httptest.Server
	cnt *counter
}

// Set is the stubs of one scenario. Each scenario gets its own, so hit counts
// never bleed between scenarios that run in parallel.
type Set struct {
	stubs map[string]*stub
}

// Start launches every stub for one scenario. canary is the only bearer token
// the Cloud stub accepts.
func Start(canary string) *Set {
	s := &Set{stubs: map[string]*stub{}}
	s.add(GH, func(c *counter) http.Handler { return shimServer(c, answerGh) })
	s.add(Glab, func(c *counter) http.Handler { return shimServer(c, answerGlab) })
	s.add(Cloud, func(c *counter) http.Handler { return cloudHandler(c, canary) })
	s.add(Deny, denyHandler)
	return s
}

func (s *Set) add(name string, h func(*counter) http.Handler) {
	c := &counter{}
	// httptest.NewServer listens on 127.0.0.1:0 — loopback only, never every
	// interface.
	s.stubs[name] = &stub{srv: httptest.NewServer(h(c)), cnt: c}
}

// URL is the loopback base URL of a stub.
func (s *Set) URL(name string) string { return s.stubs[name].srv.URL }

// Hits is each stub's hit count.
func (s *Set) Hits() map[string]int {
	out := map[string]int{}
	for name, st := range s.stubs {
		out[name], _ = st.cnt.snapshot()
	}
	return out
}

// Log is what each stub was asked, in arrival order — the evidence a failing
// hit check prints.
func (s *Set) Log() map[string][]string {
	out := map[string][]string{}
	for name, st := range s.stubs {
		_, out[name] = st.cnt.snapshot()
	}
	return out
}

// Close stops every stub.
func (s *Set) Close() {
	for _, st := range s.stubs {
		st.srv.Close()
	}
}

// CheckHits compares the services a scenario declared with the ones it
// reached. Both directions fail: a declared service with zero hits means the
// scenario never exercised what it claims to, and an undeclared one with hits
// means the binary reached for something nobody expected — for `deny`, a host
// that is not stubbed at all.
func CheckHits(declared []string, hits map[string]int) []string {
	var problems []string
	for _, name := range sortedKeys(hits) {
		used := slices.Contains(declared, name)
		switch {
		case used && hits[name] == 0:
			problems = append(problems, fmt.Sprintf("declares `uses: %s` but the stub saw 0 hits", name))
		case !used && hits[name] > 0:
			problems = append(problems, fmt.Sprintf("reached %s %d time(s) without declaring `uses: %s`", name, hits[name], name))
		}
	}
	for _, name := range declared {
		if _, known := hits[name]; !known {
			problems = append(problems, fmt.Sprintf("declares unknown service %q", name))
		}
	}
	return problems
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
