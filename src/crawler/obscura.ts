/**
 * The ONLY module allowed to start the Obscura headless browser (constitution II).
 * It implements CrawlContext for the site adapters: one `obscura fetch` process per request,
 * a polite random wait between requests, a request cap, and block detection that latches.
 * Verified against obscura 0.2.7 (specs/001-bf-deal-tracker/research.md R2, R4, R5).
 */
import { execFile, type ExecFileException } from 'node:child_process';
import { getObscuraPath } from '@/lib/env';
import { BlockedError, RequestLimitError } from '@/lib/errors';
import type { CrawlContext, FetchHtmlOptions, SiteAdapter } from '@/lib/types';

const DEFAULT_MIN_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 4_000;
/**
 * Obscura's --timeout (navigation deadline). 30 s was too short in live runs: W Concept product
 * pages and the Posty home page take 35 s or more to finish loading.
 */
const DEFAULT_TIMEOUT_SEC = 90;
/**
 * The process is killed this long after Obscura's own --timeout (+ --wait) should have ended it.
 * It is only a backstop against a hung process: pages that scroll and wait (preEval) took about
 * 80 s in live runs with --timeout 30 --wait 25, so the margin is generous.
 */
const KILL_GRACE_SEC = 120;
const MS_PER_SEC = 1_000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
/** Weak block signals and Cloudflare markers only count in a body shorter than this. */
const SHORT_BODY_MAX_CHARS = 20_000;
const BODY_PREVIEW_CHARS = 120;
const STDERR_DETAIL_MAX_CHARS = 300;
const BLOCKING_HTTP_STATUSES: readonly number[] = [403, 429];
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR_MIN = 500;
/** Some APIs prefix their JSON with a UTF-8 byte order mark, which JSON.parse rejects. */
const BYTE_ORDER_MARK = 0xfeff;

/** Count at any size when found in <title> or <h1>; in a short body also in the visible text. */
const STRONG_PHRASES: readonly string[] = [
  'Just a moment',
  'Attention Required',
  'Access Denied',
  '로봇이 아닙니다',
  '비정상적인 접근',
  '비정상적인 요청',
  '자동입력 방지',
  '접근이 차단',
];
const CHALLENGE_MARKERS: readonly string[] = ['cf-chl-', 'challenge-platform'];
/** Most specific first, so the reported reason is the precise one. */
const WEAK_SIGNALS: readonly string[] = ['recaptcha', 'hcaptcha', 'cf-challenge', 'captcha'];

const TITLE_OR_MAIN_HEADING = /<(title|h1)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const INVISIBLE_BLOCKS = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ANY_TAG = /<[^>]*>/g;
/** Cloudflare's passive "JS detections" script sits on normal pages; it is not a challenge. */
const PASSIVE_CLOUDFLARE_SCRIPT = /challenge-platform\/(?:h\/[a-z]\/)?scripts\/jsd/g;
const ROBOTS_DISALLOW = /blocked by robots\.txt/i;
const HTTP_STATUS = /\bHTTP (\d{3})\b/;
const TIMEOUT_TEXT = /timed? ?out/i;

export type ObscuraExecFailure = 'timeout' | 'aborted' | 'spawn';

export interface ObscuraExecResult {
  /** Exit code, or null when the process did not exit by itself (see `failure`). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** 'timeout': hard kill · 'aborted': killed by the signal · 'spawn': could not run / output overflow. */
  failure: ObscuraExecFailure | null;
}

export interface ObscuraExecOptions {
  /** Hard kill timeout. */
  timeoutMs: number;
  signal: AbortSignal;
}

export type ObscuraExec = (
  file: string,
  args: readonly string[],
  options: ObscuraExecOptions,
) => Promise<ObscuraExecResult>;

export interface ObscuraContext extends CrawlContext {
  /** Requests made so far in this run (failed ones included). */
  readonly requestCount: number;
  /** The first block detected in this run; once set, every call rejects with it. */
  readonly blocked: BlockedError | null;
}

export interface ObscuraContextOptions {
  adapter: Pick<SiteAdapter, 'id' | 'stealth' | 'obeyRobots' | 'maxRequests'>;
  /** Cancels the run from outside (the context's own signal follows it). */
  signal?: AbortSignal;
  log?: (msg: string) => void;
  /** Test seams. Defaults: execFile, an abortable setTimeout, Math.random, 2000-4000 ms, 90 s. */
  exec?: ObscuraExec;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Value of Obscura's --timeout (whole seconds). */
  timeoutSec?: number;
  /** Called on the first request only (default: getObscuraPath). */
  resolveBinary?: () => string;
}

interface RequestSpec {
  url: string;
  /** null for --eval: with an explicit --dump Obscura prints the dump instead of the eval result. */
  dump: 'html' | 'original' | null;
  waitSec?: number;
  js?: string;
}

type JsonParse = { ok: true; value: unknown } | { ok: false };

// ---------- block detection (research R4) ----------

function squash(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

function findStrongPhrase(text: string): string | null {
  const haystack = squash(text);
  return STRONG_PHRASES.find((phrase) => haystack.includes(squash(phrase))) ?? null;
}

function titleAndMainHeadingText(html: string): string {
  return Array.from(html.matchAll(TITLE_OR_MAIN_HEADING), (match) => match[2].replace(ANY_TAG, '')).join('\n');
}

/**
 * Returns the matched block signal, or null when the text looks like a normal response.
 * A false positive costs a 6-hour cooldown, so words such as "recaptcha" (which many normal
 * shopping pages load in a script) only count when the whole body is short.
 */
export function detectBlockSignal(text: string): string | null {
  if (text.trim() === '') return null;
  const headline = findStrongPhrase(titleAndMainHeadingText(text));
  if (headline !== null) return headline;
  if (text.length >= SHORT_BODY_MAX_CHARS) return null;

  const visible = findStrongPhrase(text.replace(INVISIBLE_BLOCKS, ' ').replace(ANY_TAG, ' '));
  if (visible !== null) return visible;
  const lower = text.toLowerCase().replace(PASSIVE_CLOUDFLARE_SCRIPT, '');
  const marker = CHALLENGE_MARKERS.find((candidate) => lower.includes(candidate));
  if (marker !== undefined) return marker;
  return WEAK_SIGNALS.find((signal) => lower.includes(signal)) ?? null;
}

// ---------- process plumbing ----------

function createAbortError(): Error {
  const error = new Error('수집이 중단되었습니다');
  error.name = 'AbortError';
  return error;
}

function toExecResult(error: ExecFileException | null, stdout: string, stderr: string): ObscuraExecResult {
  if (error === null) return { exitCode: 0, stdout, stderr, failure: null };
  if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
    return { exitCode: null, stdout, stderr, failure: 'aborted' };
  }
  if (typeof error.code === 'number') return { exitCode: error.code, stdout, stderr, failure: null };
  // A string code means Node could not run the file or gave up on it (ENOENT, maxBuffer overflow).
  if (typeof error.code === 'string') return { exitCode: null, stdout, stderr: error.message, failure: 'spawn' };
  if (error.killed === true) return { exitCode: null, stdout, stderr, failure: 'timeout' };
  return { exitCode: null, stdout, stderr: error.message, failure: 'spawn' };
}

/** No shell: the URL and the JS expression reach Obscura as separate argv items. */
const execObscura: ObscuraExec = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: options.timeoutMs,
        killSignal: 'SIGKILL',
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        resolve(toExecResult(error, stdout, stderr));
      },
    );
  });

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function buildArgs(adapter: ObscuraContextOptions['adapter'], spec: RequestSpec, timeoutSec: number): string[] {
  return [
    ...(adapter.stealth ? ['--stealth'] : []),
    ...(adapter.obeyRobots ? ['--obey-robots'] : []),
    'fetch',
    spec.url,
    ...(spec.dump === null ? [] : ['--dump', spec.dump]),
    '--quiet',
    '--timeout',
    String(timeoutSec),
    ...(spec.waitSec === undefined ? [] : ['--wait', String(spec.waitSec)]),
    ...(spec.js === undefined ? [] : ['--eval', spec.js]),
  ];
}

function assertRequestSpec(spec: RequestSpec): void {
  let protocol: string | null = null;
  try {
    protocol = new URL(spec.url).protocol;
  } catch {
    protocol = null; // not a URL at all: reported below together with other schemes
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`http(s) 주소만 요청할 수 있습니다: ${spec.url || '(빈 문자열)'}`);
  }
  // Obscura's --wait only accepts whole seconds.
  if (spec.waitSec !== undefined && (!Number.isInteger(spec.waitSec) || spec.waitSec < 0)) {
    throw new Error(`waitSec는 0 이상의 정수(초)여야 합니다: ${spec.waitSec}`);
  }
  if (spec.js !== undefined && spec.js.trim() === '') {
    throw new Error('페이지에서 실행할 JS 표현식(evalPage의 js 또는 fetchHtml의 preEval)이 비어 있습니다');
  }
}

function pickStderrDetail(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  const line = lines.find((candidate) => /^error\b/i.test(candidate)) ?? lines[lines.length - 1] ?? '';
  return line.slice(0, STDERR_DETAIL_MAX_CHARS);
}

function summarizeFailure(status: number | null, stderrWithoutUrl: string, exitCode: number | null): string {
  if (status === HTTP_NOT_FOUND) return `페이지를 찾을 수 없습니다 (HTTP ${status})`;
  if (status !== null && status >= HTTP_SERVER_ERROR_MIN) return `사이트 서버 오류입니다 (HTTP ${status})`;
  if (status !== null) return `사이트가 오류로 응답했습니다 (HTTP ${status})`;
  if (TIMEOUT_TEXT.test(stderrWithoutUrl)) return '페이지 로딩 시간이 초과되었습니다';
  if (/network error|dns error|error sending request|net::err_/i.test(stderrWithoutUrl)) {
    return '네트워크 오류로 페이지를 가져오지 못했습니다';
  }
  return `Obscura 요청이 실패했습니다 (종료 코드 ${exitCode ?? '없음'})`;
}

/** Maps a finished process to the error it stands for; null means success. */
function toFailure(result: ObscuraExecResult, url: string, timeoutSec: number): Error | null {
  if (result.failure === 'aborted') return createAbortError();
  if (result.failure === 'timeout') {
    return new Error(`Obscura가 제한 시간(--timeout ${timeoutSec}초) 안에 끝나지 않아 강제 종료했습니다: ${url}`);
  }
  const detail = pickStderrDetail(result.stderr);
  if (result.failure === 'spawn') return new Error(`Obscura를 실행하지 못했습니다: ${detail || '원인을 알 수 없습니다'}`);
  if (result.exitCode === 0) return null;

  // The URL is echoed in stderr; drop it so its own text cannot match the patterns below.
  const stderrWithoutUrl = result.stderr.split(url).join('<url>');
  if (ROBOTS_DISALLOW.test(stderrWithoutUrl)) return new Error(`robots.txt가 막은 주소입니다: ${url}`);
  const statusText = HTTP_STATUS.exec(stderrWithoutUrl)?.[1];
  const status = statusText === undefined ? null : Number(statusText);
  if (status !== null && BLOCKING_HTTP_STATUSES.includes(status)) return new BlockedError(`HTTP ${status}`, url);

  const summary = summarizeFailure(status, stderrWithoutUrl, result.exitCode);
  if (detail.includes(url)) return new Error(`${summary}: ${detail}`);
  return new Error(`${summary}: ${url}${detail === '' ? '' : ` — ${detail}`}`);
}

function parseJson(text: string): JsonParse {
  try {
    return { ok: true, value: JSON.parse(text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text) as unknown };
  } catch {
    return { ok: false }; // the caller decides what a non-JSON body means
  }
}

function assertSettings(minDelayMs: number, maxDelayMs: number, timeoutSec: number): void {
  if (!(minDelayMs >= 0) || !(maxDelayMs >= minDelayMs)) {
    throw new Error(`요청 간 대기 범위가 잘못되었습니다: ${minDelayMs}~${maxDelayMs}ms`);
  }
  if (!Number.isInteger(timeoutSec) || timeoutSec <= 0) {
    throw new Error(`timeoutSec는 1 이상의 정수(초)여야 합니다: ${timeoutSec}`);
  }
}

// ---------- the context ----------

export function createObscuraContext(options: ObscuraContextOptions): ObscuraContext {
  const { adapter } = options;
  const exec = options.exec ?? execObscura;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;
  const resolveBinary = options.resolveBinary ?? getObscuraPath;
  const forwardLog = options.log;
  const minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const timeoutSec = options.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  assertSettings(minDelayMs, maxDelayMs, timeoutSec);

  const controller = new AbortController();
  const external = options.signal;
  if (external !== undefined) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', () => controller.abort(external.reason), { once: true });
  }

  let requestCount = 0;
  let blocked: BlockedError | null = null;
  let binaryPath: string | null = null;
  let queue: Promise<void> = Promise.resolve();

  const log = (msg: string): void => {
    forwardLog?.(msg);
  };

  const throwIfStopped = (): void => {
    if (blocked !== null) throw blocked;
    if (controller.signal.aborted) throw createAbortError();
  };

  /** Remembers the first block and stops the run; always returns the latched error. */
  const latchBlock = (error: BlockedError): BlockedError => {
    if (blocked !== null) return blocked;
    blocked = error;
    log(`차단 감지로 ${adapter.id} 수집을 멈춥니다: ${error.reason}${error.url ? ` (${error.url})` : ''}`);
    controller.abort(error);
    return error;
  };

  const perform = async (spec: RequestSpec, isFirst: boolean): Promise<string> => {
    throwIfStopped();
    if (!isFirst) {
      await sleep(Math.round(minDelayMs + random() * (maxDelayMs - minDelayMs)), controller.signal);
      throwIfStopped();
    }
    binaryPath ??= resolveBinary();
    const timeoutMs = (timeoutSec + (spec.waitSec ?? 0) + KILL_GRACE_SEC) * MS_PER_SEC;
    const result = await exec(binaryPath, buildArgs(adapter, spec, timeoutSec), {
      timeoutMs,
      signal: controller.signal,
    });
    throwIfStopped();
    const failure = toFailure(result, spec.url, timeoutSec);
    if (failure instanceof BlockedError) throw latchBlock(failure);
    if (failure !== null) throw failure;
    return result.stdout;
  };

  /** Admission is synchronous (so requestsLeft is exact); the work itself runs one at a time. */
  const request = (spec: RequestSpec): Promise<string> => {
    throwIfStopped();
    assertRequestSpec(spec);
    if (requestCount >= adapter.maxRequests) throw new RequestLimitError(adapter.maxRequests);
    const isFirst = requestCount === 0;
    requestCount += 1;
    const run = queue.then(() => perform(spec, isFirst));
    queue = run.then(
      () => undefined,
      () => undefined, // the caller receives the rejection through `run`; the queue only orders work
    );
    return run;
  };

  return {
    async fetchHtml(url: string, opts?: FetchHtmlOptions): Promise<string> {
      if (opts?.raw === true) {
        // Raw body, no rendering: waitSec and preEval do not apply. An empty body is a valid
        // answer here (e.g. the page after the last one of a paged list).
        const body = await request({ url, dump: 'original' });
        const rawReason = detectBlockSignal(body);
        if (rawReason !== null) throw latchBlock(new BlockedError(rawReason, url));
        return body;
      }
      // With --dump html, --eval runs the script first and Obscura still prints the page HTML.
      const html = await request({ url, dump: 'html', waitSec: opts?.waitSec, js: opts?.preEval });
      if (html.trim() === '') throw new Error(`빈 페이지가 돌아왔습니다: ${url}`);
      const reason = detectBlockSignal(html);
      if (reason !== null) throw latchBlock(new BlockedError(reason, url));
      return html;
    },

    async fetchJson<T = unknown>(url: string): Promise<T> {
      const body = await request({ url, dump: 'original' });
      const parsed = parseJson(body);
      if (parsed.ok) return parsed.value as T;
      const reason = detectBlockSignal(body);
      if (reason !== null) throw latchBlock(new BlockedError(reason, url));
      const preview = body.trim().slice(0, BODY_PREVIEW_CHARS);
      if (preview === '') {
        throw new Error(`JSON이 아닌 응답입니다 (본문이 비어 있음 — HTTP 오류 응답일 수 있습니다): ${url}`);
      }
      throw new Error(`JSON이 아닌 응답입니다 (${url}): ${preview}`);
    },

    async evalPage<T = unknown>(url: string, js: string, opts?: FetchHtmlOptions): Promise<T | null> {
      const output = (await request({ url, dump: null, waitSec: opts?.waitSec, js })).trim();
      if (output === '' || output === 'null') return null;
      const parsed = parseJson(output);
      if (!parsed.ok) {
        log(`evalPage 결과가 JSON이 아니어서 null로 처리합니다 (${url}): ${output.slice(0, BODY_PREVIEW_CHARS)}`);
        return null;
      }
      return (parsed.value ?? null) as T | null;
    },

    log,
    signal: controller.signal,
    get requestsLeft(): number {
      return Math.max(0, adapter.maxRequests - requestCount);
    },
    get requestCount(): number {
      return requestCount;
    },
    get blocked(): BlockedError | null {
      return blocked;
    },
  };
}
