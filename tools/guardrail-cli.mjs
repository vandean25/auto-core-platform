export function fail(message, code) {
  console.error(message)
  process.exit(code)
}

export function printMultisetGrowth({ label, base, grown, exitMessage }) {
  console.error(`${label} grew against ${base}:`)
  for (const result of grown) {
    console.error(`  ${result.file}`)
    for (const identity of result.growth) console.error(`    + ${identity}`)
  }
  fail(exitMessage, 1)
}
