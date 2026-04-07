#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function parseArgs(argv) {
  const out = {
    mapping: 'secrets/gsm-mapping.json',
    target: undefined,
    projectId: undefined,
    dryRun: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--mapping') {
      if (i + 1 >= argv.length) throw new Error('Missing value for --mapping')
      out.mapping = argv[++i]
    } else if (arg === '--target') {
      if (i + 1 >= argv.length) throw new Error('Missing value for --target')
      out.target = argv[++i]
    } else if (arg === '--project') {
      if (i + 1 >= argv.length) throw new Error('Missing value for --project')
      out.projectId = argv[++i]
    }
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--help' || arg === '-h') out.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return out
}

function printHelp() {
  console.log(`Usage:
  node tools/pull-secrets-from-gsm.mjs [--mapping <path>] [--target <name>] [--project <projectId>] [--dry-run]

Examples:
  node tools/pull-secrets-from-gsm.mjs --mapping secrets/gsm-mapping.json
  node tools/pull-secrets-from-gsm.mjs --mapping secrets/gsm-mapping.json --target core-web
  node tools/pull-secrets-from-gsm.mjs --project auto-core-platform-vande
`)
}

function runGcloud(secretName, projectId, version = 'latest') {
  const args = [
    'secrets',
    'versions',
    'access',
    String(version),
    `--secret=${secretName}`,
    `--project=${projectId}`,
    '--quiet',
  ]

  if (process.platform === 'win32') {
    return execFileSync('gcloud.cmd', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
  }
  return execFileSync('gcloud', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function serializeEnvValue(raw) {
  const value = raw.replace(/\r?\n$/, '')
  const needsQuoting = /[\s#"'`\\]/.test(value) || value.includes('\n')
  if (!needsQuoting) return value
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"')}"`
}

function resolveSecretRef(ref, defaultProjectId) {
  if (typeof ref === 'string') {
    return { name: ref, version: 'latest', projectId: defaultProjectId }
  }
  if (!ref || typeof ref !== 'object' || !ref.name) {
    throw new Error('Invalid secret mapping. Expected string or object with { name }.')
  }
  return {
    name: ref.name,
    version: ref.version ?? 'latest',
    projectId: ref.projectId ?? defaultProjectId,
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const repoRoot = process.cwd()
  const mappingPath = path.resolve(repoRoot, options.mapping)
  if (!fs.existsSync(mappingPath)) {
    throw new Error(`Mapping file not found: ${mappingPath}`)
  }

  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'))
  const defaultProjectId = options.projectId ?? mapping.projectId
  if (!defaultProjectId) {
    throw new Error('Missing projectId. Set it in mapping file or pass --project <projectId>.')
  }
  if (!Array.isArray(mapping.targets) || mapping.targets.length === 0) {
    throw new Error('Mapping file must define a non-empty "targets" array.')
  }

  const targets = options.target
    ? mapping.targets.filter((t) => t.name === options.target)
    : mapping.targets
  if (targets.length === 0) {
    throw new Error(`No targets matched "${options.target}".`)
  }

  for (const target of targets) {
    if (!target.name || !target.output || !target.secrets) {
      throw new Error('Each target requires { name, output, secrets }.')
    }
    const outPath = path.resolve(repoRoot, target.output)
    const lines = []
    const entries = Object.entries(target.secrets)
    for (const [envKey, ref] of entries) {
      const secretRef = resolveSecretRef(ref, defaultProjectId)
      const raw = runGcloud(secretRef.name, secretRef.projectId, secretRef.version)
      lines.push(`${envKey}=${serializeEnvValue(raw)}`)
    }
    const fileBody = `${lines.join('\n')}\n`

    if (options.dryRun) {
      console.log(`[dry-run] ${target.name} -> ${target.output} (${entries.length} values)`)
      continue
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, fileBody, 'utf8')
    console.log(`Wrote ${target.output} (${entries.length} values)`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
