// Command keychain-probe answers, per OS, whether a pure-Go keychain
// (github.com/zalando/go-keyring, cgo off) can stand in for the FFI backends
// of src/infrastructure/keychain/ (cli#662, US5).
//
// It is a measuring tool, never part of the CLI, and it is built so that it
// cannot touch a real credential:
//
//   - it owns the probe service name, and refuses the two the CLI uses
//     (main_test.go holds that list equal to keychain_backend.ts);
//   - the secret is a per-run canary read from stdin, never an argument;
//   - it prints only match/mismatch and a length, never a value;
//   - `roundtrip` removes its item on the way out, whatever happened.
//
// Usage: keychain-probe <service|version|reachable|write|read|remove|roundtrip>
// [--service <name>] [--account <name>]; write/read/roundtrip read the canary
// on stdin. scripts/keychain-probe.ts is the TypeScript counterpart, given the
// service name this binary prints.
package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
)

// ProbeService is the only service the probes write under. The TypeScript
// probe takes it as an argument, so the name has one home.
const ProbeService = "specnaut-keychain-probe"

// refusedServices are KEYCHAIN_SERVICE and LEGACY_KEYCHAIN_SERVICE of
// src/infrastructure/keychain/keychain_backend.ts: the real Cloud credential.
var refusedServices = []string{"specnaut-cloud", "specflow-cloud"}

type options struct {
	mode, service, account string
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr, goKeyring{}))
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer, kr keyring) int {
	o, err := parseOptions(args)
	if err != nil {
		fmt.Fprintln(stderr, "keychain-probe:", err)
		return 2
	}
	switch o.mode {
	case "service":
		fmt.Fprintln(stdout, ProbeService)
		return 0
	case "version":
		fmt.Fprintln(stdout, versionReport())
		return 0
	case "reachable":
		fmt.Fprintf(stdout, "reachable: %v\n", reachable(kr, o.service))
		return 0
	case "remove":
		return report(stdout, "remove", kr.Delete(o.service, o.account))
	}
	canary, err := readCanary(stdin)
	if err != nil {
		fmt.Fprintln(stderr, "keychain-probe:", err)
		return 2
	}
	return withCanary(o, canary, kr, stdout)
}

func parseOptions(args []string) (options, error) {
	o := options{service: ProbeService, account: "probe"}
	if len(args) == 0 {
		return o, errors.New("a mode is required: service|version|reachable|write|read|remove|roundtrip")
	}
	o.mode = args[0]
	for i := 1; i < len(args); i += 2 {
		if i+1 >= len(args) {
			return o, fmt.Errorf("%s needs a value", args[i])
		}
		switch args[i] {
		case "--service":
			o.service = args[i+1]
		case "--account":
			o.account = args[i+1]
		default:
			return o, fmt.Errorf("unknown option %s", args[i])
		}
	}
	return o, refuse(o.service)
}

// refuse rejects the CLI's own service names, whatever their case.
func refuse(service string) error {
	if slices.ContainsFunc(refusedServices, func(r string) bool { return strings.EqualFold(r, service) }) {
		return fmt.Errorf("refusing the real credential service %q; the probe writes only under %q", service, ProbeService)
	}
	if service == "" {
		return errors.New("an empty service name")
	}
	return nil
}

// readCanary takes the secret from stdin, dropping one trailing newline, so
// it never appears in a process argv.
func readCanary(r io.Reader) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	canary := strings.TrimSuffix(strings.TrimSuffix(string(data), "\n"), "\r")
	if len(canary) < 16 {
		return "", errors.New("the canary on stdin is shorter than 16 bytes; pass a random per-run value")
	}
	return canary, nil
}
