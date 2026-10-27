package lockfile

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/specnaut/specnaut-cli/internal/js"
)

// opaque is a YAML value JavaScript sees as an object that is neither a map
// nor an array — a `!!timestamp` (a Date) or `!!binary` (a Uint8Array). It is
// kept distinct so a timestamp-shaped `installed_at` is "not a string", as
// it is for `@std/yaml`, where a plain `yaml.Unmarshal` would hand back text.
type opaque struct{ tag string }

// SyntaxError is a lock the YAML reader refuses. TypeScript throws a
// SyntaxError there too, so the class is the same; the message is not. The
// TypeScript one is @std/yaml's own diagnostic (line, column, a caret under the
// snippet), and porting one parser's prose to another is a convergence with no
// end. So the lock goldens hold this class to TypeScript's, and the text is
// compared only TypeScript against TypeScript, as an uncaught trace
// (parity/excluded.go).
type SyntaxError struct{ Err error }

func (e *SyntaxError) Error() string { return e.Err.Error() }
func (e *SyntaxError) Unwrap() error { return e.Err }

// Name is the JavaScript class an uncaught trace would name.
func (e *SyntaxError) Name() string { return "SyntaxError" }

// decodeYAML reads one YAML document into JavaScript-shaped values: nil,
// bool, float64, string, map[string]any, []any or opaque — what `@std/yaml`
// `parse` gives parseLock. Tags are read off the node, never inferred from the
// Go type a decoder chose. Every failure is a *SyntaxError, as every failure of
// `parse` is.
func decodeYAML(data []byte) (any, error) {
	v, err := decodeDocument(data)
	if err != nil {
		return nil, &SyntaxError{err}
	}
	return v, nil
}

func decodeDocument(data []byte) (any, error) {
	dec := yaml.NewDecoder(bytes.NewReader(data))
	var doc yaml.Node
	if err := dec.Decode(&doc); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		return nil, err
	}
	var extra yaml.Node
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("Found more than 1 document in the stream: expected a single document")
		}
		return nil, err
	}
	return toValue(&doc)
}

func toValue(n *yaml.Node) (any, error) {
	switch n.Kind {
	case yaml.DocumentNode:
		return toValue(n.Content[0])
	case yaml.AliasNode:
		return toValue(n.Alias)
	case yaml.SequenceNode:
		out := make([]any, 0, len(n.Content))
		for _, c := range n.Content {
			v, err := toValue(c)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case yaml.MappingNode:
		return toMap(n)
	}
	return scalar(n)
}

func scalar(n *yaml.Node) (any, error) {
	switch tag := n.ShortTag(); tag {
	case "!!null":
		return nil, nil
	case "!!str":
		return n.Value, nil
	case "!!bool":
		return strings.EqualFold(n.Value, "true"), nil
	case "!!int":
		return yamlInt(n.Value)
	case "!!float":
		return yamlFloat(n.Value)
	case "!!timestamp", "!!binary":
		return opaque{tag}, nil
	default:
		return nil, fmt.Errorf("unknown tag !<%s>", tag)
	}
}

// yamlInt reads a YAML 1.2 integer as js-yaml constructs it: a sign, then
// `0b`/`0o`/`0x` or decimal digits (a leading 0 stays decimal), `_` ignored.
func yamlInt(s string) (any, error) {
	v := strings.ReplaceAll(s, "_", "")
	sign := 1.0
	if v != "" && (v[0] == '-' || v[0] == '+') {
		if v[0] == '-' {
			sign = -1
		}
		v = v[1:]
	}
	base := 10
	if len(v) > 2 && v[0] == '0' {
		if b, ok := map[byte]int{'b': 2, 'o': 8, 'x': 16}[v[1]]; ok {
			base, v = b, v[2:]
		}
	}
	n, err := strconv.ParseUint(v, base, 64)
	if err != nil {
		return nil, fmt.Errorf("cannot read integer %q", s)
	}
	return sign * float64(n), nil
}

func yamlFloat(s string) (any, error) {
	switch strings.ToLower(strings.TrimLeft(s, "+")) {
	case ".inf":
		return math.Inf(1), nil
	case "-.inf":
		return math.Inf(-1), nil
	case ".nan":
		return math.NaN(), nil
	}
	f, err := strconv.ParseFloat(strings.ReplaceAll(s, "_", ""), 64)
	if err != nil {
		return nil, fmt.Errorf("cannot read float %q", s)
	}
	return f, nil
}

// toMap builds a mapping. Keys become property names as JavaScript names
// them (`String(key)`); a repeated key is an error, as in js-yaml; `<<`
// merges keys the mapping does not set itself.
func toMap(n *yaml.Node) (any, error) {
	out := map[string]any{}
	merged := map[string]bool{}
	for i := 0; i+1 < len(n.Content); i += 2 {
		k, vn := n.Content[i], n.Content[i+1]
		v, err := toValue(vn)
		if err != nil {
			return nil, err
		}
		if k.Kind == yaml.ScalarNode && k.ShortTag() == "!!merge" {
			if err := merge(out, merged, v); err != nil {
				return nil, err
			}
			continue
		}
		key, err := propertyName(k)
		if err != nil {
			return nil, err
		}
		if _, dup := out[key]; dup && !merged[key] {
			return nil, fmt.Errorf("duplicated mapping key %q", key)
		}
		out[key], merged[key] = v, false
	}
	return out, nil
}

func merge(out map[string]any, merged map[string]bool, src any) error {
	sources, ok := src.([]any)
	if !ok {
		sources = []any{src}
	}
	for _, s := range sources {
		m, ok := s.(map[string]any)
		if !ok {
			return errors.New("cannot merge mappings; the provided source object is unacceptable")
		}
		for k, v := range m {
			if _, set := out[k]; !set {
				out[k], merged[k] = v, true
			}
		}
	}
	return nil
}

func propertyName(k *yaml.Node) (string, error) {
	v, err := toValue(k)
	if err != nil {
		return "", err
	}
	switch x := v.(type) {
	case nil:
		return "null", nil
	case string:
		return x, nil
	case bool:
		return strconv.FormatBool(x), nil
	case float64:
		return js.NumberToString(x), nil
	}
	return k.Value, nil
}
