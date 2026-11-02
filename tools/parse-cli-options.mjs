#!/usr/bin/env node
/**
 * Shared argument handling for the repository check scripts.
 *
 * `--help`/`-h` is always accepted; every other flag must be listed in the spec.
 */
const toEntries = (map, takesValue) =>
  Object.fromEntries(Object.entries(map ?? {}).map(([flag, key]) => [flag, { key, takesValue }]))

/** Stores one argument on the result and returns the index of its last token. */
function assign(result, entry, argv, index) {
  if (!entry.takesValue) {
    result[entry.key] = true
    return index
  }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${argv[index]} needs a value`)
  result[entry.key] = value
  return index + 1
}

function flagTable(spec) {
  return {
    '--help': { key: 'help', takesValue: false },
    '-h': { key: 'help', takesValue: false },
    ...toEntries(spec.boolean, false),
    ...toEntries(spec.value, true),
  }
}

export function parseCliOptions(argv, spec) {
  const known = flagTable(spec)
  const result = { ...spec.defaults, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const entry = known[argv[index]]
    if (!entry) throw new Error(`unknown argument: ${argv[index]}`)
    index = assign(result, entry, argv, index)
  }
  return result
}

/** Parses argv for a check script, prints the usage on `--help` or on a bad argument, and exits. */
export function parseCliArgs(argv, spec, usage) {
  let options
  try {
    options = parseCliOptions(argv, spec)
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`)
    process.exit(2)
  }
  if (options.help) {
    console.log(usage)
    process.exit(0)
  }
  return options
}
