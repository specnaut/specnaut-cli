package stubs

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

// The Cloud stub is a test double of the public, versioned `/api/v1` HTTP
// contract — the only bridge between the CLI and the hosted service. Every
// route and field below is one the public CLI already parses; nothing here
// comes from anywhere else. Mirrored files:
//
//	src/domain/cloud/cloud_client.ts   orgs, columns, tasks
//	src/domain/cloud/gate_client.ts    gates: open, list, apply, cancel
//	src/domain/cloud/gate_contract.ts  parseGate
//	src/domain/cloud/spec_client.ts    specs: ensure, get, put steps
//	src/domain/cloud/spec_contract.ts  parseSpec
//
// Every route requires `Authorization: Bearer <canary>`, so a hit with any
// other token — a real one included — is a 401, never a success.

// StubProjectKey is the project every Cloud fixture links to.
const StubProjectKey = "WID"

// StubGateID is the id of the one gate the stub ever opens.
const StubGateID = "g-1"

func cloudHandler(c *counter, canary string) http.Handler {
	mux := http.NewServeMux()
	route := func(pattern string, body func(*http.Request) (int, any)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			status, payload := body(r)
			if r.Header.Get("Authorization") != "Bearer "+canary {
				status, payload = http.StatusUnauthorized, map[string]any{"error": "unauthorized"}
			}
			writeJSON(w, status, payload)
		})
	}
	route("GET /api/v1/orgs", fixed(200, map[string]any{"orgs": []any{
		map[string]any{"slug": "acme", "name": "Acme", "role": "owner", "isActive": true},
		map[string]any{"slug": "acme-labs", "name": "Acme Labs", "role": "member", "isActive": false},
	}}))
	route("GET /api/v1/columns", fixed(200, map[string]any{"columns": []any{
		map[string]any{"id": "col-done", "name": "Done", "order": 2},
		map[string]any{"id": "col-todo", "name": "Todo", "order": 1},
	}}))
	route("GET /api/v1/tasks", fixed(200, map[string]any{"tasks": []any{
		map[string]any{"number": 7, "title": "Ship the widget", "columnId": "col-todo", "priority": "P1", "size": "3"},
		map[string]any{"number": 8, "title": "Polish the widget", "columnId": "col-todo"},
	}}))
	route("POST /api/v1/gates", fixed(201, map[string]any{"gate": gate("open", nil)}))
	route("GET /api/v1/gates", fixed(200, map[string]any{
		"gates":   []any{gate("answered", map[string]any{"choice": "yes"})},
		"hasMore": false,
	}))
	route("POST /api/v1/gates/{id}/apply", fixed(200, map[string]any{"gate": gate("applied", nil)}))
	route("POST /api/v1/gates/{id}/cancel", fixed(200, map[string]any{"gate": gate("cancelled", nil)}))
	route("GET /api/v1/specs", fixed(200, map[string]any{"spec": spec()}))
	route("POST /api/v1/specs", fixed(201, map[string]any{"spec": spec()}))
	route("PUT /api/v1/specs/steps", fixed(200, map[string]any{}))
	route("/", fixed(404, map[string]any{"error": "not found"}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.hit(r.Method + " " + r.URL.RequestURI())
		mux.ServeHTTP(w, r)
	})
}

func fixed(status int, payload any) func(*http.Request) (int, any) {
	return func(*http.Request) (int, any) { return status, payload }
}

func gate(state string, answer map[string]any) map[string]any {
	return map[string]any{
		"id": StubGateID, "projectKey": StubProjectKey, "type": "clarification",
		"title": "Which widget?", "payload": map[string]any{"question": "Which widget?"},
		"state": state, "answer": answer, "createdBy": "acme-bot",
		"createdAt": "2026-01-01T00:00:00.000Z",
	}
}

func spec() map[string]any {
	return map[string]any{
		"taskNumber": 7, "title": "Ship the widget",
		"steps": []any{
			map[string]any{"key": "plan", "name": "Plan", "order": 2, "body": "# Plan\n\nBuild the widget.\n"},
			map[string]any{"key": "spec", "name": "Spec", "order": 1, "body": "# Spec\n\nA widget.\n"},
		},
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		fmt.Fprintf(os.Stderr, "parity cloud stub: write: %v\n", err)
	}
}

// CredentialsFile is the body of a `~/.specnaut/credentials.json` holding a
// live session for apiURL, in the shape FileCredentialStore reads
// (src/infrastructure/credential_store.ts). The access token is the canary and
// expires in 2100, so the CLI uses it without ever calling the refresh route.
func CredentialsFile(apiURL, canary string) ([]byte, error) {
	return json.MarshalIndent(map[string]any{
		apiURL: map[string]any{
			"accessToken":     canary,
			"refreshToken":    "parity-refresh-token",
			"accessExpiresAt": int64(4102444800000),
		},
	}, "", "  ")
}
