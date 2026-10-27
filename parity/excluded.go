package parity

import (
	"fmt"
	"runtime"
	"slices"
)

// Exclusion is a scenario the harness does not run, and why.
type Exclusion struct {
	Scenario string
	Reason   string
}

// Host is what decides the host-dependent exclusions.
type Host struct {
	GOOS string
	// KeyringReachable: the CLI would reach an OS credential store from a
	// scenario. On macOS the login keychain is per user, not per $HOME, so it
	// is always reachable and the harness must never touch it. On Linux it is
	// reached through the session bus, which env.go removes, so the CLI falls
	// back to the file store under $WORK/home.
	KeyringReachable bool
}

// CurrentHost describes the host the harness runs on.
func CurrentHost() Host { return HostFor(runtime.GOOS) }

// HostFor describes a host by operating system.
func HostFor(goos string) Host {
	return Host{GOOS: goos, KeyringReachable: goos != "linux"}
}

// Pair is what decides the pair-dependent exclusions.
type Pair struct {
	// CrossImpl: the two binaries are different implementations (Go against
	// anything else), so output only one runtime can produce is not compared.
	CrossImpl bool
}

// Unrunnable are scenarios with no script, because nothing can stand in for
// what they need. They are reported as SKIP on every run, so their absence is
// visible rather than silent.
var Unrunnable = []Exclusion{
	{"init-pickers", "the interactive harness/backlog/scheme/spec pickers need a TTY and testscript has no PTY; scripts/smoke/smoke-picker.sh covers them"},
	{"cloud-login-device-flow", "the device flow needs an interactive terminal and a browser; only its non-TTY refusal is a scenario (cloud-headless)"},
	{"self-update-success", "self-update calls api.github.com with no override, and adding one to a signature-verified update path would be a behaviour change; net-deny runs it only to prove the request is refused"},
	{"cloud-token-stored", "reading a stored token needs SPECNAUT_CLOUD_TOKEN unset, and env.go sets it for every scenario so no scenario can reach a real credential"},
}

// credentialScenarios open the OS credential store (cloud_handler.ts,
// gate_handler.ts and spec_handler.ts all call defaultCredentialStore()).
// They run only where no keyring is reachable.
var credentialScenarios = map[string]string{
	"cloud-session": "cloud orgs/board/logout open the credential store",
	"gate":          "gate status/raise/cancel open the credential store, even with SPECNAUT_CLOUD_TOKEN set",
	"spec":          "spec pull/push open the credential store, even with SPECNAUT_CLOUD_TOKEN set",
}

// uncaughtTrace scenarios end in a Deno uncaught-exception trace, which no
// other runtime prints byte for byte. Compared TypeScript against TypeScript
// (HEAD against a release), never across implementations.
var uncaughtTrace = map[string]string{
	"reconcile-malformed-lock": "a malformed installed.lock ends `reconcile --status` in an uncaught Deno trace",
}

// PortedToGo are the scenarios whose every step the Go binary implements;
// every other step answers "not ported" (exit 3) by design. A pair across
// implementations compares these and reports the rest as SKIP, so a full
// Go-against-TypeScript run is green exactly when the port matches. CI runs
// that pair with no -run filter, so nothing else lists these names.
var PortedToGo = []string{"help", "legacy", "parser", "reconcile-status", "version"}

// unsupportedHosts are operating systems the harness does not run on, and why.
var unsupportedHosts = map[string]string{
	"windows": "the parity harness runs on macOS and Linux hosts only (its fixtures, file modes and " +
		"stub shims are POSIX); Windows gets the Go build and the keychain probe instead",
}

// HostExcluded says whether the whole harness is excluded on this host, and
// why. Every parity test asks it first and reports the answer as SKIP.
func HostExcluded(h Host) (string, bool) {
	why, ok := unsupportedHosts[h.GOOS]
	return why, ok
}

// Excluded says whether a scenario is excluded on this host for this pair,
// and why.
func Excluded(scenario string, h Host, p Pair) (string, bool) {
	if why, ok := credentialScenarios[scenario]; ok && h.KeyringReachable {
		return fmt.Sprintf("%s, and a keyring is reachable on %s: the harness never touches a developer's keychain", why, h.GOOS), true
	}
	if why, ok := uncaughtTrace[scenario]; ok && p.CrossImpl {
		return why + "; not portable across implementations", true
	}
	if p.CrossImpl && !slices.Contains(PortedToGo, scenario) {
		return "not ported to the Go binary yet (PortedToGo): its steps answer exit 3 by design", true
	}
	return "", false
}

// credentialWords are the commands whose handlers open the credential store.
var credentialWords = []string{"cloud", "login", "gate", "spec"}

// credentialFree are scenarios that use a credential word but provably never
// open the store, and why.
var credentialFree = map[string]string{
	"parser":         "every step is a parse-time refusal: parser.ts returns `unknown` before any handler runs",
	"cloud-headless": "`cloud token` prints SPECNAUT_CLOUD_TOKEN before resolving a store, and `login` refuses a non-TTY first (cloud_handler.ts runToken, runLogin)",
}

// valueFlags are the flags that consume the next word and accept `cloud` as a
// value. After one of them, `cloud` is a value, never a command.
var valueFlags = []string{"--backlog", "--spec-backend"}

// CredentialGuard refuses, on a host with a reachable keyring, an invocation
// that might open the credential store from a scenario nobody classified. It
// is the backstop behind credentialScenarios: an over-approximation that
// treats every credential word as a possible command, so a misfire stops a
// scenario rather than letting one reach the keychain.
func CredentialGuard(scenario string, args []string, h Host) error {
	if !h.KeyringReachable {
		return nil
	}
	if _, ok := credentialFree[scenario]; ok {
		return nil
	}
	for i, a := range args {
		if !slices.Contains(credentialWords, a) {
			continue
		}
		if i > 0 && slices.Contains(valueFlags, args[i-1]) {
			continue
		}
		return fmt.Errorf("scenario %q runs %v, which may open the OS credential store on %s; "+
			"classify it in excluded.go (credentialScenarios or credentialFree)", scenario, args, h.GOOS)
	}
	return nil
}
