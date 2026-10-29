/**
 * Mock runner: psql missing, docker exec available for worktree Postgres.
 * @param {string[]} calls
 */
export function createDockerExecCommandRunner(calls) {
  return (command, args) => {
    calls.push([command, ...args].join(' '))
    if (command === 'where' || command === 'which') {
      return { status: args[0] === 'docker' ? 0 : 1, stdout: '' }
    }
    if (command === 'docker' && args[0] === 'ps') {
      return { status: 0, stdout: 'abc123\n' }
    }
    if (command === 'docker' && args[0] === 'exec') {
      return { status: 0, stdout: '' }
    }
    return { status: 1, stdout: '' }
  }
}
