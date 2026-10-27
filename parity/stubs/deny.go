package stubs

import (
	"net/http"
)

// denyHandler is the proxy every non-loopback request is sent to. The
// scenario environment points HTTP_PROXY, HTTPS_PROXY and ALL_PROXY here, so a
// request for any host that is not stubbed arrives as a CONNECT (or an
// absolute-URI GET) and is refused with 403.
//
// A closed port would refuse it too, but would prove nothing: "connection
// refused" is what every failure looks like, including a request that was
// never made. A listener the harness owns turns the refusal into a counted
// hit naming the host that was asked for — the positive evidence the
// network-deny scenario requires. It also cannot be answered by whatever else
// happens to listen on a well-known port of the machine.
func denyHandler(c *counter) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.hit(r.Method + " " + r.Host)
		http.Error(w, "parity: network denied: "+r.Host, http.StatusForbidden)
	})
}
