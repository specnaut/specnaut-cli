package cli

import "github.com/specnaut/specnaut-cli/internal/js"

// Kind is the JavaScript type a parsed flag value has.
type Kind int

// The value kinds `parseArgs` produces: a boolean, a string, a number (a
// string that looked numeric, coerced), or an object (a dotted key such as
// `--a.b 1` builds `{a: {b: 1}}`).
const (
	Bool Kind = iota
	String
	Number
	Object
)

// Value is one flag or positional value, typed as JavaScript would type it,
// because parser.ts reads them with `typeof` and truthiness.
type Value struct {
	Kind Kind
	B    bool
	S    string
	N    float64
	Obj  map[string]Value
}

// Truthy is JavaScript truthiness: `if (parsed.version)` is how parser.ts
// asks. `-h0` sets help to the number 0, which is falsy, so it is not help.
func (v Value) Truthy() bool {
	switch v.Kind {
	case Bool:
		return v.B
	case String:
		return v.S != ""
	case Number:
		return v.N != 0 && v.N == v.N // NaN is falsy
	default:
		return true
	}
}

// Text is `String(value)` for the two kinds a positional can have.
func (v Value) Text() string {
	if v.Kind == Number {
		return js.NumberToString(v.N)
	}
	return v.S
}

func boolValue(b bool) Value      { return Value{Kind: Bool, B: b} }
func stringValue(s string) Value  { return Value{Kind: String, S: s} }
func numberValue(n float64) Value { return Value{Kind: Number, N: n} }

// ShapeError is a command line JavaScript's parseArgs would have thrown on —
// a dotted key writing through a value that is not an object
// (`--a 1 --a.b 2`) — or one whose JavaScript outcome depends on the object
// model rather than on parseArgs (a key `_` replacing the positional list, a
// path through `__proto__`). Either way TypeScript ends in an uncaught trace,
// or in prototype effects no port should copy; the Go binary refuses the
// shape instead.
type ShapeError struct{ Msg string }

func (e *ShapeError) Error() string { return e.Msg }

// setNested is parse_args.ts's setNested: `a.b.c` assigns through objects it
// creates on the way.
func setNested(root map[string]Value, keys []string, v Value) error {
	if keys[0] == "_" {
		return &ShapeError{"a flag named `_` replaces the positional list"}
	}
	obj := root
	for _, k := range keys[:len(keys)-1] {
		if k == "__proto__" {
			return &ShapeError{"a dotted flag through `__proto__` writes the object prototype"}
		}
		cur, ok := obj[k]
		if !ok {
			cur = Value{Kind: Object, Obj: map[string]Value{}}
			obj[k] = cur
		}
		if cur.Kind != Object {
			return &ShapeError{"Cannot create property on a " + kindName(cur.Kind) + " (flag `" + k + "`)"}
		}
		obj = cur.Obj
	}
	if last := keys[len(keys)-1]; last != "__proto__" { // a primitive __proto__ is a no-op
		obj[last] = v
	}
	return nil
}

func kindName(k Kind) string {
	return map[Kind]string{Bool: "boolean", String: "string", Number: "number", Object: "object"}[k]
}
