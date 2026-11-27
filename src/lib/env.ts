import { existsSync } from 'node:fs';
import path from 'node:path';

const ENV_FILE = '.env.local';
let envFileLoaded = false;

/** Next.js loads .env.local by itself; the tsx CLI does not, so load it once here. */
function loadEnvFileOnce(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const envPath = path.resolve(process.cwd(), ENV_FILE);
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${ENV_FILE}을 읽지 못했습니다: ${reason}`);
  }
}

/** Absolute path of the Obscura executable (OBSCURA_PATH). Throws a clear message when missing. */
export function getObscuraPath(): string {
  if (!process.env.OBSCURA_PATH) loadEnvFileOnce();
  const value = process.env.OBSCURA_PATH?.trim();
  if (!value) {
    throw new Error(
      'OBSCURA_PATH가 설정되지 않았습니다. .env.example을 .env.local로 복사하고 ' +
        'Obscura 실행 파일 경로를 적어 주세요 (specs/001-bf-deal-tracker/quickstart.md §1).',
    );
  }
  if (!existsSync(value)) {
    throw new Error(`OBSCURA_PATH가 가리키는 파일이 없습니다: ${value}`);
  }
  return value;
}

/** Root folder for crawled data (git-ignored). Override with BF_DATA_DIR for tests. */
export function getDataDir(): string {
  loadEnvFileOnce();
  return path.resolve(process.cwd(), process.env.BF_DATA_DIR?.trim() || 'data');
}
