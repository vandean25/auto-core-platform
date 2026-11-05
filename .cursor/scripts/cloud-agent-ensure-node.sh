#!/usr/bin/env bash
# Align Node with repo .nvmrc via nvm and /usr/local/bin symlinks.
set -euo pipefail

relink_node_binaries() {
  local expected_node="$1"
  local nvm_node="${HOME}/.nvm/versions/node/v${expected_node}/bin"
  if [[ ! -x "${nvm_node}/node" ]]; then
    echo "nvm node v${expected_node} is not installed at ${nvm_node}" >&2
    return 1
  fi
  sudo ln -sf "${nvm_node}/node" /usr/local/bin/node
  sudo ln -sf "${nvm_node}/npm" /usr/local/bin/npm
  sudo ln -sf "${nvm_node}/npx" /usr/local/bin/npx
  if [[ -x "${nvm_node}/corepack" ]]; then
    sudo ln -sf "${nvm_node}/corepack" /usr/local/bin/corepack
  fi
}

ensure_node_matches_nvmrc() {
  local root="$1"
  local expected_node
  expected_node="$(tr -d '[:space:]' < "${root}/.nvmrc")"

  export NVM_DIR="${HOME}/.nvm"
  # shellcheck source=/dev/null
  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    . "${NVM_DIR}/nvm.sh"
  else
    echo "nvm is not installed (${NVM_DIR}/nvm.sh missing)" >&2
    return 1
  fi

  local actual_node
  actual_node="$(node -v 2>/dev/null | sed 's/^v//' || true)"
  if [[ "${actual_node}" != "${expected_node}" ]]; then
    nvm install "${expected_node}"
    nvm alias default "${expected_node}"
    nvm use "${expected_node}" >/dev/null
  fi

  relink_node_binaries "${expected_node}"

  actual_node="$(node -v | sed 's/^v//')"
  if [[ "${actual_node}" != "${expected_node}" ]]; then
    echo "node ${actual_node} still does not match .nvmrc (${expected_node})" >&2
    return 1
  fi
}
