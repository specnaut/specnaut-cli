package cli

import (
	"regexp"
	"strings"
)

// fullSha is commit_sha.ts's isFullSha: 40 or 64 lower-case hex digits.
var fullSha = regexp.MustCompile(`^[0-9a-f]{40}(?:[0-9a-f]{24})?$`)

func sandboxRefused(why string) Intent { return unknown("sandbox " + why) }

// parseSandbox is sandbox_parser.ts's parseSandbox: the same refusals, in its order. The command
// is every word after the first `--`; the commit id and --toolchain come before it.
func parseSandbox(a Args, rest []string) Intent {
	after := len(a.AfterDash)
	sub, words := "", []string{}
	if len(rest) > 0 {
		sub, words = rest[0], rest[1:]
	}
	if after > len(words) {
		return sandboxRefused("takes its sub-command before --")
	}
	before := words[:len(words)-after]
	switch sub {
	case "probe":
		return parseSandboxProbe(a, before)
	case "exec":
		return parseSandboxExec(a, before, after)
	}
	return unknown(strings.TrimSpace("sandbox " + sub))
}

// parseSandboxProbe: probe takes no word, before -- or after it.
func parseSandboxProbe(a Args, before []string) Intent {
	if len(before) > 0 || a.AfterDash != nil {
		return sandboxRefused("probe takes no argument")
	}
	return Intent{Kind: "sandbox"}
}

// parseSandboxExec is sandbox_parser.ts's parseExec: one full commit id before --, a command
// after it, and --toolchain.
func parseSandboxExec(a Args, before []string, after int) Intent {
	if len(before) != 1 || !fullSha.MatchString(before[0]) {
		return sandboxRefused("exec takes one full commit id before --")
	}
	if after == 0 {
		return sandboxRefused("exec needs a command after --")
	}
	if v, ok := a.Flag("toolchain"); ok && !isToolchain(v) {
		return sandboxRefused("exec --toolchain takes absolute folders separated by :")
	}
	if v, ok := a.Flag("log"); ok && !isAbsoluteFile(v) {
		return sandboxRefused("exec --log takes an absolute file path")
	}
	return Intent{Kind: "sandbox"}
}

// absoluteFile is sandbox_parser.ts's isAbsolutePath: `/x`, or a drive letter's `C:\x` / `C:/x`.
var absoluteFile = regexp.MustCompile(`^(/|[A-Za-z]:[\\/]).`)

func isAbsoluteFile(v Value) bool {
	return v.Kind == String && absoluteFile.MatchString(v.S)
}

// isToolchain is sandbox_parser.ts's toolchainOf: a string of absolute folders joined by `:`.
func isToolchain(v Value) bool {
	if v.Kind != String {
		return false
	}
	for _, f := range strings.Split(v.S, ":") {
		if !strings.HasPrefix(f, "/") {
			return false
		}
	}
	return true
}
