# Setup Guide — Pulumi GCP TypeScript Project

## Prerequisites

### Tools

| Tool       | Install                                | Verify           |
| ---------- | -------------------------------------- | ---------------- |
| Pulumi CLI | `brew install pulumi/tap/pulumi`       | `pulumi version` |
| gcloud CLI | `brew install --cask google-cloud-sdk` | `gcloud version` |
| Node.js    | Already installed (from main project)  | `node --version` |

### GCP APIs to Enable

Enable these APIs in your GCP project before deploying:

```bash
GCLOUD=gcloud  # or /opt/homebrew/share/google-cloud-sdk/bin/gcloud
PROJECT=my-project

$GCLOUD services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  --project=$PROJECT
```

### Authentication

```bash
# 1. Login to GCP
gcloud auth login

# 2. Set default project
gcloud config set project my-project

# 3. Application Default Credentials (required by Pulumi)
gcloud auth application-default login

# 4. Login to Pulumi Cloud
export PULUMI_ACCESS_TOKEN=pul-xxxxx  # or add to .env
pulumi login
```

## Initialize a New Project

```bash
# 1. Create directory
mkdir -p infrastructure/resources

# 2. Create Pulumi.yaml
cat > infrastructure/Pulumi.yaml << 'EOF'
name: my-project-infra
runtime: nodejs
description: Infrastructure as Code for My Project
EOF

# 3. Create package.json
cat > infrastructure/package.json << 'EOF'
{
  "name": "my-project-infra",
  "main": "index.ts",
  "devDependencies": { "@types/node": "^22" },
  "dependencies": { "@pulumi/pulumi": "^3", "@pulumi/gcp": "^8" }
}
EOF

# 4. Create tsconfig.json
cat > infrastructure/tsconfig.json << 'EOF'
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

# 5. Install dependencies
cd infrastructure && npm install

# 6. Initialize stack
pulumi stack init my-org/prod

# 7. Configure stack
pulumi config set gcp:project my-project
pulumi config set gcp:region europe-west1
```

## Root Project Isolation

These changes ensure the main project's tooling ignores `infrastructure/`:

### ESLint (flat config)

```js
// eslint.config.js
import { configApp } from '@adonisjs/eslint-config'
export default [{ ignores: ['infrastructure/'] }, ...configApp()]
```

### Prettier

```
# .prettierignore
infrastructure/
```

### TypeScript

```json
// tsconfig.json — add exclude
{
  "exclude": ["infrastructure"]
}
```

### Git

```
# .gitignore
infrastructure/node_modules
infrastructure/bin
```
