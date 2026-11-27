/**
 * Crawl from the terminal (specs/001-bf-deal-tracker/quickstart.md):
 *
 *   npm run crawl -- --site <siteId|all> [--force] [--renormalize]
 *
 * One line per site on stdout, progress on stderr. Exit code: 0 fine · 1 a site ended failed /
 * blocked / suspect_layout / login_required (or the run was interrupted) · 2 wrong arguments.
 * All the work is in '@/crawler/runner'; this file only reads arguments and prints.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cancelActiveRuns, renormalizeSite, runAll, runSite } from '@/crawler/runner';
import type { RunOptions, SiteRunResult } from '@/crawler/runner';
import { SITE_LABELS, SITE_STATE_LABELS } from '@/lib/labels';
import type { CrawlSkipReason, SiteId, SiteState } from '@/lib/types';
import { SITE_IDS, isSiteId } from '@/lib/types';

export type CliCommand =
  | { kind: 'run'; target: SiteId | 'all'; force: boolean; renormalize: boolean }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export const EXIT_OK = 0;
export const EXIT_PROBLEM = 1;
export const EXIT_USAGE = 2;

const ALL_SITES = 'all';
const SITE_FLAG = '--site';
const SITE_FLAG_WITH_VALUE = `${SITE_FLAG}=`;
const FLAG_PREFIX = '--';
const HELP_FLAGS: readonly string[] = ['--help', '-h'];
/** States that mean "this crawl did not produce fresh data". */
const PROBLEM_STATES: readonly SiteState[] = ['failed', 'blocked', 'suspect_layout', 'login_required'];

const SKIP_LABELS: Readonly<Record<CrawlSkipReason, string>> = {
  cooldown: '쿨다운 중 — --force로 무시할 수 있습니다',
  disabled: '꺼진 사이트',
  running: '이미 수집 중',
  not_implemented: '수집기 준비 중',
};

export const USAGE = [
  '사용법: npm run crawl -- --site <사이트 ID|all> [--force] [--renormalize]',
  '',
  `  --site <id>     수집할 사이트: ${SITE_IDS.join(', ')} 또는 ${ALL_SITES}(켜진 사이트 전부, 차례대로)`,
  '  --force         차단 뒤 쿨다운(6시간)을 무시하고 다시 시도',
  '  --renormalize   사이트에 접속하지 않고 data/raw 원본으로 할인 목록을 다시 만듦',
  '  --help          이 안내 보기',
].join('\n');

function usageError(message: string): CliCommand {
  return { kind: 'error', message };
}

/** Pure: `argv` is what follows the script name (process.argv.slice(2)). */
export function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.some((arg) => HELP_FLAGS.includes(arg))) return { kind: 'help' };

  const sites: string[] = [];
  let force = false;
  let renormalize = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') force = true;
    else if (arg === '--renormalize') renormalize = true;
    else if (arg.startsWith(SITE_FLAG_WITH_VALUE)) sites.push(arg.slice(SITE_FLAG_WITH_VALUE.length));
    else if (arg === SITE_FLAG) {
      index += 1;
      sites.push(argv[index] ?? '');
    } else return usageError(`알 수 없는 인자입니다: ${arg}`);
  }

  if (sites.length === 0) return usageError(`${SITE_FLAG} <사이트 ID|${ALL_SITES}>를 지정해 주세요.`);
  if (sites.length > 1) return usageError(`${SITE_FLAG}는 한 번만 쓸 수 있습니다.`);
  const [site] = sites;
  if (site === '' || site.startsWith(FLAG_PREFIX)) {
    return usageError(`${SITE_FLAG} 뒤에 사이트 ID가 필요합니다.`);
  }
  if (site !== ALL_SITES && !isSiteId(site)) return usageError(`알 수 없는 사이트입니다: ${site}`);
  return { kind: 'run', target: site, force, renormalize };
}

function onOneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `무신사: 정상 · 123건` / `무신사: 차단됨 · 5건 · <message>` / `무신사: 건너뜀(<why>) · …`. */
export function formatResultLine(result: SiteRunResult): string {
  const name = SITE_LABELS[result.siteId];
  const state = SITE_STATE_LABELS[result.state];
  if (result.skipped !== null) {
    return `${name}: 건너뜀(${SKIP_LABELS[result.skipped]}) · 마지막 상태 ${state} · 저장된 ${result.dealCount}건`;
  }
  const detail = result.message === null ? '' : ` · ${onOneLine(result.message)}`;
  return `${name}: ${state} · ${result.dealCount}건${detail}`;
}

/** A skipped site was not crawled, so its old state does not count. */
export function getExitCode(results: readonly SiteRunResult[]): number {
  const hasProblem = results.some(
    (result) => result.skipped === null && PROBLEM_STATES.includes(result.state),
  );
  return hasProblem ? EXIT_PROBLEM : EXIT_OK;
}

function printLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function printErrorLine(text: string): void {
  process.stderr.write(`${text}\n`);
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function crawl(target: SiteId | 'all', force: boolean): Promise<number> {
  const options: RunOptions = { force, log: printErrorLine };
  const results = target === ALL_SITES ? await runAll(options) : [await runSite(target, options)];
  for (const result of results) printLine(formatResultLine(result));
  return getExitCode(results);
}

async function renormalize(target: SiteId | 'all'): Promise<number> {
  const siteIds: readonly SiteId[] = target === ALL_SITES ? SITE_IDS : [target];
  let exitCode = EXIT_OK;
  for (const siteId of siteIds) {
    const name = SITE_LABELS[siteId];
    try {
      const count = await renormalizeSite(siteId);
      printLine(count === null ? `${name}: 원본(data/raw) 파일이 없어 건너뜀` : `${name}: 다시 정규화 · ${count}건`);
    } catch (error) {
      exitCode = EXIT_PROBLEM;
      printLine(`${name}: 다시 정규화 실패 · ${onOneLine(toErrorText(error))}`);
    }
  }
  return exitCode;
}

/** Runs the command and returns the exit code; never calls process.exit, so output is not cut off. */
export async function main(argv: readonly string[]): Promise<number> {
  const command = parseCliArgs(argv);
  if (command.kind === 'help') {
    printLine(USAGE);
    return EXIT_OK;
  }
  if (command.kind === 'error') {
    printErrorLine(`${command.message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  let interrupted = false;
  // once: a second Ctrl+C gets Node's default behaviour and ends the process immediately.
  const onInterrupt = (): void => {
    interrupted = true;
    printErrorLine('중단 요청을 받았습니다. 진행 중인 요청을 멈추고 상태를 정리합니다…');
    cancelActiveRuns();
  };
  process.once('SIGINT', onInterrupt);
  try {
    const exitCode = command.renormalize
      ? await renormalize(command.target)
      : await crawl(command.target, command.force);
    if (!interrupted) return exitCode;
    printErrorLine('중단되어 남은 사이트는 수집하지 않았습니다.');
    return EXIT_PROBLEM;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }
}

/** True for `tsx src/crawler/cli.ts`, false when a test or another module imports this file. */
function isRunDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const here = path.resolve(fileURLToPath(import.meta.url));
  const started = path.resolve(entry);
  // Windows paths differ only by letter case between shells (c:\ vs C:\).
  return process.platform === 'win32' ? here.toLowerCase() === started.toLowerCase() : here === started;
}

if (isRunDirectly()) {
  main(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      printErrorLine(`수집 명령이 예기치 않게 멈췄습니다: ${toErrorText(error)}`);
      process.exitCode = EXIT_PROBLEM;
    },
  );
}
