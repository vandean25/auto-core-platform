#!/usr/bin/env node
import { runWorktreeSetup } from './worktree-commands.mjs'

runWorktreeSetup(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
