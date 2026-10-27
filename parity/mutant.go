package parity

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// MutantName is the command testscript.Main installs on PATH for the mutant.
// It is the test binary itself, re-entered under this name, so a mutant needs
// no separate build.
const MutantName = "specnaut-mutant"

// The mutant's settings, passed through the scenario environment.
const (
	mutantBinVar  = "PARITY_MUTANT_BIN"
	mutantKindVar = "PARITY_MUTANT_KIND"
	mutantPathVar = "PARITY_MUTANT_PATH"
)

// MutationKind is one way the mutant departs from the real binary.
type MutationKind string

// The four mutations FR-008 requires the harness to catch.
const (
	MutateStdoutLine  MutationKind = "stdout-line"  // rewrite the first stdout line
	MutateExitCode    MutationKind = "exit-code"    // exit one higher
	MutateMissingFile MutationKind = "missing-file" // delete a file the run left
	MutateAlteredFile MutationKind = "altered-file" // append a line to a file the run left
)

// NewMutant is a Binary that runs real and then applies kind. path is the
// file the two file mutations act on, relative to the step's directory.
func NewMutant(real *Binary, kind MutationKind, path string) (*Binary, error) {
	exe, err := exec.LookPath(MutantName)
	if err != nil {
		return nil, fmt.Errorf("mutant not on PATH — is TestMain calling testscript.Main? %w", err)
	}
	return &Binary{
		Label:            "mutant:" + string(kind),
		Path:             exe,
		Impl:             real.Impl, // a wrapper, not a second implementation
		VersionLine:      real.VersionLine,
		Version:          real.Version,
		TemplatesVersion: real.TemplatesVersion,
		Env: []string{
			mutantBinVar + "=" + real.Path,
			mutantKindVar + "=" + string(kind),
			mutantPathVar + "=" + path,
		},
	}, nil
}

// MutantMain runs the real binary with the same arguments, stdin and
// environment, then mutates what it produced.
func MutantMain() {
	cmd := exec.Command(os.Getenv(mutantBinVar), os.Args[1:]...)
	var stdout, stderr bytes.Buffer
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, &stdout, &stderr
	code := 0
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			fmt.Fprintf(os.Stderr, "%s: %v\n", MutantName, err)
			os.Exit(127)
		}
		code = exitErr.ExitCode()
	}
	out, code, err := mutate(MutationKind(os.Getenv(mutantKindVar)), os.Getenv(mutantPathVar), stdout.String(), code)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", MutantName, err)
		os.Exit(127)
	}
	writeOut(os.Stdout, out)
	writeOut(os.Stderr, stderr.String())
	os.Exit(code)
}

// mutate applies one mutation to a finished run.
func mutate(kind MutationKind, path, stdout string, code int) (string, int, error) {
	switch kind {
	case MutateStdoutLine:
		first, rest, _ := strings.Cut(stdout, "\n")
		return first + " [mutant]\n" + rest, code, nil
	case MutateExitCode:
		return stdout, code + 1, nil
	case MutateMissingFile:
		return stdout, code, os.Remove(path)
	case MutateAlteredFile:
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			return stdout, code, err
		}
		_, err = f.WriteString("# mutant\n")
		return stdout, code, errors.Join(err, f.Close())
	}
	return stdout, code, fmt.Errorf("unknown mutation %q", kind)
}

func writeOut(f *os.File, s string) {
	if _, err := f.WriteString(s); err != nil {
		fmt.Fprintf(os.Stderr, "%s: write: %v\n", MutantName, err)
	}
}
