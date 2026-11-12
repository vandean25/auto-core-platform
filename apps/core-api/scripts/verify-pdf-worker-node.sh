#!/usr/bin/env bash
# Fails the image build (or CI) unless only a Node 26 runtime is on PATH.
set -euo pipefail

EXPECTED_MAJOR="${PDF_WORKER_NODE_MAJOR:-26}"
EXPECTED_PREFIX="v${EXPECTED_MAJOR}."

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

if [[ "${NODE_V}" != "${EXPECTED_PREFIX}"* ]]; then
  echo "Expected Node ${EXPECTED_PREFIX}*, got ${NODE_V}" >&2
  exit 1
fi

if (( ${#NODE_BINARIES[@]} == 0 )); then
  echo "No node binary found on PATH" >&2
  exit 1
fi

for path in "${NODE_BINARIES[@]}"; do
  resolved="$(readlink -f "${path}" 2>/dev/null || echo "${path}")"
  ver="$("${path}" -v)"
  if [[ "${ver}" != "${EXPECTED_PREFIX}"* ]]; then
    echo "Node at ${path} (resolved ${resolved}) is ${ver}, expected ${EXPECTED_PREFIX}*" >&2
    exit 1
  fi
done

node -e "
  const expectedMajor = Number(process.env.PDF_WORKER_NODE_MAJOR || '${EXPECTED_MAJOR}');
  const [major] = process.versions.node.split('.').map(Number);
  if (major !== expectedMajor) {
    console.error('process.versions.node=' + process.versions.node + ', expected major ' + expectedMajor);
    process.exit(1);
  }
"
