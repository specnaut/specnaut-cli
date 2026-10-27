package main

import (
	"bytes"
	"errors"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	gokeyring "github.com/zalando/go-keyring"
)

// The refusal list is the TypeScript constants, read from their file: a
// renamed service in keychain_backend.ts must fail here, not leave the probe
// able to touch the new real name.
func TestRefusedServicesAreTheCLIConstants(t *testing.T) {
	src, err := os.ReadFile("../../src/infrastructure/keychain/keychain_backend.ts")
	if err != nil {
		t.Fatal(err)
	}
	var ts []string
	for _, name := range []string{"KEYCHAIN_SERVICE", "LEGACY_KEYCHAIN_SERVICE"} {
		m := regexp.MustCompile(`export const ` + name + ` = "([^"]+)";`).FindSubmatch(src)
		if m == nil {
			t.Fatalf("keychain_backend.ts no longer declares %s", name)
		}
		ts = append(ts, string(m[1]))
	}
	if !slices.Equal(ts, refusedServices) {
		t.Errorf("refusedServices = %q, keychain_backend.ts = %q", refusedServices, ts)
	}
}

type memKeyring map[string]string

func (m memKeyring) Set(s, a, p string) error { m[s+"\x00"+a] = p; return nil }
func (m memKeyring) Get(s, a string) (string, error) {
	if v, ok := m[s+"\x00"+a]; ok {
		return v, nil
	}
	return "", gokeyring.ErrNotFound
}
func (m memKeyring) Delete(s, a string) error {
	if _, ok := m[s+"\x00"+a]; !ok {
		return gokeyring.ErrNotFound
	}
	delete(m, s+"\x00"+a)
	return nil
}

const canary = "c4n4ry-0123456789abcdef"

func probe(t *testing.T, kr keyring, stdin string, args ...string) (string, int) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(args, strings.NewReader(stdin), &out, &errOut, kr)
	return out.String() + errOut.String(), code
}

func TestProbeRefusesTheRealServices(t *testing.T) {
	kr := memKeyring{}
	for _, s := range []string{"specnaut-cloud", "SPECFLOW-CLOUD", ""} {
		if out, code := probe(t, kr, canary, "write", "--service", s); code != 2 || len(kr) != 0 {
			t.Errorf("--service %q: exit %d, %d items written (%s)", s, code, len(kr), out)
		}
	}
}

func TestRoundtripPrintsNoSecretAndLeavesNothing(t *testing.T) {
	kr := memKeyring{}
	out, code := probe(t, kr, canary+"\n", "roundtrip")
	if code != 0 || !strings.Contains(out, "read: match\n") {
		t.Errorf("roundtrip: exit %d, %q", code, out)
	}
	if strings.Contains(out, canary) {
		t.Error("the canary was printed")
	}
	if len(kr) != 0 {
		t.Errorf("roundtrip left %d item(s)", len(kr))
	}
}

type failingGet struct{ memKeyring }

func (failingGet) Get(string, string) (string, error) { return "", errors.New("locked: " + canary) }

func TestRoundtripRemovesEvenWhenTheReadFails(t *testing.T) {
	kr := failingGet{memKeyring{}}
	out, code := probe(t, kr, canary, "roundtrip")
	if code == 0 || len(kr.memKeyring) != 0 || strings.Contains(out, canary) {
		t.Errorf("exit %d, %d items left, output %q", code, len(kr.memKeyring), out)
	}
}

// failingSet stores the item, then reports an error — a backend that wrote
// before it failed.
type failingSet struct{ memKeyring }

func (f failingSet) Set(s, a, p string) error {
	f.memKeyring[s+"\x00"+a] = p
	return errors.New("timeout")
}

func TestRoundtripRemovesEvenWhenTheWriteFails(t *testing.T) {
	kr := failingSet{memKeyring{}}
	if out, code := probe(t, kr, canary, "roundtrip"); code == 0 || len(kr.memKeyring) != 0 {
		t.Errorf("exit %d, %d items left, output %q", code, len(kr.memKeyring), out)
	}
}

// encodingSet stores what go-keyring stores on macOS for some values: the
// secret behind a prefix. The read must say mismatch, print no length, and the
// item must still go.
type encodingSet struct{ memKeyring }

func (e encodingSet) Set(s, a, p string) error { return e.memKeyring.Set(s, a, "go-keyring-base64:"+p) }

func TestRoundtripMismatchIsAFailureThatLeavesNothing(t *testing.T) {
	kr := encodingSet{memKeyring{}}
	out, code := probe(t, kr, canary, "roundtrip")
	if code != 1 || !strings.Contains(out, "read: mismatch\n") {
		t.Errorf("exit %d, %q", code, out)
	}
	if len(kr.memKeyring) != 0 || strings.Contains(out, canary) {
		t.Errorf("%d items left, output %q", len(kr.memKeyring), out)
	}
}

func TestReadSaysMismatchByLengthOnly(t *testing.T) {
	kr := memKeyring{ProbeService + "\x00probe": "go-keyring-base64:" + canary}
	out, code := probe(t, kr, canary, "read")
	if code != 1 || !strings.Contains(out, "read: mismatch\n") {
		t.Errorf("exit %d, %q", code, out)
	}
}

func TestShortCanaryRefused(t *testing.T) {
	if _, code := probe(t, memKeyring{}, "short", "write"); code != 2 {
		t.Errorf("a short canary was accepted: exit %d", code)
	}
}

func TestReachableIsAMissNotAnError(t *testing.T) {
	if out, _ := probe(t, memKeyring{}, "", "reachable"); out != "reachable: true\n" {
		t.Errorf("reachable = %q", out)
	}
	if out, _ := probe(t, failingGet{memKeyring{}}, "", "reachable"); out != "reachable: false\n" {
		t.Errorf("an erroring store reads as reachable: %q", out)
	}
}
