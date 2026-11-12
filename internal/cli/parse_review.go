package cli

import "strings"

// parseReview is review_parser.ts's parseReview: `gate` takes no word, `start` one non-empty
// source, `end` one full commit id. The Go binary answers each as not ported.
func parseReview(_ Args, rest []string) Intent {
	sub, words := "", []string{}
	if len(rest) > 0 {
		sub, words = rest[0], rest[1:]
	}
	switch sub {
	case "gate":
		if len(words) != 0 {
			return unknown("review gate takes no argument")
		}
	case "start":
		if len(words) != 1 || words[0] == "" {
			return unknown("review start takes one source")
		}
	case "end":
		if len(words) != 1 || !fullSha.MatchString(words[0]) {
			return unknown("review end takes one full commit id")
		}
	default:
		return unknown(strings.TrimSpace("review " + sub))
	}
	return Intent{Kind: "review"}
}
