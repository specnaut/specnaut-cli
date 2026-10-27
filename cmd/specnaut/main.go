// Command specnaut is the Go port of the specnaut CLI (cli#660), built beside
// the TypeScript binary. Every Go build writes under dist/:
//
//	CGO_ENABLED=0 go build -trimpath -o dist/specnaut-go ./cmd/specnaut
//
// This file is the composition root: it turns the process into a cli.Env and
// owns the only direct filesystem access — the two views of the project that
// internal/reconcile reads.
package main

import (
	"io/fs"
	"os"
	"path/filepath"

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
// Deno.readTextFile follows them) and contained (an os.Root, opened on first
// use after RefuseRoot vets the resolved directory).
func openProject() (reconcile.Project, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return reconcile.Project{}, err
	}
	return reconcile.Project{
		Plain:     os.DirFS(cwd),
		Contained: func() (fs.FS, error) { return openContained(cwd) },
	}, nil
}

func openContained(dir string) (fs.FS, error) {
	root, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, err
	}
	if err := lockfile.RefuseRoot(root, resolvedHome()); err != nil {
		return nil, err
	}
	r, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	return r.FS(), nil
}

// resolvedHome is fs_containment.ts's home: HOME, else USERPROFILE, resolved
// through links when it can be, as given when it cannot; "" when unset.
func resolvedHome() string {
	home, ok := os.LookupEnv("HOME")
	if !ok {
		home = os.Getenv("USERPROFILE")
	}
	if home == "" {
		return ""
	}
	abs, err := filepath.Abs(home)
	if err != nil {
		return home
	}
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		return real
	}
	return home
}
