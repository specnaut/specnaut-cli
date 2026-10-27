package stubs

import (
	"os"
	"strings"
)

// The `gh` stub mirrors src/infrastructure/deno_environment_probe.ts, the only
// place the CLI binary itself runs `gh` (`specnaut check`). It parses a
// version out of `gh --version` with /(\d+\.\d+\.\d+(?:-[\w.]+)?)/ and an
// account out of `gh auth status` with /account\s+(\S+)/; this stub answers
// exactly those two calls. Anything else is an invocation the CLI did not make
// when the stub was written, so it fails loudly instead of inventing output.
//
// (src/infrastructure/gh_cli.ts also wraps `gh`, but no command handler
// constructs it: the scaffolded backlog scripts call `gh`, not the binary.)

// ghVersion is a fictional release; only its shape matters to the parser.
const ghVersion = "gh version 2.99.0 (2026-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.99.0\n"

// ghAuthStatus is the stdout shape gh 2.7+ prints for a logged-in account.
const ghAuthStatus = "github.com\n  ✓ Logged in to github.com account acme-bot (keyring)\n" +
	"  - Active account: true\n  - Git operations protocol: https\n"

func answerGh(args []string) answer {
	switch strings.Join(args, " ") {
	case "--version":
		return answer{Stdout: ghVersion}
	case "auth status":
		return answer{Stdout: ghAuthStatus}
	}
	return answer{
		Stderr: "gh (parity stub): unsupported invocation: gh " + strings.Join(args, " ") + "\n",
		Exit:   1,
	}
}

// GhMain is the `gh` command shim, registered with testscript.Main.
func GhMain() { os.Exit(runShim("gh", GhURLVar)) }
