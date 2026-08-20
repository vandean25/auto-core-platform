import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE_API_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CORE_API_ROOT, '../..');

const LEFTOVER_ENTRYPOINTS = [
  'verify_po_check.ts',
  'repro_receive.ts',
  'check_db.js',
  'scripts/fix-syntax.cjs',
  'scripts/fix-syntax2.cjs',
  'scripts/migrate-auth.mjs',
  'scripts/migrate-auth-v2.mjs',
  'test/sales-order-repro.e2e-spec.ts',
] as const;

function walkFiles(dir: string, predicate: (filePath: string) => boolean): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      files.push(...walkFiles(fullPath, predicate));
      continue;
    }
    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('dead code hygiene (AUT-139)', () => {
  it('does not keep an unwired speech-note module in src/', () => {
    expect(fs.existsSync(path.join(CORE_API_ROOT, 'src/speech-note'))).toBe(
      false,
    );
  });

  it('AppModule wires VoiceTranslationModule and does not import SpeechNote', () => {
    const source = fs.readFileSync(
      path.join(CORE_API_ROOT, 'src/app.module.ts'),
      'utf8',
    );
    expect(source).toContain('VoiceTranslationModule');
    expect(source).not.toMatch(/SpeechNote/);
  });

  it('does not keep unused ApiKeyGuard', () => {
    expect(
      fs.existsSync(
        path.join(CORE_API_ROOT, 'src/common/guards/api-key.guard.ts'),
      ),
    ).toBe(false);
  });

  it('registers JwtAuthGuard as the global APP_GUARD', () => {
    const source = fs.readFileSync(
      path.join(CORE_API_ROOT, 'src/app.module.ts'),
      'utf8',
    );
    expect(source).toContain('useClass: JwtAuthGuard');
    expect(source).not.toMatch(/ApiKeyGuard/);
  });

  it('does not set unused API_KEY in tests', () => {
    const testFiles = walkFiles(CORE_API_ROOT, (filePath) =>
      /\.(spec|e2e-spec)\.ts$/.test(filePath),
    );
    const offenders = testFiles.filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      return /process\.env\.API_KEY\s*=/.test(content);
    });
    expect(offenders.map((filePath) => path.relative(CORE_API_ROOT, filePath))).toEqual(
      [],
    );
  });

  it('does not inject retired API_KEY values in Cloud Build', () => {
    const cloudBuild = fs.readFileSync(
      path.join(REPO_ROOT, 'cloudbuild.yaml'),
      'utf8',
    );
    expect(cloudBuild).not.toMatch(/(?:^|[^A-Z0-9_])API_KEY(?:[^A-Z0-9_]|$)/);
    expect(cloudBuild).not.toMatch(/\bVITE_API_KEY\b/);
    expect(cloudBuild).toContain('VITE_FIREBASE_API_KEY');
  });

  it('has no leftover one-off repro or fix-syntax entrypoints', () => {
    const present = LEFTOVER_ENTRYPOINTS.filter((relativePath) =>
      fs.existsSync(path.join(CORE_API_ROOT, relativePath)),
    );
    expect(present).toEqual([]);
    expect(fs.existsSync(path.join(REPO_ROOT, 'test_syntax.ts'))).toBe(false);
  });

  it('does not document unused SpeechNote OpenAI env vars', () => {
    const envExample = fs.readFileSync(
      path.join(CORE_API_ROOT, '.env.example'),
      'utf8',
    );
    const envConfig = fs.readFileSync(
      path.join(CORE_API_ROOT, 'src/config/env.ts'),
      'utf8',
    );
    expect(envExample).not.toMatch(/SPEECH_NOTE/);
    expect(envExample).not.toMatch(/OPENAI_API_KEY/);
    expect(envConfig).not.toMatch(/SPEECH_NOTE/);
    expect(envConfig).not.toMatch(/OPENAI_API_KEY/);
  });

  it('does not depend on openai after SpeechNote removal', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(CORE_API_ROOT, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.openai).toBeUndefined();
  });
});
