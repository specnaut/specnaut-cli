package parity

import (
	"os"
	"strings"
	"testing"
)

// The Cloud URL has one source, env.go's $CLOUD_URL (plan §5, env row). A
// scenario may pass it as --api-url, or pass a URL the CLI refuses before
// dialling (not http/https); never a dialable literal of its own.
func TestEveryApiUrlIsTheInjectedOne(t *testing.T) {
	scenarios, err := Scenarios(t.TempDir(), "testdata")
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, s := range scenarios {
		data, err := os.ReadFile(s.File)
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range scriptLines(string(data)) {
			f := strings.Fields(line)
			for i := 0; i+1 < len(f); i++ {
				if f[i] != "--api-url" {
					continue
				}
				seen++
				if v := f[i+1]; v != "$CLOUD_URL" && (strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://")) {
					t.Errorf("%s: --api-url %s; pass $CLOUD_URL, which env.go owns", s.Name, v)
				}
			}
		}
	}
	if seen == 0 {
		t.Fatal("no scenario passes --api-url: is the reader still aimed at the scripts?")
	}
}
