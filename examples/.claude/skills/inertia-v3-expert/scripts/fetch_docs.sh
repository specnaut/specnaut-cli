#!/bin/bash
set -e

DOCS_DIR="$(dirname "$0")/../docs"
mkdir -p "$DOCS_DIR"

URLS=(
  "https://inertiajs.com/docs/v3/installation/server-side-setup.md"
  "https://inertiajs.com/docs/v3/installation/client-side-setup.md"
  "https://inertiajs.com/docs/v3/core-concepts/who-is-it-for.md"
  "https://inertiajs.com/docs/v3/core-concepts/how-it-works.md"
  "https://inertiajs.com/docs/v3/core-concepts/the-protocol.md"
  "https://inertiajs.com/docs/v3/the-basics/pages.md"
  "https://inertiajs.com/docs/v3/the-basics/responses.md"
  "https://inertiajs.com/docs/v3/the-basics/redirects.md"
  "https://inertiajs.com/docs/v3/the-basics/routing.md"
  "https://inertiajs.com/docs/v3/the-basics/title-and-meta.md"
  "https://inertiajs.com/docs/v3/the-basics/links.md"
  "https://inertiajs.com/docs/v3/the-basics/manual-visits.md"
  "https://inertiajs.com/docs/v3/the-basics/instant-visits.md"
  "https://inertiajs.com/docs/v3/the-basics/forms.md"
  "https://inertiajs.com/docs/v3/the-basics/http-requests.md"
  "https://inertiajs.com/docs/v3/the-basics/optimistic-updates.md"
  "https://inertiajs.com/docs/v3/the-basics/file-uploads.md"
  "https://inertiajs.com/docs/v3/the-basics/validation.md"
  "https://inertiajs.com/docs/v3/the-basics/layouts.md"
  "https://inertiajs.com/docs/v3/the-basics/view-transitions.md"
  "https://inertiajs.com/docs/v3/data-props/shared-data.md"
  "https://inertiajs.com/docs/v3/data-props/flash-data.md"
  "https://inertiajs.com/docs/v3/data-props/partial-reloads.md"
  "https://inertiajs.com/docs/v3/data-props/deferred-props.md"
  "https://inertiajs.com/docs/v3/data-props/merging-props.md"
  "https://inertiajs.com/docs/v3/data-props/once-props.md"
  "https://inertiajs.com/docs/v3/data-props/polling.md"
  "https://inertiajs.com/docs/v3/data-props/prefetching.md"
  "https://inertiajs.com/docs/v3/data-props/load-when-visible.md"
  "https://inertiajs.com/docs/v3/data-props/infinite-scroll.md"
  "https://inertiajs.com/docs/v3/data-props/remembering-state.md"
  "https://inertiajs.com/docs/v3/security/authentication.md"
  "https://inertiajs.com/docs/v3/security/authorization.md"
  "https://inertiajs.com/docs/v3/security/csrf-protection.md"
  "https://inertiajs.com/docs/v3/security/history-encryption.md"
  "https://inertiajs.com/docs/v3/advanced/asset-versioning.md"
  "https://inertiajs.com/docs/v3/advanced/code-splitting.md"
  "https://inertiajs.com/docs/v3/advanced/error-handling.md"
  "https://inertiajs.com/docs/v3/advanced/events.md"
  "https://inertiajs.com/docs/v3/advanced/progress-indicators.md"
  "https://inertiajs.com/docs/v3/advanced/scroll-management.md"
  "https://inertiajs.com/docs/v3/advanced/server-side-rendering.md"
  "https://inertiajs.com/docs/v3/advanced/testing.md"
  "https://inertiajs.com/docs/v3/advanced/typescript.md"
)

echo "Downloading Inertia V3 documentation..."

for URL in "${URLS[@]}"; do
  FILENAME=$(basename "$URL")
  echo "Fetching $FILENAME from $URL"
  curl -s -o "$DOCS_DIR/$FILENAME" "$URL"
done

echo "Done! All files imported to $DOCS_DIR"
