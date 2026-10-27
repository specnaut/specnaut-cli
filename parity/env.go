package parity

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/rogpeppe/go-internal/testscript"

	"github.com/specnaut/specnaut-cli/parity/stubs"
)

// Scene is what a running scenario knows about itself.
type Scene struct {
	Bin   *Binary
	Stubs *stubs.Set
}

type sceneKey struct{}

// SceneOf returns the running scenario's Scene.
func SceneOf(ts *testscript.TestScript) *Scene {
	return ts.Value(sceneKey{}).(*Scene)
}

// systemPath is everything on PATH after the stubs. Fixed, not inherited: the
// developer's PATH would decide which `gh`, `glab` or `deno` the binary finds,
// and so what `specnaut check` prints. `git` must be reachable here.
const systemPath = "/usr/bin:/bin:/usr/sbin:/sbin"

// Canary is the per-process fake SPECNAUT_CLOUD_TOKEN. Random, so it can be
// recognised wherever it surfaces and can never be a working credential; one
// per process, so both binaries of a diff see the same value.
var Canary = sync.OnceValue(func() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("parity: canary: %v", err))
	}
	return "parity-canary-" + hex.EncodeToString(b)
})

// Setup is the testscript hook that builds the one environment every scenario
// runs in. testscript starts from an empty environment (it inherits only
// PATH), so every variable below is deliberate, and anything absent — a
// session bus, a display, a token — is absent on purpose.
//
//   - Network: every proxy variable points at the deny stub, with loopback
//     exempt, so the only hosts reachable are the stubs.
//   - Cloud: $CLOUD_URL is the Cloud stub, owned here; scenarios pass it as
//     --api-url. A scenario that forgets reaches the default host, which the
//     proxy denies — it fails toward safety.
//   - Credentials: SPECNAUT_CLOUD_TOKEN is the canary. No session bus and a
//     runtime dir that does not exist keep libsecret from finding a keyring,
//     so on Linux the CLI falls back to the file store under $WORK/home.
//   - git: no system or global config but one under $WORK, no prompts, and
//     only the file:// transport — a remote URL naming a real forge can be
//     read by `git remote get-url` but never contacted.
func Setup(bin *Binary) func(*testscript.Env) error {
	return func(e *testscript.Env) error {
		set := stubs.Start(Canary())
		e.Defer(set.Close)
		stubDir, err := stubDirectory()
		if err != nil {
			return err
		}
		home := filepath.Join(e.WorkDir, "home")
		if err := writeHome(home); err != nil {
			return err
		}
		e.Vars = append(scenarioVars(e.WorkDir, home, stubDir, set), bin.Env...)
		e.Values[sceneKey{}] = &Scene{Bin: bin, Stubs: set}
		return nil
	}
}

func scenarioVars(work, home, stubDir string, set *stubs.Set) []string {
	deny := set.URL(stubs.Deny)
	vars := []string{
		"WORK=" + work, // first: testscript abbreviates logs by it
		"PATH=" + stubDir + string(os.PathListSeparator) + systemPath,
		"HOME=" + home,
		"TMPDIR=" + filepath.Join(work, ".tmp"),
		"TZ=UTC", "LANG=C", "LC_ALL=C",
		// Colour stays on: the CLI writes ANSI codes whenever NO_COLOR is
		// unset, piped or not, and the harness compares those bytes.
		"TERM=dumb",
		"NO_PROXY=127.0.0.1,localhost", "no_proxy=127.0.0.1,localhost",
		"SPECNAUT_CLOUD_TOKEN=" + Canary(),
		"CLOUD_URL=" + set.URL(stubs.Cloud),
		stubs.GhURLVar + "=" + set.URL(stubs.GH),
		stubs.GlabURLVar + "=" + set.URL(stubs.Glab),
		"GH_CONFIG_DIR=" + filepath.Join(home, ".config", "gh"),
		"GLAB_CONFIG_DIR=" + filepath.Join(home, ".config", "glab"),
		"XDG_CONFIG_HOME=" + filepath.Join(home, ".config"),
		"XDG_RUNTIME_DIR=" + filepath.Join(work, ".tmp", "no-session-bus"),
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_CONFIG_GLOBAL=" + filepath.Join(home, ".gitconfig"),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_ALLOW_PROTOCOL=file",
		"GIT_AUTHOR_DATE=2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE=2026-01-01T00:00:00Z",
		// Kept for testscript's own builtins.
		"devnull=" + os.DevNull, "/=" + string(os.PathSeparator), ":=" + string(os.PathListSeparator), "$=$", "exe=",
	}
	for _, name := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"} {
		vars = append(vars, name+"="+deny, strings.ToLower(name)+"="+deny)
	}
	return vars
}

// gitconfig is the only git configuration a scenario sees.
const gitconfig = `[user]
	name = Acme Bot
	email = bot@example.com
[init]
	defaultBranch = main
`

func writeHome(home string) error {
	if err := os.MkdirAll(home, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(home, ".gitconfig"), []byte(gitconfig), 0o644)
}

// stubDirectory is the directory testscript.Main filled with the command
// shims (gh, glab, the mutant). It is first on the scenario PATH.
func stubDirectory() (string, error) {
	gh, err := exec.LookPath("gh")
	if err != nil {
		return "", fmt.Errorf("parity: gh shim not found — is TestMain calling testscript.Main? %w", err)
	}
	dir := filepath.Dir(gh)
	if _, err := os.Stat(filepath.Join(dir, "glab")); err != nil {
		return "", fmt.Errorf("parity: %s holds a gh that is not the shim (no glab beside it)", dir)
	}
	return dir, nil
}

// Commands are the script commands env.go owns: fixtures that depend on the
// scenario environment rather than on the script.
func Commands() map[string]func(*testscript.TestScript, bool, []string) {
	return map[string]func(*testscript.TestScript, bool, []string){
		"cloud-session": seedCloudSession,
	}
}

// seedCloudSession writes a live Cloud session for the Cloud stub into the
// file credential store under $WORK/home — the state `specnaut login` leaves
// behind on a host with no keyring. Its key is the stub URL, which a static
// fixture cannot know.
func seedCloudSession(ts *testscript.TestScript, neg bool, args []string) {
	if neg || len(args) != 0 {
		ts.Fatalf("usage: cloud-session")
	}
	body, err := stubs.CredentialsFile(ts.Getenv("CLOUD_URL"), Canary())
	ts.Check(err)
	dir := filepath.Join(ts.Getenv("HOME"), ".specnaut")
	ts.Check(os.MkdirAll(dir, 0o700))
	ts.Check(os.WriteFile(filepath.Join(dir, "credentials.json"), body, 0o600))
}
