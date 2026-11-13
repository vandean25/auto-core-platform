#!/usr/bin/env bash
# Fails the image build (or CI) unless only the exact .nvmrc Node runtime is on PATH.
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
NVMRC_FILE="${PDF_WORKER_NVMRC_PATH:-}"
if [[ -z "${NVMRC_FILE}" ]]; then
  if [[ -f /usr/local/etc/nvmrc ]]; then
    NVMRC_FILE="/usr/local/etc/nvmrc"
  elif [[ -f "${SCRIPT_DIR}/../../../.nvmrc" ]]; then
    NVMRC_FILE="${SCRIPT_DIR}/../../../.nvmrc"
  fi
fi

if [[ -z "${NVMRC_FILE}" || ! -f "${NVMRC_FILE}" ]]; then
  echo "Missing .nvmrc file for exact Node version verification" >&2
  exit 1
fi

EXPECTED_VERSION="$(<"${NVMRC_FILE}")"
EXPECTED_VERSION="${EXPECTED_VERSION//[[:space:]]/}"
if [[ -z "${EXPECTED_VERSION}" ]]; then
  echo "Empty .nvmrc file at ${NVMRC_FILE}" >&2
  exit 1
fi
EXPECTED_TAG="v${EXPECTED_VERSION}"

if command -v dpkg-query >/dev/null 2>&1; then
  if dpkg-query -W -f='${Status}\n' nodejs 2>/dev/null | grep -q 'install ok installed'; then
    echo "nodesource nodejs package is still installed" >&2
    exit 1
  fi
fi

NODE_V="$(node -v)"
NPM_V="$(npm -v)"

NODE_BINARIES=()
IFS=':' read -ra PATH_DIRS <<< "${PATH}"
for dir in "${PATH_DIRS[@]}"; do
  if [[ -n "${dir}" && -x "${dir}/node" ]]; then
    NODE_BINARIES+=("${dir}/node")
  fi
done
if [[ "${PDF_WORKER_NODE_CHECK_SYSTEM_DIRS:-1}" != "0" ]]; then
  for candidate in /usr/local/bin/node /usr/bin/node /bin/node; do
    if [[ -x "${candidate}" ]]; then
      NODE_BINARIES+=("${candidate}")
    fi
  done
fi

declare -A SEEN=()
UNIQUE=()
for binary in "${NODE_BINARIES[@]}"; do
  resolved="$(readlink -f "${binary}" 2>/dev/null || echo "${binary}")"
  if [[ -z "${SEEN[$resolved]+x}" ]]; then
    SEEN[$resolved]=1
    UNIQUE+=("${binary}")
  fi
done
NODE_BINARIES=("${UNIQUE[@]}")

NODE_PATHS="$(printf '%s ' "${NODE_BINARIES[@]}")"
NODE_PATHS="${NODE_PATHS% }"

echo "node -v: ${NODE_V}"
echo "npm -v: ${NPM_V}"
echo "which -a node: ${NODE_PATHS}"

if [[ "${NODE_V}" != "${EXPECTED_TAG}" ]]; then
  echo "Expected Node ${EXPECTED_TAG}, got ${NODE_V}" >&2
  exit 1
fi

if (( ${#NODE_BINARIES[@]} != 1 )); then
  echo "Expected exactly one node binary on PATH, found ${#NODE_BINARIES[@]}: ${NODE_PATHS}" >&2
  exit 1
fi

for path in "${NODE_BINARIES[@]}"; do
  resolved="$(readlink -f "${path}" 2>/dev/null || echo "${path}")"
  ver="$("${path}" -v)"
  if [[ "${ver}" != "${EXPECTED_TAG}" ]]; then
    echo "Node at ${path} (resolved ${resolved}) is ${ver}, expected ${EXPECTED_TAG}" >&2
    exit 1
  fi
done

EXPECTED_VERSION="${EXPECTED_VERSION}" node -e "
  const expected = process.env.EXPECTED_VERSION;
  if (process.versions.node !== expected) {
    console.error('process.versions.node=' + process.versions.node + ', expected ' + expected);
    process.exit(1);
  }
"
