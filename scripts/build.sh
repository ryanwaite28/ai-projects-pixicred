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
mkdir -p "${SERVICE_DIR}/node_modules"
cp -r node_modules/@prisma  "${SERVICE_DIR}/node_modules/"
cp -r node_modules/.prisma  "${SERVICE_DIR}/node_modules/"
cp -r node_modules/bcrypt   "${SERVICE_DIR}/node_modules/"
