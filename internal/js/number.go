// Package js reproduces the few JavaScript value semantics the TypeScript
// binary's output depends on, so the Go port prints what it prints:
// `Number(string)`, `String(number)`, and `JSON.stringify` of a string.
package js

import (
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// Space is the set JavaScript's `\s` and `String.prototype.trim` share:
// WhiteSpace plus LineTerminator.
const Space = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006" +
	"\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

var decimalLiteral = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

// ToNumber is JavaScript's `Number(string)`; ok is false for NaN.
func ToNumber(s string) (float64, bool) {
	t := strings.Trim(s, Space)
	if t == "" {
		return 0, true
	}
	if n, ok := radixLiteral(t); ok {
		return n, true
	}
	switch t {
	case "Infinity", "+Infinity":
		return math.Inf(1), true
	case "-Infinity":
		return math.Inf(-1), true
	}
	if !decimalLiteral.MatchString(t) {
		return 0, false
	}
	n, err := strconv.ParseFloat(t, 64)
	if err != nil && !isRangeError(err) {
		return 0, false
	}
	return n, true
}

func isRangeError(err error) bool {
	ne, ok := err.(*strconv.NumError)
	return ok && ne.Err == strconv.ErrRange
}

// radixLiteral reads `0x…`, `0o…` and `0b…`, unsigned as JavaScript requires,
// rounded to the nearest double as `Number` rounds them.
func radixLiteral(t string) (float64, bool) {
	if len(t) < 3 || t[0] != '0' {
		return 0, false
	}
	base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[t[1]]
	if base == 0 {
		return 0, false
	}
	digits := t[2:]
	if strings.ContainsAny(digits, "_+-") {
		return 0, false
	}
	i, ok := new(big.Int).SetString(digits, base)
	if !ok {
		return 0, false
	}
	f, _ := new(big.Float).SetInt(i).Float64()
	return f, true
}

// NumberToString is JavaScript's `Number.prototype.toString()` (radix 10):
// the shortest round-tripping digits, positional between 1e-7 and 1e21,
// exponential outside it.
func NumberToString(n float64) string {
	switch {
	case n != n:
		return "NaN"
	case n == 0:
		return "0"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	case n < 0:
		return "-" + NumberToString(-n)
	}
	mantissa, exp, _ := strings.Cut(strconv.FormatFloat(n, 'e', -1, 64), "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	e, _ := strconv.Atoi(exp)
	return layoutDigits(digits, e+1)
}

// layoutDigits places digits d (no leading zero) with decimal exponent point
// p, per ECMA-262 Number::toString steps 6–10.
func layoutDigits(d string, p int) string {
	k := len(d)
	switch {
	case k <= p && p <= 21:
		return d + strings.Repeat("0", p-k)
	case 0 < p && p <= 21:
		return d[:p] + "." + d[p:]
	case -6 < p && p <= 0:
		return "0." + strings.Repeat("0", -p) + d
	}
	sign := "+"
	if p-1 < 0 {
		sign = "-"
	}
	exp := strconv.Itoa(abs(p - 1))
	if k == 1 {
		return d + "e" + sign + exp
	}
	return d[:1] + "." + d[1:] + "e" + sign + exp
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
