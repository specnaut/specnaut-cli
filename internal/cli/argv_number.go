package cli

import (
	"math"
	"strings"

	"github.com/specnaut/specnaut-cli/internal/js"
)

// isNumber is `@std/cli` parse_args.ts's: some non-whitespace, and
// `Number(s)` finite. It decides which words become numbers, and parser.ts
// reads every positional back through `parsed._.map(String)` — so `0042`
// arrives as `42` and `1e3` as `1000`, observable in every refusal that
// echoes a positional.
func isNumber(s string) bool {
	if strings.Trim(s, js.Space) == "" {
		return false
	}
	n, ok := js.ToNumber(s)
	return ok && !math.IsInf(n, 0)
}
