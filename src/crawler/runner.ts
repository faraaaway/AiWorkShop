/**
 * Runs site adapters and records the outcome (data-model.md "상태 전이", T019/T036).
 *
 * - One site never breaks another: runSite() answers with a SiteRunResult instead of throwing.
 * - In every outcome but 'ok' the stored deals and raw files are left exactly as they were.
 * - "Is this site being crawled?" is answered from two places: a registry on globalThis (Next reloads
 *   modules and bundles routes separately, so a module variable would not be shared) and a lock file
 *   data/locks/<siteId>.json, which is how the CLI and the dev server see each other.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getAdapter as getRegisteredAdapter } from '@/crawler/adapters';
import { createObscuraContext } from '@/crawler/obscura';
import type { ObscuraContext } from '@/crawler/obscura';
import { toKstIso } from '@/lib/dates';
import { getDataDir } from '@/lib/env';
import { getCrawlErrorKind } from '@/lib/errors';
import { SITE_STATE_LABELS } from '@/lib/labels';
import { normalizeDeals } from '@/lib/normalize';
import { readDeals, readRaw, readStatus, writeDeals, writeRaw, writeStatus } from '@/lib/store';
import type {
  CrawlSkipReason,
  IsoDateTime,
  RawDeal,
  RunPhase,
  SiteAdapter,
  SiteId,
  SiteState,
  SiteStatus,
} from '@/lib/types';
import { SITE_IDS, isSiteId } from '@/lib/types';

export interface SiteRunResult {
  siteId: SiteId;
  /** Result of this run; for a skipped site, the stored state as it was. */
  state: SiteState;
  /** Number of deals stored for the site after this call. */
  dealCount: number;
  message: string | null;
  /** Why nothing was run, or null when the site was crawled. */
  skipped: CrawlSkipReason | null;
}

export interface RunOptions {
  /** Ignore the block cooldown (manual retry). */
  force?: boolean;
  now?: () => Date;
  /** Progress lines; default is stderr. */
  log?: (msg: string) => void;
  getAdapter?: (id: SiteId) => SiteAdapter;
  createContext?: (adapter: SiteAdapter, signal: AbortSignal) => ObscuraContext;
}

export interface BackgroundStart {
  started: SiteId[];
  skipped: { siteId: SiteId; reason: CrawlSkipReason }[];
}

type ActivePhase = Exclude<RunPhase, 'idle'>;

interface ActiveRun {
  phase: ActivePhase;
  /** Aborted by cancelActiveRuns(); its signal is what the crawl context follows. */
  controller: AbortController;
}

interface RunRegistry {
  runs: Map<SiteId, ActiveRun>;
  /** Raised by cancelActiveRuns(); a loop that started under an older value stops. */
  cancelCount: number;
}

/** data/locks/<siteId>.json */
interface LockFile {
  pid: number;
  phase: ActivePhase;
  startedAt: IsoDateTime;
}

interface Failure {
  state: Exclude<SiteState, 'ok'>;
  message: string;
}

type Attempt = { ok: true; raws: RawDeal[] } | ({ ok: false } & Failure);

interface Outcome {
  state: SiteState;
  message: string | null;
  /** Deals just stored, or null when the stored file was not touched. */
  dealCount: number | null;
}

const HOUR_MS = 60 * 60 * 1000;
const BLOCK_COOLDOWN_HOURS = 6;
/** A lock older than this (or newer than now by this much) is left over from a dead run. */
const LOCK_STALE_MS = 20 * 60 * 1000;
const LOCK_FOLDER = 'locks';
const FILE_ENCODING = 'utf8';
const ERROR_TEXT_MAX_CHARS = 300;
const REGISTRY_KEY = Symbol.for('bf-deal-tracker.crawler.runs');

const NOT_IMPLEMENTED_MESSAGE = '수집기 준비 중입니다';
const CANCELLED: Failure = { state: 'failed', message: '수집에 실패했습니다: 사용자가 수집을 중단했습니다' };
const NO_PRODUCTS_MESSAGE = '상품을 하나도 찾지 못했습니다. 페이지 구조가 바뀌었을 수 있습니다.';

// ---------- small helpers ----------

function writeStderrLine(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function currentTime(): Date {
  return new Date();
}

function toIso(date: Date): IsoDateTime {
  const iso = toKstIso(date);
  if (iso === null) throw new Error('현재 시각을 읽지 못했습니다');
  return iso;
}

function toErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, ERROR_TEXT_MAX_CHARS);
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function getRegistry(): RunRegistry {
  const holder = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RunRegistry };
  const existing = holder[REGISTRY_KEY];
  if (existing !== undefined) return existing;
  const created: RunRegistry = { runs: new Map<SiteId, ActiveRun>(), cancelCount: 0 };
  holder[REGISTRY_KEY] = created;
  return created;
}

// ---------- lock files ----------

function lockPath(siteId: SiteId): string {
  if (!isSiteId(siteId)) throw new Error(`알 수 없는 사이트 ID입니다: ${String(siteId)}`);
  return path.join(getDataDir(), LOCK_FOLDER, `${siteId}.json`);
}

function parseLock(text: string): LockFile | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null; // an unreadable lock is a stale lock
  }
  if (typeof value !== 'object' || value === null) return null;
  const { pid, phase, startedAt } = value as Record<string, unknown>;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (phase !== 'queued' && phase !== 'running') return null;
  if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) return null;
  return { pid, phase, startedAt };
}

async function readLock(siteId: SiteId): Promise<LockFile | null> {
  const file = lockPath(siteId);
  try {
    return parseLock(await readFile(file, FILE_ENCODING));
  } catch {
    return null; // missing, or present but unreadable: either way nobody provably holds the site
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (error) {
    return getErrorCode(error) === 'EPERM'; // exists, but belongs to someone else
  }
}

/** A lock of this process only counts while the registry knows the run (`heldHere`). */
function isLiveLock(lock: LockFile, nowMs: number, heldHere: boolean): boolean {
  if (Math.abs(nowMs - Date.parse(lock.startedAt)) > LOCK_STALE_MS) return false;
  return lock.pid === process.pid ? heldHere : isProcessAlive(lock.pid);
}

async function writeLock(siteId: SiteId, phase: ActivePhase, flag: 'w' | 'wx'): Promise<void> {
  const file = lockPath(siteId);
  const lock: LockFile = { pid: process.pid, phase, startedAt: toIso(new Date()) };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(lock), { encoding: FILE_ENCODING, flag });
}

function lockWriteError(siteId: SiteId, error: unknown): Error {
  return new Error(`실행 잠금 파일(${LOCK_FOLDER}/${siteId}.json)을 쓰지 못했습니다: ${toErrorText(error)}`);
}

/** Creates the lock only when no live one exists. false: another process holds the site. */
async function takeLock(siteId: SiteId, phase: ActivePhase): Promise<boolean> {
  try {
    await writeLock(siteId, phase, 'wx');
    return true;
  } catch (error) {
    if (getErrorCode(error) !== 'EEXIST') throw lockWriteError(siteId, error);
  }
  const other = await readLock(siteId);
  if (other !== null && isLiveLock(other, Date.now(), false)) return false;
  try {
    await writeLock(siteId, phase, 'w'); // stale: take it over
    return true;
  } catch (error) {
    throw lockWriteError(siteId, error);
  }
}

/** Marks the site as held by this process. false when it is already held, here or elsewhere. */
async function claimRun(siteId: SiteId, phase: ActivePhase): Promise<boolean> {
  const { runs } = getRegistry();
  if (runs.has(siteId)) return false;
  // Reserved before the first await, so two calls in this process can never both pass the check.
  runs.set(siteId, { phase, controller: new AbortController() });
  let locked = false;
  try {
    locked = await takeLock(siteId, phase);
  } finally {
    if (!locked) runs.delete(siteId);
  }
  return locked;
}

/** Holds the site as 'running' (claiming it, or promoting our own 'queued' mark); null if it cannot. */
async function holdRunning(siteId: SiteId, queued: boolean): Promise<AbortSignal | null> {
  const { runs } = getRegistry();
  if (!queued && !(await claimRun(siteId, 'running'))) return null;
  const held = runs.get(siteId);
  if (held === undefined) return null;
  if (queued) {
    runs.set(siteId, { ...held, phase: 'running' });
    try {
      await writeLock(siteId, 'running', 'w');
    } catch (error) {
      throw lockWriteError(siteId, error);
    }
  }
  return held.controller.signal;
}

/** Safe to call twice; never throws (a lock that cannot be removed goes stale by itself). */
async function releaseRun(siteId: SiteId, log: (msg: string) => void): Promise<void> {
  if (!getRegistry().runs.delete(siteId)) return;
  try {
    const lock = await readLock(siteId);
    // Another process may have taken over a lock of ours that went stale: leave theirs alone.
    if (lock === null || lock.pid === process.pid) await rm(lockPath(siteId), { force: true });
  } catch (error) {
    log(`[${siteId}] 실행 잠금 파일을 지우지 못했습니다(시간이 지나면 무시됩니다): ${toErrorText(error)}`);
  }
}

export async function getRunPhase(siteId: SiteId): Promise<RunPhase> {
  const own = getRegistry().runs.get(siteId);
  if (own !== undefined) return own.phase;
  const lock = await readLock(siteId);
  return lock !== null && isLiveLock(lock, Date.now(), false) ? lock.phase : 'idle';
}

/**
 * Aborts the crawl this process is running and stops runAll() / a background batch before its next
 * site (the CLI calls this on Ctrl+C). The aborted site ends 'failed' with its stored deals kept.
 */
export function cancelActiveRuns(): void {
  const registry = getRegistry();
  registry.cancelCount += 1;
  for (const run of registry.runs.values()) run.controller.abort();
}

// ---------- deciding ----------

function isCoolingDown(cooldownUntil: IsoDateTime | null, now: Date): boolean {
  if (cooldownUntil === null) return false;
  const until = Date.parse(cooldownUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * `implemented` is false when the caller already knows the adapter is a stub (stored state
 * 'not_implemented'). runSite() always passes true: running a stub is how that state gets stored,
 * and running it again is how a finished adapter gets picked up.
 */
export function getSkipReason(
  status: SiteStatus,
  phase: RunPhase,
  now: Date,
  force: boolean,
  implemented: boolean,
): CrawlSkipReason | null {
  if (!status.enabled) return 'disabled';
  if (phase !== 'idle') return 'running';
  if (!implemented) return 'not_implemented';
  if (!force && isCoolingDown(status.cooldownUntil, now)) return 'cooldown';
  return null;
}

function blockedFailure(error: unknown): Failure {
  const { reason, url } = error as { reason?: unknown; url?: unknown };
  const what = typeof reason === 'string' && reason !== '' ? reason : toErrorText(error);
  const where = typeof url === 'string' && url !== '' ? ` (${url})` : '';
  return {
    state: 'blocked',
    message:
      `차단이 감지되어 수집을 멈췄습니다: ${what}${where}. ` +
      `${BLOCK_COOLDOWN_HOURS}시간 동안 자동으로 다시 시도하지 않습니다.`,
  };
}

function failureOf(error: unknown): Failure {
  const kind = getCrawlErrorKind(error);
  if (kind === 'blocked') return blockedFailure(error);
  if (kind === 'login_required') {
    return { state: 'login_required', message: `로그인이 필요해 수집하지 못했습니다: ${toErrorText(error)}` };
  }
  if (kind === 'not_implemented') return { state: 'not_implemented', message: NOT_IMPLEMENTED_MESSAGE };
  return { state: 'failed', message: `수집에 실패했습니다: ${toErrorText(error)}` };
}

// ---------- one run ----------

async function attemptCrawl(
  siteId: SiteId,
  options: RunOptions,
  signal: AbortSignal,
  log: (msg: string) => void,
): Promise<Attempt> {
  let ctx: ObscuraContext | null = null;
  try {
    const adapter = (options.getAdapter ?? getRegisteredAdapter)(siteId);
    ctx = options.createContext
      ? options.createContext(adapter, signal)
      : createObscuraContext({ adapter, signal, log: (msg) => log(`[${siteId}] ${msg}`) });
    const raws = await adapter.crawl(ctx);
    // A block the adapter swallowed must not be saved as a success, nor a cancelled run's leftovers.
    if (ctx.blocked !== null) return { ok: false, ...blockedFailure(ctx.blocked) };
    if (signal.aborted) return { ok: false, ...CANCELLED };
    return { ok: true, raws };
  } catch (error) {
    if (ctx !== null && ctx.blocked !== null) return { ok: false, ...blockedFailure(ctx.blocked) };
    if (signal.aborted) return { ok: false, ...CANCELLED };
    return { ok: false, ...failureOf(error) };
  }
}

/** Normalizes and stores a crawl result. Nothing is written unless at least one deal is usable. */
async function storeCrawl(siteId: SiteId, raws: RawDeal[], crawledAt: IsoDateTime): Promise<Outcome> {
  if (!Array.isArray(raws)) {
    const message = '수집에 실패했습니다: 수집기가 상품 목록(배열)을 돌려주지 않았습니다';
    return { state: 'failed', message, dealCount: null };
  }
  if (raws.length === 0) return { state: 'suspect_layout', message: NO_PRODUCTS_MESSAGE, dealCount: null };
  const deals = normalizeDeals(raws, siteId, crawledAt);
  if (deals.length === 0) {
    const message =
      `읽어 온 상품 ${raws.length}개에 쓸 수 있는 것이 없습니다(상품 ID·이름·주소·할인가 확인). ` +
      '페이지 구조가 바뀌었을 수 있습니다.';
    return { state: 'suspect_layout', message, dealCount: null };
  }
  try {
    await writeRaw({ siteId, crawledAt, deals: raws });
    await writeDeals({ siteId, crawledAt, deals });
  } catch (error) {
    const message = `수집에 실패했습니다: 수집한 상품을 저장하지 못했습니다 — ${toErrorText(error)}`;
    return { state: 'failed', message, dealCount: null };
  }
  return { state: 'ok', message: null, dealCount: deals.length };
}

async function countStoredDeals(siteId: SiteId, fallback: number, log: (msg: string) => void): Promise<number> {
  try {
    const file = await readDeals(siteId);
    return file === null ? 0 : file.deals.length;
  } catch (error) {
    log(`[${siteId}] 저장된 할인 목록을 세지 못해 이전 건수를 유지합니다: ${toErrorText(error)}`);
    return fallback;
  }
}

async function saveStatus(
  siteId: SiteId,
  outcome: Outcome,
  startedAt: Date,
  finishedAt: Date,
  log: (msg: string) => void,
): Promise<SiteStatus> {
  // Read again: `enabled` may have been switched while the crawl ran, and the runner never writes it.
  const latest = await readStatus(siteId);
  const next: SiteStatus = {
    ...latest,
    state: outcome.state,
    lastRunAt: toIso(startedAt),
    lastSuccessAt: outcome.state === 'ok' ? toIso(finishedAt) : latest.lastSuccessAt,
    dealCount: outcome.dealCount ?? (await countStoredDeals(siteId, latest.dealCount, log)),
    message: outcome.message,
    cooldownUntil:
      outcome.state === 'blocked'
        ? toIso(new Date(finishedAt.getTime() + BLOCK_COOLDOWN_HOURS * HOUR_MS))
        : null,
  };
  await writeStatus(next);
  return next;
}

function toResult(status: SiteStatus, skipped: CrawlSkipReason | null): SiteRunResult {
  return {
    siteId: status.siteId,
    state: status.state,
    dealCount: status.dealCount,
    message: status.message,
    skipped,
  };
}

async function crawlAndRecord(
  siteId: SiteId,
  options: RunOptions,
  signal: AbortSignal,
  startedAt: Date,
): Promise<SiteStatus> {
  const log = options.log ?? writeStderrLine;
  const now = options.now ?? currentTime;
  log(`[${siteId}] 수집을 시작합니다`);
  const attempt = await attemptCrawl(siteId, options, signal, log);
  const finishedAt = now();
  const outcome: Outcome = attempt.ok
    ? await storeCrawl(siteId, attempt.raws, toIso(finishedAt))
    : { state: attempt.state, message: attempt.message, dealCount: null };
  const saved = await saveStatus(siteId, outcome, startedAt, finishedAt, log);
  const detail = saved.message === null ? '' : ` · ${saved.message}`;
  log(`[${siteId}] ${SITE_STATE_LABELS[saved.state]} · ${saved.dealCount}건${detail}`);
  return saved;
}

/** `queued`: this process already holds the site as 'queued' (background batch). */
async function runHeldSite(siteId: SiteId, options: RunOptions, queued: boolean): Promise<SiteRunResult> {
  const log = options.log ?? writeStderrLine;
  let lastKnown: SiteStatus | null = null;
  try {
    const status = await readStatus(siteId);
    lastKnown = status;
    const startedAt = (options.now ?? currentTime)();
    const phase = queued ? 'idle' : await getRunPhase(siteId);
    const reason = getSkipReason(status, phase, startedAt, options.force === true, true);
    if (reason !== null) return toResult(status, reason);
    const signal = await holdRunning(siteId, queued);
    if (signal === null) return toResult(status, 'running');
    try {
      lastKnown = await crawlAndRecord(siteId, options, signal, startedAt);
      return toResult(lastKnown, null);
    } finally {
      await releaseRun(siteId, log);
    }
  } catch (error) {
    // Storage trouble (unreadable status file, full disk): report it, never break the other sites.
    const message = `수집을 끝내지 못했습니다: ${toErrorText(error)}`;
    log(`[${siteId}] ${message}`);
    return { siteId, state: 'failed', dealCount: lastKnown?.dealCount ?? 0, message, skipped: null };
  }
}

/** Crawls one site. Never rejects for crawl or storage problems: the result says what happened. */
export async function runSite(siteId: SiteId, options: RunOptions = {}): Promise<SiteRunResult> {
  return runHeldSite(siteId, options, false);
}

/**
 * Every site in SITE_IDS order, strictly one after another (politeness). Disabled sites and sites in
 * cooldown are reported as skipped. After cancelActiveRuns() the remaining sites are left out.
 */
export async function runAll(options: RunOptions = {}): Promise<SiteRunResult[]> {
  const registry = getRegistry();
  const cancelCountAtStart = registry.cancelCount;
  const results: SiteRunResult[] = [];
  for (const siteId of SITE_IDS) {
    if (registry.cancelCount !== cancelCountAtStart) break;
    results.push(await runSite(siteId, options));
  }
  return results;
}

/**
 * Rebuilds data/deals/<siteId>.json from data/raw/<siteId>.json with the current normalize and
 * classify rules, without network. Returns the new deal count, or null when there is no raw file.
 * The crawl time stays the raw file's (re-reading old data does not make it fresher), so the clock
 * in `options` is accepted for the agreed signature but not read.
 */
export async function renormalizeSite(
  siteId: SiteId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the agreed signature, see above
  options: Pick<RunOptions, 'now'> = {},
): Promise<number | null> {
  const raw = await readRaw(siteId);
  if (raw === null) return null;
  if ((await holdRunning(siteId, false)) === null) {
    throw new Error(`${siteId} 수집이 진행 중이라 다시 정규화할 수 없습니다. 수집이 끝난 뒤 다시 실행해 주세요.`);
  }
  try {
    const deals = normalizeDeals(raw.deals, siteId, raw.crawledAt);
    if (deals.length === 0) {
      throw new Error(
        `raw/${siteId}.json의 상품 ${raw.deals.length}개에 쓸 수 있는 것이 없어 기존 할인 목록을 그대로 두었습니다.`,
      );
    }
    await writeDeals({ siteId, crawledAt: raw.crawledAt, deals });
    await writeStatus({ ...(await readStatus(siteId)), dealCount: deals.length });
    return deals.length;
  } finally {
    await releaseRun(siteId, writeStderrLine);
  }
}

// ---------- background runs (POST /api/crawl) ----------

async function findSkipReason(siteId: SiteId, now: Date, force: boolean): Promise<CrawlSkipReason | null> {
  const status = await readStatus(siteId);
  const phase = await getRunPhase(siteId);
  return getSkipReason(status, phase, now, force, status.state !== 'not_implemented');
}

/**
 * Keeps the locks of sites still waiting from going stale while earlier sites are crawled.
 * Best effort: a lock that cannot be rewritten only matters to another process, so it is reported
 * and the batch goes on.
 */
async function refreshQueuedLocks(siteIds: readonly SiteId[], log: (msg: string) => void): Promise<void> {
  const { runs } = getRegistry();
  const waiting = siteIds.filter((siteId) => runs.get(siteId)?.phase === 'queued');
  try {
    await Promise.all(waiting.map((siteId) => writeLock(siteId, 'queued', 'w')));
  } catch (error) {
    log(`대기 중인 사이트의 실행 잠금 파일을 갱신하지 못했습니다: ${toErrorText(error)}`);
  }
}

/** Crawls the queued sites one by one. Never rejects; every site's mark is released. */
async function runQueued(siteIds: readonly SiteId[], options: RunOptions): Promise<void> {
  const log = options.log ?? writeStderrLine;
  const registry = getRegistry();
  const cancelCountAtStart = registry.cancelCount;
  for (const [index, siteId] of siteIds.entries()) {
    try {
      if (registry.cancelCount === cancelCountAtStart) {
        await refreshQueuedLocks(siteIds.slice(index + 1), log);
        await runHeldSite(siteId, options, true);
      }
    } catch (error) {
      log(`[${siteId}] 백그라운드 수집 중 오류가 났습니다: ${toErrorText(error)}`);
    } finally {
      await releaseRun(siteId, log);
    }
  }
}

/**
 * Marks every startable site 'queued' and returns at once; the crawl goes on in the background, one
 * site at a time. A site that cannot start is listed in `skipped` with the reason (for a single
 * site the caller turns that into its answer). Rejects, with nothing started, when a status file
 * is unreadable.
 */
export async function startBackgroundRun(
  target: SiteId | 'all',
  options: { force?: boolean } = {},
): Promise<BackgroundStart> {
  const force = options.force === true;
  const siteIds: readonly SiteId[] = target === 'all' ? SITE_IDS : [target];
  const now = new Date();
  const reasons = await Promise.all(siteIds.map((siteId) => findSkipReason(siteId, now, force)));

  const started: SiteId[] = [];
  const skipped: BackgroundStart['skipped'] = [];
  try {
    for (const [index, siteId] of siteIds.entries()) {
      const reason = reasons[index] ?? ((await claimRun(siteId, 'queued')) ? null : 'running');
      if (reason === null) started.push(siteId);
      else skipped.push({ siteId, reason });
    }
  } catch (error) {
    await Promise.all(started.map((siteId) => releaseRun(siteId, writeStderrLine)));
    throw error;
  }

  runQueued(started, { force }).catch((error: unknown) => {
    writeStderrLine(`백그라운드 수집이 예기치 않게 멈췄습니다: ${toErrorText(error)}`);
  });
  return { started, skipped };
}
