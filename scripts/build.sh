#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Generating Prisma client..."
npx prisma generate

echo "Bundling Lambda entry points..."
npx tsx esbuild.config.ts
