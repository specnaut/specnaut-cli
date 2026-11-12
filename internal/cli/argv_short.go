package cli

// The short-flag reader of the tokeniser in argv.go: `-x`, `-xyz`, `-x=value`, `-n5`.

import "unicode/utf16"

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
