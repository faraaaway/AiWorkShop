/**
 * JSON file storage under getDataDir():
 *   deals/<siteId>.json  (DealsFile)   status/<siteId>.json (SiteStatus)   raw/<siteId>.json (RawFile)
 *
 * - Writes are atomic: a uniquely named temp file in the same folder is renamed over the target,
 *   so a reader sees either the old file or the new one, never half of one.
 * - Reads never return garbage: a missing file is "nothing stored yet", anything else that is not
 *   the expected shape throws a Korean error naming the file.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { getDataDir } from '@/lib/env';
import type {
  Deal,
  DealsFile,
  IsoDateTime,
  RawDeal,
  SiteId,
  SiteState,
  SiteStatus,
} from '@/lib/types';
import { SITE_IDS, SITE_STATES, isSiteId } from '@/lib/types';

/** data/raw/<siteId>.json: what the adapter returned, kept so deals can be rebuilt offline. */
export interface RawFile {
  siteId: SiteId;
  crawledAt: IsoDateTime;
  deals: RawDeal[];
}

type StoreFolder = 'deals' | 'status' | 'raw';

/** A status file as found on disk: fields added after it was written may be absent. */
type StoredStatus = Pick<SiteStatus, 'siteId' | 'enabled' | 'state'> &
  Partial<Omit<SiteStatus, 'siteId' | 'enabled' | 'state'>>;

const JSON_INDENT = 1;
const FILE_ENCODING = 'utf8';
const BYTE_ORDER_MARK = /^﻿/;
/** Windows reports these while another process (a reader, antivirus, the indexer) holds the file. */
const TRANSIENT_FS_CODES: readonly string[] = ['EPERM', 'EBUSY', 'EACCES'];
const FS_MAX_ATTEMPTS = 5;
/** Wait before retry N is N times this long (40, 80, 120, 160 ms). */
const FS_RETRY_DELAY_MS = 40;
const FILE_NOT_FOUND = 'ENOENT';
/** A status that must not be stored (types.ts SiteStatus rules) and what replaces it. */
const DERIVED_ONLY_STATE: SiteState = 'disabled';
const STATE_WITHOUT_RESULT: SiteState = 'never_run';

const DEALS_SHAPE = 'siteId, crawledAt, deals 배열과 각 상품의 id·salePrice';
const RAW_SHAPE = 'siteId, crawledAt, deals 배열';
const STATUS_SHAPE = 'siteId, enabled(true/false), state와 선택 필드의 타입';

// ---------- small helpers ----------

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isTransientFsError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== null && TRANSIENT_FS_CODES.includes(code);
}

/** Runs a file operation again after a short wait while the failure looks like a held file. */
async function withFsRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= FS_MAX_ATTEMPTS || !isTransientFsError(error)) throw error;
      await sleep(FS_RETRY_DELAY_MS * attempt);
    }
  }
}

/** Name used in messages; relative so an error shown in the UI does not expose local folders. */
function fileLabel(folder: StoreFolder, siteId: SiteId): string {
  return `${folder}/${siteId}.json`;
}

/** The only place a path is built. siteId is re-checked at runtime so it can never be free text. */
function resolveFilePath(folder: StoreFolder, siteId: SiteId): string {
  if (!isSiteId(siteId)) {
    throw new Error(`알 수 없는 사이트 ID라서 파일을 열 수 없습니다: ${String(siteId)}`);
  }
  return path.join(getDataDir(), folder, `${siteId}.json`);
}

function wrongShapeError(folder: StoreFolder, siteId: SiteId, expected: string): Error {
  return new Error(
    `${fileLabel(folder, siteId)} 파일의 내용이 예상한 형식이 아닙니다 (필요: ${expected}).`,
  );
}

function unwritableError(folder: StoreFolder, siteId: SiteId, expected: string): Error {
  return new Error(
    `${fileLabel(folder, siteId)} 파일에 저장하려는 내용이 올바르지 않아 저장하지 않았습니다 ` +
      `(필요: ${expected}).`,
  );
}

// ---------- reading and writing JSON ----------

/** Parsed content of the file, or undefined when it does not exist (JSON never yields undefined). */
async function readJsonFile(folder: StoreFolder, siteId: SiteId): Promise<unknown> {
  const filePath = resolveFilePath(folder, siteId);
  const label = fileLabel(folder, siteId);
  let text: string;
  try {
    text = await withFsRetry(() => readFile(filePath, FILE_ENCODING));
  } catch (error) {
    if (getErrorCode(error) === FILE_NOT_FOUND) return undefined;
    throw new Error(`${label} 파일을 읽지 못했습니다: ${toErrorMessage(error)}`);
  }
  try {
    return JSON.parse(text.replace(BYTE_ORDER_MARK, '')) as unknown;
  } catch (error) {
    throw new Error(`${label} 파일의 JSON 형식이 올바르지 않습니다: ${toErrorMessage(error)}`);
  }
}

/** Removes a temp file of a failed write; returns text to append to the error when that fails too. */
async function discardTempFile(tempPath: string): Promise<string> {
  try {
    await rm(tempPath, { force: true });
    return '';
  } catch (error) {
    return ` 임시 파일 ${path.basename(tempPath)}도 지우지 못했습니다: ${toErrorMessage(error)}`;
  }
}

async function writeJsonFile(folder: StoreFolder, siteId: SiteId, value: unknown): Promise<void> {
  const filePath = resolveFilePath(folder, siteId);
  const folderPath = path.dirname(filePath);
  const tempPath = path.join(folderPath, `${siteId}.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    const text = `${JSON.stringify(value, null, JSON_INDENT)}\n`;
    await mkdir(folderPath, { recursive: true });
    await writeFile(tempPath, text, FILE_ENCODING);
    await withFsRetry(() => rename(tempPath, filePath));
  } catch (error) {
    const leftover = await discardTempFile(tempPath);
    const cause = isTransientFsError(error)
      ? `다른 프로그램이 파일을 사용 중이어서 ${FS_MAX_ATTEMPTS}번 시도했지만 바꾸지 못했습니다`
      : '쓰는 중 오류가 났습니다';
    throw new Error(
      `${fileLabel(folder, siteId)} 파일을 저장하지 못했습니다. ${cause}: ` +
        `${toErrorMessage(error)}.${leftover}`,
    );
  }
}

// ---------- type guards ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isSiteState(value: unknown): value is SiteState {
  return typeof value === 'string' && (SITE_STATES as readonly string[]).includes(value);
}

function isAbsentOr<T>(value: unknown, guard: (candidate: unknown) => candidate is T): boolean {
  return value === undefined || guard(value);
}

function isStoredDeal(value: unknown): value is Deal {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.salePrice === 'number' &&
    Number.isFinite(value.salePrice)
  );
}

function isDealsFile(value: unknown, siteId: SiteId): value is DealsFile {
  return (
    isRecord(value) &&
    value.siteId === siteId &&
    typeof value.crawledAt === 'string' &&
    Array.isArray(value.deals) &&
    value.deals.every(isStoredDeal)
  );
}

/** Raw deals are only checked to be objects: judging their fields is normalizeDeal()'s job. */
function isRawFile(value: unknown, siteId: SiteId): value is RawFile {
  return (
    isRecord(value) &&
    value.siteId === siteId &&
    typeof value.crawledAt === 'string' &&
    Array.isArray(value.deals) &&
    value.deals.every(isRecord)
  );
}

function isStoredStatus(value: unknown, siteId: SiteId): value is StoredStatus {
  return (
    isRecord(value) &&
    value.siteId === siteId &&
    typeof value.enabled === 'boolean' &&
    isSiteState(value.state) &&
    isAbsentOr(value.lastRunAt, isNullableString) &&
    isAbsentOr(value.lastSuccessAt, isNullableString) &&
    isAbsentOr(value.dealCount, isCount) &&
    isAbsentOr(value.message, isNullableString) &&
    isAbsentOr(value.cooldownUntil, isNullableString)
  );
}

/** Exactly the SiteStatus fields: absent ones from the default, 'disabled' never kept as a state. */
function toSiteStatus(stored: StoredStatus): SiteStatus {
  const fallback = defaultStatus(stored.siteId);
  return {
    siteId: stored.siteId,
    enabled: stored.enabled,
    state: stored.state === DERIVED_ONLY_STATE ? STATE_WITHOUT_RESULT : stored.state,
    lastRunAt: stored.lastRunAt ?? fallback.lastRunAt,
    lastSuccessAt: stored.lastSuccessAt ?? fallback.lastSuccessAt,
    dealCount: stored.dealCount ?? fallback.dealCount,
    message: stored.message ?? fallback.message,
    cooldownUntil: stored.cooldownUntil ?? fallback.cooldownUntil,
  };
}

// ---------- deals ----------

/** null when the site has never been stored. Throws when the file exists but is unusable. */
export async function readDeals(siteId: SiteId): Promise<DealsFile | null> {
  const value = await readJsonFile('deals', siteId);
  if (value === undefined) return null;
  if (!isDealsFile(value, siteId)) throw wrongShapeError('deals', siteId, DEALS_SHAPE);
  return value;
}

export async function writeDeals(file: DealsFile): Promise<void> {
  const content: DealsFile = { siteId: file.siteId, crawledAt: file.crawledAt, deals: file.deals };
  if (!isDealsFile(content, file.siteId)) throw unwritableError('deals', file.siteId, DEALS_SHAPE);
  await writeJsonFile('deals', file.siteId, content);
}

interface SiteDealsOutcome {
  deals: Deal[];
  problem: string | null;
}

async function readSiteDealsOrProblem(siteId: SiteId): Promise<SiteDealsOutcome> {
  try {
    const file = await readDeals(siteId);
    return { deals: file === null ? [] : file.deals, problem: null };
  } catch (error) {
    return {
      deals: [],
      problem: `${siteId} 할인 목록은 불러오지 못해 건너뛰었습니다: ${toErrorMessage(error)}`,
    };
  }
}

/** Every site in SITE_IDS order. An unreadable site is skipped and described in `problems`. */
export async function readAllDeals(): Promise<{ deals: Deal[]; problems: string[] }> {
  const outcomes = await Promise.all(SITE_IDS.map(readSiteDealsOrProblem));
  return {
    deals: outcomes.flatMap((outcome) => outcome.deals),
    problems: outcomes.flatMap((outcome) => (outcome.problem === null ? [] : [outcome.problem])),
  };
}

// ---------- status ----------

export function defaultStatus(siteId: SiteId): SiteStatus {
  return {
    siteId,
    enabled: true,
    state: STATE_WITHOUT_RESULT,
    lastRunAt: null,
    lastSuccessAt: null,
    dealCount: 0,
    message: null,
    cooldownUntil: null,
  };
}

/** defaultStatus when the site has no status file yet. Throws when the file is unusable. */
export async function readStatus(siteId: SiteId): Promise<SiteStatus> {
  const value = await readJsonFile('status', siteId);
  if (value === undefined) return defaultStatus(siteId);
  if (!isStoredStatus(value, siteId)) throw wrongShapeError('status', siteId, STATUS_SHAPE);
  return toSiteStatus(value);
}

export async function writeStatus(status: SiteStatus): Promise<void> {
  const { siteId } = status;
  // Checked as unknown: the type says it is valid, the runtime value may not be.
  const candidate: unknown = status;
  if (!isStoredStatus(candidate, siteId)) throw unwritableError('status', siteId, STATUS_SHAPE);
  await writeJsonFile('status', siteId, toSiteStatus(candidate));
}

/** All sites in SITE_IDS order. */
export async function readAllStatuses(): Promise<SiteStatus[]> {
  return Promise.all(SITE_IDS.map((siteId) => readStatus(siteId)));
}

// ---------- raw ----------

/** null when the site has no raw file. Throws when the file exists but is unusable. */
export async function readRaw(siteId: SiteId): Promise<RawFile | null> {
  const value = await readJsonFile('raw', siteId);
  if (value === undefined) return null;
  if (!isRawFile(value, siteId)) throw wrongShapeError('raw', siteId, RAW_SHAPE);
  return value;
}

export async function writeRaw(file: RawFile): Promise<void> {
  const content: RawFile = { siteId: file.siteId, crawledAt: file.crawledAt, deals: file.deals };
  if (!isRawFile(content, file.siteId)) throw unwritableError('raw', file.siteId, RAW_SHAPE);
  await writeJsonFile('raw', file.siteId, content);
}
