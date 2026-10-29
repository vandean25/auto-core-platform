#!/usr/bin/env node
import { runWorktreeRemove } from './worktree-commands.mjs'

try {
  runWorktreeRemove(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
