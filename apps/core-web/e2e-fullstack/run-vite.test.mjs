import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { EventEmitter } from 'node:events'

test('full-stack Vite listens on IPv4 loopback', async () => {
  const originalRead = fs.readFileSync
  const read = mock.method(fs, 'readFileSync', (path, ...args) =>
    String(path).endsWith('fixture.json') ? '{"authToken":"test"}' : originalRead(path, ...args),
  )
  const spawn = mock.method(childProcess, 'spawn', () => new EventEmitter())
  syncBuiltinESMExports()
  try {
    await import('./run-vite.mjs')
    const args = spawn.mock.calls[0].arguments[1]
    assert.deepEqual(args.slice(0, 3), ['vite', '--host', '127.0.0.1'])
  } finally {
    read.mock.restore()
    spawn.mock.restore()
    syncBuiltinESMExports()
  }
})
