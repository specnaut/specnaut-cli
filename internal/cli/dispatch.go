package cli

import (
	"errors"
	"fmt"
	"io"
	"strings"

	specnaut "github.com/specnaut/specnaut-cli"
	"github.com/specnaut/specnaut-cli/internal/lockfile"
	"github.com/specnaut/specnaut-cli/internal/reconcile"
)

// Env is everything a run reads from outside: the composition root
// (cmd/specnaut) builds it from the process, tests build it in memory.
type Env struct {
	Args           []string
	Stdout, Stderr io.Writer
	LookupEnv      func(string) (string, bool)
	ExecPath       string
	// Project opens the current directory as reconcile reads it.
	Project func() (reconcile.Project, error)
}

// legacyWarning is LEGACY_INVOCATION_WARNING of src/domain/deprecation.ts.
const legacyWarning = "warning: the 'specflow' command is deprecated — use 'specnaut' instead. " +
	"Run 'specnaut self-update' (or reinstall) to get the renamed binary; " +
	"the 'specflow' alias will be removed in a future major release."

// Run is src/main.ts: the legacy-name warning, then the parsed intent, with
// a removed harness reported once for every command that loads the lock.
// It returns the exit code.
func Run(env Env) int {
	p := PaletteFor(env.LookupEnv)
	if isLegacyInvocation(env.ExecPath) {
		fmt.Fprintln(env.Stderr, p.Yellow(legacyWarning))
	}
	code, err := dispatch(env, p)
	var removed *lockfile.RemovedHarnessError
	switch {
	case errors.As(err, &removed):
		fmt.Fprintln(env.Stderr, p.Red("error: "+removed.Error()))
		return 1
	case err != nil:
		return uncaught(env.Stderr, p, err)
	}
	return code
}

func isLegacyInvocation(execPath string) bool {
	base := execPath[strings.LastIndexAny(execPath, `/\`)+1:]
	return base == "specflow" || base == "specflow.exe"
}

func dispatch(env Env, p Palette) (int, error) {
	in, err := Parse(env.Args)
	if err != nil {
		return 0, err
	}
	if text, code, refused := Refusal(in, p); refused {
		fmt.Fprintln(env.Stderr, text)
		return code, nil
	}
	switch in.Kind {
	case "version":
		v, err := specnaut.Version()
		if err != nil {
			return 0, err
		}
		fmt.Fprintln(env.Stdout, VersionLine(p, v, v))
		return 0, nil
	case "help":
		fmt.Fprintln(env.Stdout, Help(p))
		return 0, nil
	case "reconcile-status":
		return reconcileStatus(env)
	}
	return NotPorted(env.Stderr, p, in.Command), nil
}

// reconcileStatus is reconcile_handler.ts's `--status` branch.
func reconcileStatus(env Env) (int, error) {
	project, err := env.Project()
	if err != nil {
		return 0, err
	}
	pending, err := reconcile.Status(project)
	if err != nil {
		return 0, err
	}
	fmt.Fprintln(env.Stdout, reconcile.RenderStatus(pending))
	return 0, nil
}

// uncaught stands in for the trace Deno prints when TypeScript throws past
// main.ts: same stream, same exit code, same first word, and the class
// TypeScript would have thrown (an error naming one, such as a lock's
// SyntaxError, else Error). The trace itself is not portable, which is why the
// harness compares those scenarios only between TypeScript binaries
// (parity/excluded.go).
func uncaught(w io.Writer, p Palette, err error) int {
	word := "error"
	if p.Enabled {
		word = "\x1b[0m\x1b[1m\x1b[31merror\x1b[0m"
	}
	fmt.Fprintf(w, "%s: Uncaught (in promise) %s: %v\n", word, className(err), err)
	return 1
}

// className is the JavaScript class an error stands for.
func className(err error) string {
	var named interface{ Name() string }
	if errors.As(err, &named) {
		return named.Name()
	}
	return "Error"
}
