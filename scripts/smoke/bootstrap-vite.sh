#!/usr/bin/env bash
# Bootstrap a brownfield project under sandbox/<name>/ for Specnaut UX tests.
#
# Usage:
#   bootstrap-vite.sh <name>          # offline fixture (default)
#   bootstrap-vite.sh <name> --real   # a genuine `npm create vite` scaffold
#
# ─── Why the default is a local fixture ──────────────────────────────────
# This script used to run `npm create vite@latest` unconditionally. That put
# an unpinned third-party package — fetched at run time and executed — inside
# The pin bounds the ROOT package only. `npm create vite@9.2.0` is
# `npm exec create-vite@9.2.0`: no lockfile applies, so the transitive tree
# floats, and registry integrity is trust-on-first-use rather than
# verification. The fetch runs install lifecycle scripts with the
# maintainer's privileges. Reachable only by passing --real by hand — no
# caller in this repository does, CI included — which is why the risk is
# accepted rather than removed.
# a gate that now runs on every push. Two consequences, and the second is the
# one that decided it:
#
#   1. In CI it is a network dependency and a floating version: the registry
#      can be slow, and an upstream template change reds a correct pull
#      request for a reason unrelated to Specnaut. (Observed: `create-vite`
#      has since added oxlint to the scaffold.)
#   2. Outside CI this same script is what a local session runs on a
#      maintainer's workstation — whose working tree also contains the
#      private half of this project. A compromised `create-vite` release
#      reaches it. That is a constitution § I exposure path which no review
#      of this repository would ever surface, because the vulnerable byte is
#      not in this repository.
#
# So: deterministic, offline, instant by default. The fixture reproduces the
# real scaffold's SHAPE — in particular its .gitignore, because that is what
# the brownfield merge is asserted against (smoke-features.sh checks that
# Specnaut's block lands in an existing .gitignore, which requires there to
# be a real one to merge into).
#
# `--real` keeps the fidelity path for interactive QA, pinned exactly. No
# smoke script passes it.
set -euo pipefail

. "$(dirname "$0")/_common.sh"

NAME="${1:?usage: bootstrap-vite.sh <name> [--real]}"
MODE="${2:-fixture}"
SANDBOX_DIR="$(scenario_dir "$NAME")"

# Pinned, never @latest. Bump deliberately, having looked at the diff.
CREATE_VITE_VERSION="9.2.0"

rm -rf "$SANDBOX_DIR"
mkdir -p "$SANDBOX_ROOT"

if [ "$MODE" = "--real" ]; then
  cd "$SANDBOX_ROOT"
  npm create "vite@${CREATE_VITE_VERSION}" "$NAME" -- --template react-ts >/dev/null
  echo "✓ bootstrapped a REAL Vite React-TS scaffold at sandbox/$NAME/ (create-vite@${CREATE_VITE_VERSION})"
  echo "  (skipped npm install — not needed for specnaut UX tests)"
  exit 0
fi

mkdir -p "$SANDBOX_DIR/src" "$SANDBOX_DIR/public"
cd "$SANDBOX_DIR"

# Verbatim from the Vite react-ts template. This one matters: Specnaut merges
# its own block into an existing .gitignore, and that merge is what
# smoke-features.sh asserts. A stub here would make the check vacuous.
cat > .gitignore <<'EOF'
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
EOF

cat > package.json <<EOF
{
  "name": "$NAME",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.1.0",
    "typescript": "~6.0.0",
    "vite": "^8.2.0"
  }
}
EOF

cat > index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React + TS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

cat > vite.config.ts <<'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
EOF

cat > tsconfig.json <<'EOF'
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
EOF

cat > tsconfig.app.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "jsx": "react-jsx",
    "strict": true,
    "moduleResolution": "bundler",
    "noEmit": true
  },
  "include": ["src"]
}
EOF

cat > tsconfig.node.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
EOF

cat > src/main.tsx <<'EOF'
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
EOF

cat > src/App.tsx <<'EOF'
function App() {
  return <h1>Vite + React</h1>;
}

export default App;
EOF

cat > src/index.css <<'EOF'
:root {
  font-family: system-ui, sans-serif;
}
EOF

cat > src/App.css <<'EOF'
#root {
  margin: 0 auto;
  text-align: center;
}
EOF

cat > README.md <<'EOF'
# React + TypeScript + Vite

A minimal brownfield project used as a Specnaut test fixture.
EOF

printf '%s\n' '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 30 27H2Z"/></svg>' > public/vite.svg

echo "✓ bootstrapped a brownfield Vite-shaped project at sandbox/$NAME/"
echo "  (offline fixture — pass --real for a genuine create-vite@${CREATE_VITE_VERSION} scaffold)"
