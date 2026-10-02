#!/usr/bin/env node
/**
 * Pre-deploy guard (AUT-347): ensure Vite dynamic-import chunks and index.html
 * asset references exist under apps/core-web/dist before Firebase Hosting deploy.
 */
import path from 'node:path';
import { verifyBuildChunks } from './verify-build-chunks-lib.mjs';

function parseArgs(argv) {
  let distDir = path.join('apps', 'core-web', 'dist');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dist' && argv[i + 1]) {
      distDir = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node tools/verify-build-chunks.mjs [--dist <path>]

Default dist: apps/core-web/dist`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { distDir };
}

const { distDir } = parseArgs(process.argv.slice(2));
const result = verifyBuildChunks({ distDir });
console.log(
  `Build chunk verification passed (${result.dynamicChunkCount} dynamic chunks, ${result.indexReferenceCount} index.html references) for ${result.distDir}`,
);
