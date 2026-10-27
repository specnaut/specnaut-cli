package stubs

import (
	"os"
	"strings"
)

// The `glab` stub mirrors nothing, because the CLI binary never runs `glab`:
// src/domain/backlog_strategies/gitlab.ts only names it in prerequisite text,
// and the scaffolded backlog scripts that do call it are not run by the
// binary. The stub exists so that no scenario can ever reach a real `glab` and
// a real GitLab account, and so that the day the binary starts calling it, the
// hit count says so: every invocation fails and is counted.

func answerGlab(args []string) answer {
	return answer{
		Stderr: "glab (parity stub): the CLI binary is not expected to run glab: glab " +
			strings.Join(args, " ") + "\n",
		Exit: 1,
	}
}

// GlabMain is the `glab` command shim, registered with testscript.Main.
func GlabMain() { os.Exit(runShim("glab", GlabURLVar)) }
