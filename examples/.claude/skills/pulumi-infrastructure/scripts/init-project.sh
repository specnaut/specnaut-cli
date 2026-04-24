#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Pulumi GCP TypeScript — Project Scaffold
# Creates a complete infrastructure/ directory with all resource files
# ------------------------------------------------------------------

PROJECT_NAME="${1:-my-project}"
INFRA_DIR="infrastructure"

echo "Scaffolding Pulumi project: ${PROJECT_NAME}-infra"
echo ""

# 1. Create directory structure
mkdir -p "${INFRA_DIR}/resources"

# 2. Pulumi.yaml
cat > "${INFRA_DIR}/Pulumi.yaml" << EOF
name: ${PROJECT_NAME}-infra
runtime: nodejs
description: Infrastructure as Code for ${PROJECT_NAME}
EOF

# 3. package.json
cat > "${INFRA_DIR}/package.json" << 'EOF'
{
  "name": "PROJECT_NAME-infra",
  "main": "index.ts",
  "devDependencies": { "@types/node": "^22" },
  "dependencies": { "@pulumi/pulumi": "^3", "@pulumi/gcp": "^8" }
}
EOF
sed -i '' "s/PROJECT_NAME/${PROJECT_NAME}/g" "${INFRA_DIR}/package.json"

# 4. tsconfig.json
cat > "${INFRA_DIR}/tsconfig.json" << 'EOF'
{
  "compilerOptions": {
    "strict": true,
    "outDir": "bin",
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  },
  "files": ["index.ts"],
  "include": ["resources/**/*.ts"]
}
EOF

# 5. Empty resource files
for resource in artifact-registry cloudrun cloudbuild database network redis scheduler secrets storage; do
  echo "// ${resource} resources" > "${INFRA_DIR}/resources/${resource}.ts"
done

# 6. Entrypoint
cat > "${INFRA_DIR}/index.ts" << 'EOF'
import * as pulumi from '@pulumi/pulumi'

// Import resource modules here as you implement them:
// import { service, serviceUrl } from './resources/cloudrun'
// import { dbPrivateIp } from './resources/database'
// import { redisHost } from './resources/redis'

// Stack outputs
// export const cloudRunServiceUrl = serviceUrl
EOF

echo ""
echo "Created:"
find "${INFRA_DIR}" -type f | sort | sed 's/^/  /'
echo ""
echo "Next steps:"
echo "  cd ${INFRA_DIR} && npm install"
echo "  pulumi stack init YOUR_ORG/prod"
echo "  pulumi config set gcp:project YOUR_PROJECT"
echo "  pulumi config set gcp:region europe-west1"
echo ""
echo "Don't forget to add tooling isolation to the root project:"
echo "  - eslint.config.js: add { ignores: ['infrastructure/'] }"
echo "  - .prettierignore: add infrastructure/"
echo "  - tsconfig.json: add \"infrastructure\" to exclude"
echo "  - .gitignore: add infrastructure/node_modules and infrastructure/bin"
