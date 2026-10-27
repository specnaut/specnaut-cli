package cli

import (
	"slices"
	"strings"

	"github.com/specnaut/specnaut-cli/internal/js"
	"github.com/specnaut/specnaut-cli/internal/lockfile"
)

// Intent is what the command line asks for, as `src/cli/parser.ts` names it.
// Kind is parser.ts's `kind`; only the fields a ported command or a refusal
// reads are carried — an unported command needs nothing but its name.
type Intent struct {
	Kind     string
	Received string // kind "unknown": what parser.ts echoes back
	Harness  string // kind "removed-harness"
	Command  string // the command word, for the not-ported notice
}

func unknown(received string) Intent { return Intent{Kind: "unknown", Received: received} }

// The exit codes of a refused command line, as main.ts returns them: 2 for a
// call the CLI does not understand, 1 for a harness it no longer installs.
const (
	ExitUsage          = 2
	ExitRemovedHarness = 1
)

// Refusal is what a refused command line answers — the text for stderr and
// the exit code — or ok false when in is not a refusal. It lives beside Parse
// so the refusal and its answer have one home; dispatch only forwards it.
// The two lines main.ts writes for `unknown` (the message, then HELP) are one
// text here, joined by the newline console.error would put between them.
func Refusal(in Intent, p Palette) (text string, code int, ok bool) {
	switch in.Kind {
	case "unknown":
		return p.Red(`Unknown command: "`+in.Received+`"`) + "\n" + Help(p), ExitUsage, true
	case "removed-harness":
		return p.Red("error: " + lockfile.RemovedHarnessInitNotice(in.Harness)), ExitRemovedHarness, true
	}
	return "", 0, false
}

// Parse is parser.ts's parseArgs, every parse-time refusal included, in its
// order: version and help win over any command; an unrecognised value is
// `unknown` (exit 2 with help), a removed harness is its own kind (exit 1).
// Nothing else in the Go binary refuses a malformed command line.
func Parse(argv []string) (Intent, error) {
	if len(argv) == 0 {
		return Intent{Kind: "help"}, nil
	}
	args, err := Tokenise(argv, Surface)
	if err != nil {
		return Intent{}, err
	}
	if truthy(args, "version") {
		return Intent{Kind: "version"}, nil
	}
	if truthy(args, "help") {
		return Intent{Kind: "help"}, nil
	}
	words := args.Words()
	command, rest := "", []string{}
	if len(words) > 0 {
		command, rest = words[0], words[1:]
	}
	if parse, ok := Commands[command]; ok {
		in := parse(args, rest)
		in.Command = command
		return in, nil
	}
	return unknown(command), nil
}

func truthy(a Args, key string) bool {
	v, ok := a.Flag(key)
	return ok && v.Truthy()
}

// initValues are init's validated string flags, in parser.ts's order.
var initValues = []struct {
	flag  string
	known []string
}{
	{"backlog", lockfile.KnownBacklogBackend},
	{"scheme", lockfile.KnownVersionSchemes},
	{"spec-backend", lockfile.KnownSpecBackends},
}

func kindOnly(kind string) func(Args, []string) Intent {
	return func(Args, []string) Intent { return Intent{Kind: kind} }
}

func parseInit(a Args, _ []string) Intent {
	if ai, ok := a.StringFlag("ai"); ok {
		if lockfile.IsRemovedHarness(ai) {
			return Intent{Kind: "removed-harness", Harness: ai}
		}
		if !slices.Contains(lockfile.KnownHarnesses, ai) {
			return unknown("init --ai " + ai)
		}
	}
	for _, v := range initValues {
		if s, ok := a.StringFlag(v.flag); ok && !slices.Contains(v.known, s) {
			return unknown("init --" + v.flag + " " + s)
		}
	}
	return Intent{Kind: "init"}
}

func parseUpgrade(a Args, _ []string) Intent {
	if s, ok := a.StringFlag("backlog"); ok && !slices.Contains(lockfile.KnownBacklogBackend, s) {
		return unknown("upgrade --backlog " + s)
	}
	return Intent{Kind: "upgrade"}
}

// parseDiff: one path at a time — several, diffing only the first, was the
// silent-success shape the positional had when it was dropped entirely.
func parseDiff(_ Args, rest []string) Intent {
	if len(rest) > 1 {
		return unknown("diff takes at most one path")
	}
	return Intent{Kind: "diff"}
}

func parseReconcile(a Args, rest []string) Intent {
	upstream, current := truthy(a, "accept-upstream"), truthy(a, "accept-current")
	if truthy(a, "status") {
		if upstream || current || len(rest) > 0 {
			return unknown("reconcile --status takes no other arguments")
		}
		return Intent{Kind: "reconcile-status"}
	}
	switch {
	case upstream && current:
		return unknown("reconcile --accept-upstream and --accept-current are mutually exclusive")
	case !upstream && !current:
		return unknown("specnaut reconcile requires --status, or <path> with --accept-upstream / --accept-current")
	case len(rest) != 1:
		return unknown("specnaut reconcile <path> requires exactly one path")
	}
	return Intent{Kind: "reconcile-path"}
}

// subcommand refuses a missing or unknown subcommand word, echoing it as
// parser.ts does: `cloud bogus`, or `cloud` alone.
func subcommand(command string, subs []string) func(Args, []string) Intent {
	return func(_ Args, rest []string) Intent {
		sub := ""
		if len(rest) > 0 {
			sub = rest[0]
		}
		if !slices.Contains(subs, sub) {
			return unknown(strings.Trim(command+" "+sub, js.Space))
		}
		return Intent{Kind: command}
	}
}
