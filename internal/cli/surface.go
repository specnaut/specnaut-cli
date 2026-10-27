// Package cli is the Go binary's presentation layer: the command surface, the
// command-line tokeniser, the parse-time refusals, help, and dispatch.
package cli

// FlagTable is the one global flag table the command line is read against.
// There is no per-command table: `@std/cli parseArgs` reads every flag of
// every command in one pass, so `--here` is accepted (and ignored) after
// `reconcile`, and the Go port keeps that rather than tightening it.
type FlagTable struct {
	Booleans []string
	Strings  []string
	Aliases  map[string]string // short → long
}

// Surface is the flag table of `src/cli/parser.ts`, verbatim and in its order.
var Surface = FlagTable{
	Booleans: []string{
		"version", "help", "here", "no-git", "force", "check", "dry-run", "project",
		"reset-baseline", "reset-preserved", "only-customised", "status",
		"accept-upstream", "accept-current",
	},
	Strings: []string{
		"ai", "backlog", "backlog-url", "backlog-repo", "scheme", "spec-backend",
		"api-url", "type", "title", "payload", "task",
	},
	Aliases: map[string]string{"v": "version", "h": "help"},
}

// Commands is the command table: every command word the TypeScript binary
// dispatches, with the function that reads its arguments and makes its
// parse-time refusals (parse.go). A command dispatch.go does not run answers
// with the not-ported notice. `login` is `cloud login` (#398).
var Commands = map[string]func(Args, []string) Intent{
	"init":        parseInit,
	"self-update": kindOnly("self-update"),
	"check":       kindOnly("check"),
	"upgrade":     parseUpgrade,
	"diff":        parseDiff,
	"reconcile":   parseReconcile,
	"login":       kindOnly("cloud"),
	"cloud":       subcommand("cloud", CloudSubs),
	"gate":        subcommand("gate", GateSubs),
	"spec":        subcommand("spec", SpecSubs),
}

// Subcommand words, as parser.ts accepts them.
var (
	CloudSubs = []string{"login", "token", "logout", "orgs", "board"}
	GateSubs  = []string{"status", "raise", "cancel"}
	SpecSubs  = []string{"push", "pull"}
)
