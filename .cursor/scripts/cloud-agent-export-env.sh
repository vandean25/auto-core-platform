#!/usr/bin/env bash
# Shell exports for Cloud Agent sessions (sourced from /etc/profile.d on install).
set -euo pipefail

export PATH="/usr/local/bin:${PATH}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export DATABASE_URL="postgresql://acp_cloud:acp_cloud_local_only@127.0.0.1:5432/core_platform"
export ACP_E2E_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/auto_core_test"
