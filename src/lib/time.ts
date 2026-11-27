// 남은 시간·수집 시각 표시 (T023). 모든 날짜 계산은 브라우저 시간대와 무관하게 KST 기준.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 마지막 업데이트가 이 시간보다 오래되면 경고한다 (FR-020a). */
export const STALE_AFTER_HOURS = 12;

export type RemainingKind = 'unknown' | 'expired' | 'today' | 'later';

export interface Remaining {
  kind: RemainingKind;
  /** `오늘 23:59 마감` · `D-2 13:00` · `종료` · `알 수 없음` */
  label: string;
  /** 마감까지 24시간 이내 — 카드에서 "오늘 마감"으로 강조한다. */
  urgent: boolean;
}

function toTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** KST 달력 기준 날짜·시각 조각. */
function kstParts(time: number) {
  const d = new Date(time + KST_OFFSET_MS);
  return {
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    /** 1970-01-01(KST)부터 센 날짜 번호 */
    dayIndex: Math.floor((time + KST_OFFSET_MS) / DAY_MS),
  };
}

function clock(time: number): string {
  const p = kstParts(time);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** 종료 시각이 지났는가. 종료 시각을 모르면 만료로 보지 않는다. */
export function isExpired(endsAt: string | null, now: Date = new Date()): boolean {
  const end = toTime(endsAt);
  return end !== null && end <= now.getTime();
}

/** 아직 진행 중이고 마감까지 24시간 이내인가 ("오늘 마감" 필터·강조 공용 기준). */
export function isEndingSoon(endsAt: string | null, now: Date = new Date()): boolean {
  const end = toTime(endsAt);
  if (end === null) return false;
  const left = end - now.getTime();
  return left > 0 && left <= DAY_MS;
}

/** 카드에 표시할 남은 시간. 값을 모르면 지어내지 않고 "알 수 없음". */
export function formatRemaining(endsAt: string | null, now: Date = new Date()): Remaining {
  const end = toTime(endsAt);
  if (end === null) return { kind: 'unknown', label: '알 수 없음', urgent: false };
  if (end <= now.getTime()) return { kind: 'expired', label: '종료', urgent: false };

  const urgent = end - now.getTime() <= DAY_MS;
  const days = kstParts(end).dayIndex - kstParts(now.getTime()).dayIndex;
  if (days === 0) return { kind: 'today', label: `오늘 ${clock(end)} 마감`, urgent };
  return { kind: 'later', label: `D-${days} ${clock(end)}`, urgent };
}

/** `11월 27일 21:00` (KST) */
export function formatDateTime(iso: string | null): string {
  const t = toTime(iso);
  if (t === null) return '알 수 없음';
  const p = kstParts(t);
  return `${p.month}월 ${p.day}일 ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `11/27 21:00` (KST) — 카드처럼 좁은 곳에 쓴다. */
export function formatShortDateTime(iso: string | null): string {
  const t = toTime(iso);
  if (t === null) return '알 수 없음';
  const p = kstParts(t);
  return `${p.month}/${p.day} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `23:30` (KST) — 기준 시각과 날짜가 다르면 `11/28 03:00`처럼 날짜를 붙인다. */
export function formatTimeOfDay(iso: string | null, now: Date = new Date()): string {
  const t = toTime(iso);
  if (t === null) return '알 수 없음';
  const sameDay = kstParts(t).dayIndex === kstParts(now.getTime()).dayIndex;
  return sameDay ? clock(t) : formatShortDateTime(iso);
}

/** `방금 전` · `35분 전` · `3시간 전` · `2일 전` */
export function formatAgo(iso: string | null, now: Date = new Date()): string {
  const t = toTime(iso);
  if (t === null) return '알 수 없음';
  const diff = Math.max(0, now.getTime() - t);
  if (diff < 60 * 1000) return '방금 전';
  if (diff < HOUR_MS) return `${Math.floor(diff / (60 * 1000))}분 전`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}시간 전`;
  return `${Math.floor(diff / DAY_MS)}일 전`;
}

/** 마지막 업데이트가 12시간보다 오래됐는가. 시각을 모르면 false. */
export function isStale(lastUpdatedAt: string | null, now: Date = new Date()): boolean {
  const t = toTime(lastUpdatedAt);
  return t !== null && now.getTime() - t > STALE_AFTER_HOURS * HOUR_MS;
}
