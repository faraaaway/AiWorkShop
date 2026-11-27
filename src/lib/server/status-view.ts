/**
 * Pure builders behind the status and crawl routes: no file access, no clock.
 * The routes read the data and the current time, these functions shape the answer.
 */
import { toKstIso } from '@/lib/dates';
import type {
  CrawlSkipReason,
  IsoDateTime,
  RunPhase,
  SiteId,
  SiteState,
  SiteStatus,
  SiteStatusView,
} from '@/lib/types';

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
/** Shown instead of the stored state while the site is switched off; never stored. */
const SWITCHED_OFF_STATE: SiteState = 'disabled';
const FORCE_RETRY_HINT = '지금 수집하려면 강제 재시도를 눌러 주세요.';

/** One line of GET /api/status. A new object with exactly the contract fields. */
export function buildStatusView(
  status: SiteStatus,
  displayName: string,
  run: RunPhase,
): SiteStatusView {
  return {
    siteId: status.siteId,
    enabled: status.enabled,
    state: status.enabled ? status.state : SWITCHED_OFF_STATE,
    lastRunAt: status.lastRunAt,
    lastSuccessAt: status.lastSuccessAt,
    dealCount: status.dealCount,
    message: status.message,
    cooldownUntil: status.cooldownUntil,
    displayName,
    run,
  };
}

/** Epoch milliseconds of a stored time, read the same way as everywhere else (lib/dates). */
function toEpochMs(value: IsoDateTime | null): number | null {
  if (value === null) return null;
  const iso = toKstIso(value);
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The most recent `lastSuccessAt` in `+09:00` form, or null when no site has succeeded yet.
 * Times that cannot be read are skipped, not guessed.
 */
export function latestSuccessAt(statuses: readonly SiteStatus[]): IsoDateTime | null {
  const latestMs = statuses.reduce<number | null>((latest, status) => {
    const ms = toEpochMs(status.lastSuccessAt);
    if (ms === null) return latest;
    return latest === null || ms > latest ? ms : latest;
  }, null);
  return latestMs === null ? null : toKstIso(latestMs);
}

export interface StatusReadFailure {
  siteId: SiteId;
  reason: unknown;
}

export interface SettledStatuses {
  /** Readable statuses, in the order of `siteIds`. */
  statuses: SiteStatus[];
  failures: StatusReadFailure[];
}

/** Splits `Promise.allSettled` results of per-site status reads (same order as `siteIds`). */
export function partitionSettledStatuses(
  siteIds: readonly SiteId[],
  results: readonly PromiseSettledResult<SiteStatus>[],
): SettledStatuses {
  return results.reduce<SettledStatuses>(
    (outcome, result, index) =>
      result.status === 'fulfilled'
        ? { statuses: [...outcome.statuses, result.value], failures: outcome.failures }
        : {
            statuses: outcome.statuses,
            failures: [...outcome.failures, { siteId: siteIds[index], reason: result.reason }],
          },
    { statuses: [], failures: [] },
  );
}

/** `90` -> `'1시간 30분'`, `60` -> `'1시간'`, `5` -> `'5분'`. */
function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${minutes}분`;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}

/** Whole minutes until `cooldownUntil`, rounded up; null when unknown, unreadable or over. */
function remainingMinutes(cooldownUntil: IsoDateTime | null, now: Date): number | null {
  const untilMs = toEpochMs(cooldownUntil);
  if (untilMs === null) return null;
  const leftMs = untilMs - now.getTime();
  return leftMs > 0 ? Math.ceil(leftMs / MINUTE_MS) : null;
}

function buildCooldownMessage(
  displayName: string,
  cooldownUntil: IsoDateTime | null,
  now: Date,
): string {
  const minutes = remainingMinutes(cooldownUntil, now);
  const wait =
    minutes === null ? '' : ` 약 ${formatMinutes(minutes)} 뒤에 다시 수집할 수 있습니다.`;
  return `${displayName} 수집은 재시도 대기 중입니다.${wait} ${FORCE_RETRY_HINT}`;
}

/** Why a single-site crawl request did not start (the 409 message of POST /api/crawl). */
export function buildSkipMessage(
  reason: CrawlSkipReason,
  displayName: string,
  cooldownUntil: IsoDateTime | null,
  now: Date,
): string {
  switch (reason) {
    case 'running':
      return `${displayName} 수집이 이미 진행 중입니다`;
    case 'cooldown':
      return buildCooldownMessage(displayName, cooldownUntil, now);
    case 'disabled':
      return `${displayName} 수집은 꺼져 있습니다. 상태 화면에서 켠 뒤 다시 시도해 주세요.`;
    case 'not_implemented':
      return `${displayName} 수집기는 아직 준비 중입니다.`;
  }
}
