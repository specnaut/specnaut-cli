package stubs

import (
	"net/http"
	"slices"
	"testing"
)

func TestCheckHitsFailsBothWays(t *testing.T) {
	hits := map[string]int{GH: 2, Glab: 0, Cloud: 0, Deny: 1}
	got := CheckHits([]string{GH, Cloud}, hits)
	want := []string{
		"declares `uses: cloud` but the stub saw 0 hits",
		"reached deny 1 time(s) without declaring `uses: deny`",
	}
	if !slices.Equal(got, want) {
		t.Errorf("got %q\nwant %q", got, want)
	}
	if p := CheckHits([]string{GH, Deny}, hits); len(p) != 0 {
		t.Errorf("an exact declaration must pass, got %q", p)
	}
	if p := CheckHits([]string{"gitea"}, hits); len(p) == 0 {
		t.Error("an unknown service must be reported")
	}
}

func TestCloudStubRefusesAnyTokenButTheCanary(t *testing.T) {
	s := Start("canary-123")
	defer s.Close()
	for token, want := range map[string]int{"canary-123": 200, "a-real-token": 401, "": 401} {
		req, _ := http.NewRequest("GET", s.URL(Cloud)+"/api/v1/orgs", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("token %q: status %d, want %d", token, resp.StatusCode, want)
		}
	}
	if s.Hits()[Cloud] != 3 {
		t.Errorf("hits %v, want 3 on cloud", s.Hits())
	}
}

func TestGhStubAnswersOnlyWhatTheProbeParses(t *testing.T) {
	if a := answerGh([]string{"--version"}); a.Exit != 0 || a.Stdout == "" {
		t.Errorf("--version: %+v", a)
	}
	if a := answerGh([]string{"auth", "status"}); a.Exit != 0 {
		t.Errorf("auth status: %+v", a)
	}
	if a := answerGh([]string{"issue", "list"}); a.Exit == 0 {
		t.Errorf("an unsupported call must fail, got %+v", a)
	}
	if a := answerGlab([]string{"--version"}); a.Exit == 0 {
		t.Errorf("glab must refuse every call, got %+v", a)
	}
}

func TestDenyProxyCountsAndRefuses(t *testing.T) {
	s := Start("c")
	defer s.Close()
	resp, err := http.Get(s.URL(Deny) + "/anything")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || s.Hits()[Deny] != 1 {
		t.Errorf("status %d, hits %v", resp.StatusCode, s.Hits())
	}
}
