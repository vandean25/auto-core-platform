#!/usr/bin/env bash

tenant_restore_validate_target() {
  local database_url="$1"
  local tenant_id="$2"
  local dry_run="${DRY_RUN:-1}"
  local host=""

  if [[ -z "${CONFIRM_TENANT_ID:-}" ]]; then
    echo "[tenant-restore] Refusing to run: set CONFIRM_TENANT_ID to the target UUID." >&2
    return 1
  fi

  if [[ ! "$tenant_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
    echo "[tenant-restore] Refusing to run: target tenant id must be a UUID." >&2
    return 1
  fi

  if [[ "$CONFIRM_TENANT_ID" != "$tenant_id" ]]; then
    echo "[tenant-restore] Refusing to run: CONFIRM_TENANT_ID must exactly match the target UUID." >&2
    return 1
  fi

  if [[ "$dry_run" != "0" && "$dry_run" != "1" ]]; then
    echo "[tenant-restore] Refusing to run: DRY_RUN must be 1 or 0." >&2
    return 1
  fi

  host="${database_url#*://}"
  host="${host##*@}"
  host="${host%%[:/?]*}"

  if [[ "$host" == *-pooler* ]]; then
    echo "[tenant-restore] Refusing to run: use a direct database URL, not a Neon pooler URL." >&2
    return 1
  fi

  if [[ "$host" == *neon.tech ]] &&
    [[ "${I_UNDERSTAND_CROSS_TENANT_BLAST_RADIUS:-}" != "yes" ]]; then
    echo "[tenant-restore] Refusing to run against neon.tech without I_UNDERSTAND_CROSS_TENANT_BLAST_RADIUS=yes." >&2
    return 1
  fi

  if [[ "$dry_run" == "1" ]]; then
    echo "[tenant-restore] DRY_RUN=1: no database commands will be executed."
  fi
}

tenant_restore_require_live_apply() {
  if [[ "${DRY_RUN:-1}" != "0" ]]; then
    echo "[tenant-restore] Refusing live apply: set DRY_RUN=0 explicitly." >&2
    return 1
  fi
}
