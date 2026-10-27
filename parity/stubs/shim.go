package stubs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// Environment variables a command shim reads to find its loopback server.
// env.go sets them; the shim only reads.
const (
	GhURLVar   = "PARITY_STUB_GH_URL"
	GlabURLVar = "PARITY_STUB_GLAB_URL"
)

// invocation is what a shim forwards: its argv, minus the program name.
type invocation struct {
	Args []string `json:"args"`
}

// answer is what a shim prints and the status it exits with.
type answer struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
	Exit   int    `json:"exit"`
}

// answerer decides a command's reply from its arguments.
type answerer func(args []string) answer

// shimServer counts each invocation and replies with the answerer's output.
func shimServer(c *counter, reply answerer) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var inv invocation
		if err := json.NewDecoder(r.Body).Decode(&inv); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		c.hit(strings.Join(inv.Args, " "))
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(reply(inv.Args)); err != nil {
			// The shim reads this body; a failed write is the shim's error to
			// report, and it does (exit 127). Logged here for the stub side.
			fmt.Fprintf(os.Stderr, "parity stub: write answer: %v\n", err)
		}
	})
}

// runShim is the body of a command shim, run in a child process that the CLI
// binary spawned. It forwards argv to the scenario's loopback server and
// replays the answer. Without its server variable it refuses: a shim found on
// PATH outside the harness must never pretend to be the real tool.
func runShim(name, urlVar string) int {
	url := os.Getenv(urlVar)
	if url == "" {
		fmt.Fprintf(os.Stderr, "%s (parity stub): %s is unset — refusing to run outside the harness\n", name, urlVar)
		return 127
	}
	body, err := json.Marshal(invocation{Args: os.Args[1:]})
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s (parity stub): %v\n", name, err)
		return 127
	}
	// Proxy: nil — the scenario environment points every proxy variable at the
	// deny stub, and this request is the one that must reach loopback directly.
	client := &http.Client{Transport: &http.Transport{Proxy: nil}}
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s (parity stub): %v\n", name, err)
		return 127
	}
	defer resp.Body.Close()
	var a answer
	if err := json.NewDecoder(resp.Body).Decode(&a); err != nil {
		fmt.Fprintf(os.Stderr, "%s (parity stub): bad answer: %v\n", name, err)
		return 127
	}
	writeAll(os.Stdout, a.Stdout)
	writeAll(os.Stderr, a.Stderr)
	return a.Exit
}

func writeAll(w io.Writer, s string) {
	if _, err := io.WriteString(w, s); err != nil {
		fmt.Fprintf(os.Stderr, "parity stub: write: %v\n", err)
	}
}
