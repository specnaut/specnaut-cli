package cli

import (
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"

	"github.com/specnaut/specnaut-cli/internal/js"
)

// This file is the one place the command line is split into flags and
// positionals. It reproduces `@std/cli` 1.0.27 `parseArgs` (a minimist port)
// as `src/cli/parser.ts` calls it, because that is the surface users have:
//
//   - one global flag table, read in one pass (surface.go);
//   - an unknown flag is accepted, and takes the next word as its value
//     unless that word starts with `-` — `--bogus init` has no command;
//   - flags anywhere, `--flag=value`, combined short flags (`-vh`);
//   - a positional that looks numeric becomes a number (`0042` → `42`).
//
// The standard `flag` package can express none of the four. The regular
// expressions are parse_args.ts's, with JavaScript's `.` (no line
// terminators) spelled out where Go's `.` differs. Short flags are walked in
// UTF-16 code units, as JavaScript's `slice` and `split("")` walk them.

var (
	flagRE    = regexp.MustCompile(`(?s)^(?:-(?:(-)(no-)?)?)(.+?)(?:=(.+?))?$`)
	letterRE  = regexp.MustCompile(`[A-Za-z]`)
	numberRE  = regexp.MustCompile(`-?\d+(\.\d*)?(e-?\d+)?$`)
	hyphenRE  = regexp.MustCompile(`^(-|--)[^-]`)
	valueRE   = regexp.MustCompile(`=([^\n\r\x{2028}\x{2029}]+)`)
	specialRE = regexp.MustCompile(`\W`)
)

// Args is what `parseArgs` returns: the flags by key, and the positionals.
type Args struct {
	Flags      map[string]Value
	Positional []Value
}

type tokeniser struct {
	booleans, strings map[string]bool
	aliases           map[string][]string
	out               Args
	err               error
}

// Tokenise splits args against table with parseArgs's semantics. An error is
// a shape JavaScript would have thrown on (a TypeError inside parseArgs), so
// the caller reports it as the uncaught failure TypeScript prints.
func Tokenise(args []string, table FlagTable) (Args, error) {
	t := newTokeniser(table)
	flags, notFlags := args, []string(nil)
	if i := slices.Index(args, "--"); i >= 0 {
		flags, notFlags = args[:i], args[i+1:]
	}
	for i := 0; i < len(flags) && t.err == nil; i++ {
		i += t.token(flags, i)
	}
	if t.err != nil {
		return Args{}, t.err
	}
	t.defaultBooleans()
	for _, a := range notFlags {
		t.out.Positional = append(t.out.Positional, stringValue(a))
	}
	return t.out, nil
}

func newTokeniser(table FlagTable) *tokeniser {
	t := &tokeniser{
		booleans: map[string]bool{},
		strings:  map[string]bool{},
		aliases:  map[string][]string{},
		out:      Args{Flags: map[string]Value{}},
	}
	for short, long := range table.Aliases {
		t.aliases[short] = append(t.aliases[short], long)
		t.aliases[long] = append(t.aliases[long], short)
	}
	for _, k := range table.Booleans {
		t.booleans[k] = true
		for _, a := range t.aliases[k] {
			t.booleans[a] = true
		}
	}
	for _, k := range table.Strings {
		t.strings[k] = true
		for _, a := range t.aliases[k] {
			t.strings[a] = true
		}
	}
	return t
}

// token reads args[i] and returns how many extra words it consumed.
func (t *tokeniser) token(args []string, i int) int {
	arg := args[i]
	m := flagRE.FindStringSubmatchIndex(arg)
	if m == nil {
		t.positional(arg)
		return 0
	}
	next, hasNext := "", i+1 < len(args)
	if hasNext {
		next = args[i+1]
	}
	if m[2] >= 0 { // `--`
		key, value, hasValue := arg[m[6]:m[7]], "", m[8] >= 0
		if hasValue {
			value = arg[m[8]:m[9]]
		}
		return t.long(key, m[4] >= 0, value, hasValue, next)
	}
	return t.short(arg, next)
}

func (t *tokeniser) positional(arg string) {
	if t.strings["_"] || !isNumber(arg) {
		t.out.Positional = append(t.out.Positional, stringValue(arg))
		return
	}
	n, _ := js.ToNumber(arg)
	t.out.Positional = append(t.out.Positional, numberValue(n))
}

// long reads `--key`, `--no-key` and `--key=value`.
func (t *tokeniser) long(key string, negated bool, value string, hasValue bool, next string) int {
	if hasValue {
		if t.booleans[key] {
			t.set(key, boolValue(value != "false"))
		} else {
			t.set(key, stringValue(value))
		}
		return 0
	}
	if negated {
		key = "no-" + key
	}
	if next != "" {
		if !t.booleans[key] && !strings.HasPrefix(next, "-") && !t.aliasIsBoolean(key) {
			t.set(key, stringValue(next))
			return 1
		}
		if next == "true" || next == "false" {
			t.set(key, boolValue(next != "false"))
			return 1
		}
	}
	t.set(key, t.bare(key))
	return 0
}

// short reads `-x`, `-xyz`, `-x=value` and `-n5`, letter by letter.
func (t *tokeniser) short(arg, next string) int {
	u := utf16.Encode([]rune(arg))
	letters := u[1 : len(u)-1]
	for j := range letters {
		letter, rest := units(letters[j:j+1]), units(u[j+2:])
		if rest == "-" {
			t.set(letter, stringValue(rest))
			continue
		}
		if letterRE.MatchString(letter) {
			if v := valueRE.FindStringSubmatch(rest); v != nil {
				t.set(letter, stringValue(v[1]))
				return 0
			}
			if numberRE.MatchString(rest) {
				t.set(letter, stringValue(rest))
				return 0
			}
		}
		if j+1 < len(letters) && specialRE.MatchString(units(letters[j+1:j+2])) {
			t.set(letter, stringValue(rest))
			return 0
		}
		t.set(letter, t.bare(letter))
	}
	return t.lastLetter(units(u[len(u)-1:]), next)
}

// lastLetter reads the final letter of a short group, which alone may take
// the next word as its value.
func (t *tokeniser) lastLetter(key, next string) int {
	if key == "-" {
		return 0
	}
	if next != "" {
		if !hyphenRE.MatchString(next) && !t.booleans[key] && !t.aliasIsBoolean(key) {
			t.set(key, stringValue(next))
			return 1
		}
		if next == "true" || next == "false" {
			t.set(key, boolValue(next != "false"))
			return 1
		}
	}
	t.set(key, t.bare(key))
	return 0
}

func units(u []uint16) string { return string(utf16.Decode(u)) }

// bare is a flag given without a value: `""` for a string flag, else true.
func (t *tokeniser) bare(key string) Value {
	if t.strings[key] {
		return stringValue("")
	}
	return boolValue(true)
}

func (t *tokeniser) aliasIsBoolean(key string) bool {
	return slices.ContainsFunc(t.aliases[key], func(a string) bool { return t.booleans[a] })
}

// set is parse_args.ts's setArgument: a string for a non-string flag that
// looks numeric becomes a number, and the value lands on every alias.
func (t *tokeniser) set(key string, v Value) {
	if t.err != nil {
		return
	}
	if v.Kind == String && !t.strings[key] && isNumber(v.S) {
		n, _ := js.ToNumber(v.S)
		v = numberValue(n)
	}
	t.err = setNested(t.out.Flags, strings.Split(key, "."), v)
	for _, a := range t.aliases[key] {
		if t.err == nil {
			t.err = setNested(t.out.Flags, strings.Split(a, "."), v)
		}
	}
}

// defaultBooleans gives every boolean flag that was never set the value false.
func (t *tokeniser) defaultBooleans() {
	for k := range t.booleans {
		if _, ok := t.out.Flags[k]; !ok {
			t.out.Flags[k] = boolValue(false)
		}
	}
}

// Flag returns a flag's value, and whether it is set at all.
func (a Args) Flag(key string) (Value, bool) {
	v, ok := a.Flags[key]
	return v, ok
}

// StringFlag is parser.ts's `typeof parsed[key] === "string" ? … : null`.
func (a Args) StringFlag(key string) (string, bool) {
	v, ok := a.Flags[key]
	if !ok || v.Kind != String {
		return "", false
	}
	return v.S, true
}

// Words is `parsed._.map(String)`.
func (a Args) Words() []string {
	out := make([]string, len(a.Positional))
	for i, v := range a.Positional {
		out[i] = v.Text()
	}
	return out
}
