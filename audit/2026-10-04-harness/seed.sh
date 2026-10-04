#!/bin/bash
# Seeds the archive-orders defects into a sandbox orders-service (uncommitted changes).
# usage: seed.sh <sandbox/orders-service>
set -e
cd "$1"
git apply "$(dirname "$0")/seed.patch"
printf '  - include:\n      file: db/changelog/2026-10-04-008-orders-archived-at.yml\n' >> src/main/resources/db/changelog/db.changelog-master.yml
git status --short
