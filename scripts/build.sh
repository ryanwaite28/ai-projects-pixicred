#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Generating Prisma client..."
npx prisma generate

echo "Bundling Lambda entry points..."
npx tsx esbuild.config.ts

# The service lambda has external native dependencies (Prisma client, bcrypt).
# esbuild leaves require('@prisma/client') and require('bcrypt') as-is in the
# bundle, so the real modules must be present in node_modules/ inside the zip.
echo "Copying native dependencies into service lambda package..."
SERVICE_DIR="dist/lambdas/service"
REPO_ROOT=$(pwd)
mkdir -p "${SERVICE_DIR}/node_modules"

# Prisma client (main package + generated client with target query engine binary)
cp -r node_modules/@prisma  "${SERVICE_DIR}/node_modules/"
cp -r node_modules/.prisma  "${SERVICE_DIR}/node_modules/"

# bcrypt is a native module that requires @mapbox/node-pre-gyp and its full transitive
# dep tree at runtime to locate its prebuilt binary. Walk the dep graph recursively via
# Node (no network needed — all packages are already installed by the earlier npm ci),
# then copy each resolved package into the lambda's node_modules.
echo "Resolving and copying bcrypt dependency tree..."
node -e "
  const fs = require('fs'), path = require('path');
  const ROOT = path.join(process.cwd(), 'node_modules');
  function collect(pkg, seen = new Set()) {
    if (seen.has(pkg)) return;
    seen.add(pkg);
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, pkg, 'package.json'), 'utf8'));
      Object.keys(j.dependencies || {}).forEach(d => collect(d, seen));
    } catch (_) {}
  }
  const seen = new Set();
  collect('bcrypt', seen);
  process.stdout.write([...seen].join('\n') + '\n');
" | while IFS= read -r pkg; do
    src="${REPO_ROOT}/node_modules/${pkg}"
    dst_dir="${SERVICE_DIR}/node_modules/$(dirname "${pkg}")"
    if [ -d "$src" ]; then
      mkdir -p "$dst_dir"
      cp -r "$src" "$dst_dir/"
    fi
  done

# ── Validate service lambda package ───────────────────────────────────────────
echo "Validating service lambda package..."
FAIL=0

# Key packages that must be present
for pkg in "bcrypt" "@mapbox/node-pre-gyp" "detect-libc" "nopt" "@prisma/client" ".prisma/client"; do
  if [ -d "${SERVICE_DIR}/node_modules/${pkg}" ]; then
    echo "  ✅ ${pkg}"
  else
    echo "  ❌ ${pkg}: missing" >&2
    FAIL=1
  fi
done

# bcrypt native binary (platform-specific; any .node file is acceptable locally)
if ls "${SERVICE_DIR}/node_modules/bcrypt/lib/binding"/napi-v3/bcrypt_lib.node 2>/dev/null | grep -q ".node"; then
  echo "  ✅ bcrypt native binary"
else
  echo "  ❌ bcrypt native binary missing" >&2
  FAIL=1
fi

# Prisma query engine for Lambda runtime (rhel-openssl — required for AWS Lambda)
if ls "${SERVICE_DIR}/node_modules/.prisma/client"/libquery_engine-rhel*.node 2>/dev/null | grep -q ".node"; then
  echo "  ✅ Prisma query engine (rhel-openssl)"
else
  echo "  ❌ Prisma query engine for Lambda (rhel-openssl) missing" >&2
  echo "     Check that schema.prisma binaryTargets includes 'rhel-openssl-1.0.x'" >&2
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "" >&2
  echo "❌ Service lambda package validation FAILED" >&2
  exit 1
fi
echo "✅ Service lambda package validation passed"
