/**
 * Automatic crawling (spec FR-002a): while the app server is running, every enabled site is
 * crawled on the clock — with the default interval of 60 minutes, at every full hour (x:00, Korean
 * time). The interval comes from BF_AUTO_CRAWL_MINUTES (default 60, "0" or "off" disables it).
 * Runs never overlap: the next one is scheduled only after the previous one has ended, and
 * runAll() itself crawls the sites one at a time.
 */
import { runAll, type SiteRunResult } from '@/crawler/runner';
import { toKstIso } from '@/lib/dates';
import type { AutoCrawlInfo } from '@/lib/types';

export const AUTO_CRAWL_ENV = 'BF_AUTO_CRAWL_MINUTES';
export const DEFAULT_INTERVAL_MINUTES = 60;
/** A full run takes many minutes and every run visits every site, so shorter intervals are refused. */
const MIN_INTERVAL_MINUTES = 10;
const MS_PER_MINUTE = 60_000;
/** Korea has no daylight saving time, so clock boundaries are a fixed offset from UTC. */
const KST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE;
const DISABLED_VALUES: readonly string[] = ['0', 'off', 'false', 'no'];
const WHOLE_NUMBER = /^\d+$/;

export interface AutoCrawlOptions {
  intervalMinutes: number;
  /** Test seams. Defaults: runAll, stdout, the real clock and timers. */
  runAllFn?: () => Promise<SiteRunResult[]>;
  log?: (msg: string) => void;
  now?: () => Date;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface AutoCrawlHandle {
  readonly intervalMinutes: number;
  /** When the next run starts; null while a run is going or after stop(). */
  readonly nextRunAt: Date | null;
  stop(): void;
}

/** BF_AUTO_CRAWL_MINUTES -> minutes, or null when automatic crawling is switched off. */
export function parseIntervalMinutes(raw: string | undefined): number | null {
  const value = raw?.trim().toLowerCase() ?? '';
  if (value === '') return DEFAULT_INTERVAL_MINUTES;
  if (DISABLED_VALUES.includes(value)) return null;
  if (!WHOLE_NUMBER.test(value)) return DEFAULT_INTERVAL_MINUTES;
  return Math.max(MIN_INTERVAL_MINUTES, Number(value));
}

/**
 * Milliseconds until the next clock boundary of the interval, counted from midnight in Korean
 * time: every 60 minutes -> the next full hour, every 30 -> :00 or :30, every 6 hours -> 0, 6,
 * 12 or 18 o'clock. Exactly on a boundary, the wait is one whole interval.
 */
export function computeAlignedDelayMs(nowMs: number, intervalMs: number): number {
  const sinceBoundary = (((nowMs + KST_OFFSET_MS) % intervalMs) + intervalMs) % intervalMs;
  return intervalMs - sinceBoundary;
}

function writeLine(msg: string): void {
  process.stdout.write(`[자동 수집] ${msg}\n`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarize(results: readonly SiteRunResult[]): string {
  const succeeded = results.filter((result) => result.state === 'ok' && result.skipped === null).length;
  const deals = results.reduce((sum, result) => sum + result.dealCount, 0);
  return `${results.length}곳 중 ${succeeded}곳 수집 성공, 저장된 할인 ${deals}건`;
}

export function startAutoCrawl(options: AutoCrawlOptions): AutoCrawlHandle {
  const { intervalMinutes } = options;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
    throw new Error(`자동 수집 주기는 1분 이상이어야 합니다: ${intervalMinutes}`);
  }
  const runAllFn = options.runAllFn ?? ((): Promise<SiteRunResult[]> => runAll());
  const log = options.log ?? writeLine;
  const now = options.now ?? ((): Date => new Date());
  const setTimer = options.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const intervalMs = intervalMinutes * MS_PER_MINUTE;

  let stopped = false;
  let timer: unknown = null;
  let nextRunAt: Date | null = null;

  /** Books the next clock boundary. A boundary that passed while a run was going is skipped. */
  const scheduleNext = (): void => {
    if (stopped) return;
    const nowMs = now().getTime();
    const delayMs = computeAlignedDelayMs(nowMs, intervalMs);
    nextRunAt = new Date(nowMs + delayMs);
    timer = setTimer(() => {
      void tick();
    }, delayMs);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    timer = null;
    nextRunAt = null;
    try {
      log('전체 수집을 시작합니다');
      log(`전체 수집 완료: ${summarize(await runAllFn())}`);
    } catch (error) {
      // One failed run must not end the schedule; the next boundary tries again.
      log(`전체 수집 중 오류가 났습니다: ${describeError(error)}`);
    } finally {
      scheduleNext();
    }
  };

  scheduleNext();
  if (nextRunAt !== null) log(`${intervalMinutes}분마다 수집합니다. 다음 수집: ${toKstIso(nextRunAt) ?? '알 수 없음'}`);

  return {
    intervalMinutes,
    get nextRunAt(): Date | null {
      return nextRunAt;
    },
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      nextRunAt = null;
    },
  };
}

// ---------- one schedule per server process ----------

interface AutoCrawlGlobal {
  __bfAutoCrawl?: AutoCrawlHandle | null;
}

/**
 * Starts the schedule once per process (the handle lives on globalThis because the Next dev
 * server reloads modules). Returns null when automatic crawling is switched off.
 */
export function ensureAutoCrawl(env: NodeJS.ProcessEnv = process.env): AutoCrawlHandle | null {
  const store = globalThis as AutoCrawlGlobal;
  if (store.__bfAutoCrawl !== undefined) return store.__bfAutoCrawl;
  const intervalMinutes = parseIntervalMinutes(env[AUTO_CRAWL_ENV]);
  store.__bfAutoCrawl = intervalMinutes === null ? null : startAutoCrawl({ intervalMinutes });
  if (intervalMinutes === null) writeLine(`${AUTO_CRAWL_ENV} 설정으로 꺼져 있습니다`);
  return store.__bfAutoCrawl;
}

/** For GET /api/status: null when no schedule is running in this process. */
export function getAutoCrawlInfo(): AutoCrawlInfo | null {
  const handle = (globalThis as AutoCrawlGlobal).__bfAutoCrawl;
  if (handle === undefined || handle === null) return null;
  return {
    intervalMinutes: handle.intervalMinutes,
    nextRunAt: handle.nextRunAt === null ? null : toKstIso(handle.nextRunAt),
  };
}
