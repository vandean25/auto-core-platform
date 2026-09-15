import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isDirectRun({
  moduleUrl,
  moduleFilename,
  argv1,
}) {
  if (!argv1) {
    return false;
  }

  const resolvedArgv = resolve(argv1);
  return (
    moduleFilename === argv1 ||
    moduleFilename === resolvedArgv ||
    moduleUrl === pathToFileURL(resolvedArgv).href
  );
}
