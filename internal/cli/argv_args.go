package cli

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
