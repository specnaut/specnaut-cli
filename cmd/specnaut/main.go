// Command specnaut is the Go port of the specnaut CLI (cli#660), built beside
// the TypeScript binary. Every Go build writes under dist/:
//
//	CGO_ENABLED=0 go build -trimpath -o dist/specnaut-go ./cmd/specnaut
//
// This file is the composition root: it turns the process into a cli.Env and
// hands internal/reconcile its two views of the project. The contained one is
// opened by internal/lockfile, which owns containment.
package main

import (
	"os"
	"syscall"

	"github.com/specnaut/specnaut-cli/internal/cli"
	"github.com/specnaut/specnaut-cli/internal/lockfile"
	"github.com/specnaut/specnaut-cli/internal/reconcile"
)

func main() {
	exe, _ := os.Executable() // "" when unknown: then no legacy warning, as in Deno
	os.Exit(cli.Run(cli.Env{
		Args:      os.Args[1:],
		Stdout:    os.Stdout,
		Stderr:    os.Stderr,
		LookupEnv: os.LookupEnv,
		ExecPath:  exe,
		Project:   openProject,
	}))
}

// openProject is the current directory: plain (links followed anywhere, as
// Deno.readTextFile follows them) and contained (lockfile.OpenContained,
// opened on first use, as resolveProjectRoot runs lazily).
//
// syscall.Getwd, not os.Getwd: os.Getwd answers $PWD when it names the same
// directory, which keeps a link the shell went through, while Deno.cwd() is
// getcwd's answer, every link resolved on Unix. A refusal prints this path.
func openProject() (reconcile.Project, error) {
	cwd, err := syscall.Getwd()
	if err != nil {
		return reconcile.Project{}, err
	}
	return reconcile.Project{
		Dir:       cwd,
		Plain:     os.DirFS(cwd),
		Contained: func() (lockfile.Contained, error) { return lockfile.OpenContained(cwd, home()) },
	}, nil
}

// home is HOME, else USERPROFILE, as fs_containment.ts reads it; "" when
// neither is set.
func home() string {
	if h, ok := os.LookupEnv("HOME"); ok {
		return h
	}
	return os.Getenv("USERPROFILE")
}
