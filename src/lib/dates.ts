import type { IsoDateTime } from '@/lib/types';

/**
 * Time handling for the whole project. Every calculation is done on epoch milliseconds with a
 * fixed +09:00 offset (Korea has no daylight saving time), so results never depend on the machine
 * time zone. Regexes avoid lookbehind and named groups on purpose (tsconfig target ES2017, and the
 * module is also loaded in the browser).
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const KST_SUFFIX = '+09:00';
const ISO_SECONDS_LENGTH = 'YYYY-MM-DDTHH:mm:ss'.length;
const MIN_ISO_YEAR = 0;
const MAX_ISO_YEAR = 9999;
const NOON_HOUR = 12;
/** "24:00" / 자정 / 밤 12시 of a date = 00:00:00 of the next day. */
const END_OF_DAY_HOUR = 24;
const MAX_MINUTE = 59;
const MAX_SECOND = 59;
const MAX_ZONE_OFFSET_HOURS = 14;
/** 밤 6시..11시 are evening hours; 밤 1시..5시 would be the next morning, which is ambiguous. */
const NIGHT_FIRST_HOUR = 6;
/** 낮 1시..5시 are afternoon hours. */
const DAYTIME_LAST_AFTERNOON_HOUR = 5;
const LATE_MORNING_HOUR = 11;
/** A year-less date more than this many days in the past is read as next year. */
const YEAR_ROLLOVER_DAYS = 60;
/** "26.11.30" is 2026-11-30. */
const TWO_DIGIT_YEAR_BASE = 2000;
/** Longer text is not sale-end wording; the caller should pass the date element only. */
const MAX_TEXT_LENGTH = 200;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface ClockTime {
  hour: number;
  minute: number;
  second: number;
}

/** A date as written, where the year may be missing. */
type WrittenDate = Omit<CalendarDate, 'year'> & { year: number | null };

/** A value found in a text plus the text with that value cut out. */
interface Scan<T> {
  value: T;
  rest: string;
}

/** A date without a time ends at 23:59:00 KST that day. */
const END_OF_DAY: ClockTime = { hour: 23, minute: 59, second: 0 };
const MIDNIGHT_AFTER: ClockTime = { hour: END_OF_DAY_HOUR, minute: 0, second: 0 };
const NOON: ClockTime = { hour: NOON_HOUR, minute: 0, second: 0 };

// ---------- instants ----------

/** 00:00:00 .. 23:59:59, plus exactly 24:00:00. */
function isValidClock({ hour, minute, second }: ClockTime): boolean {
  const inRange = (value: number, max: number): boolean =>
    Number.isInteger(value) && value >= 0 && value <= max;
  if (!inRange(hour, END_OF_DAY_HOUR)) return false;
  if (hour === END_OF_DAY_HOUR) return minute === 0 && second === 0;
  return inRange(minute, MAX_MINUTE) && inRange(second, MAX_SECOND);
}

function utcCalendarDate(ms: number): CalendarDate {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function kstCalendarDate(ms: number): CalendarDate {
  return utcCalendarDate(ms + KST_OFFSET_MS);
}

/**
 * Wall-clock fields at the given UTC offset -> epoch ms. Null when the calendar day does not exist
 * (month 13, Feb 30) or the clock is out of range. Hour 24 rolls over to the next day.
 */
function wallClockToMs(
  date: CalendarDate,
  time: ClockTime,
  offsetMs: number = KST_OFFSET_MS,
): number | null {
  if (!isValidClock(time)) return null;
  const dayStartMs = Date.UTC(date.year, date.month - 1, date.day);
  const actual = utcCalendarDate(dayStartMs);
  const exists =
    actual.year === date.year && actual.month === date.month && actual.day === date.day;
  if (!exists) return null;
  const clockMs = time.hour * HOUR_MS + time.minute * MINUTE_MS + time.second * SECOND_MS;
  return dayStartMs + clockMs - offsetMs;
}

/** The KST day `daysAhead` days after the KST day that contains `ms`, at the given clock time. */
function kstDayToMs(ms: number, daysAhead: number, time: ClockTime): number | null {
  const today = kstCalendarDate(ms);
  const target = utcCalendarDate(Date.UTC(today.year, today.month - 1, today.day + daysAhead));
  return wallClockToMs(target, time);
}

function formatKstIso(ms: number): IsoDateTime | null {
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  if (Number.isNaN(year) || year < MIN_ISO_YEAR || year > MAX_ISO_YEAR) return null;
  return `${shifted.toISOString().slice(0, ISO_SECONDS_LENGTH)}${KST_SUFFIX}`;
}

/** 1 date parts, 4-6 optional time, 7 optional zone. */
const TIMESTAMP_RE =
  /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
/** Other text is handed to Date.parse only when it names its own zone (e.g. RFC 2822 "... GMT"). */
const ZONED_TEXT_RE = /\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i;
const ZONE_OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

function parseZoneOffsetMs(zone: string): number | null {
  if (zone.toUpperCase() === 'Z') return 0;
  const match = ZONE_OFFSET_RE.exec(zone);
  if (match === null) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > MAX_ZONE_OFFSET_HOURS || minutes > MAX_MINUTE) return null;
  const magnitude = hours * HOUR_MS + minutes * MINUTE_MS;
  return match[1] === '-' ? -magnitude : magnitude;
}

function timestampMatchToMs(match: RegExpExecArray): number | null {
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const hourText: string | undefined = match[4];
  if (hourText === undefined) return wallClockToMs(date, END_OF_DAY);
  const zoneText: string | undefined = match[7];
  const time = { hour: Number(hourText), minute: Number(match[5]), second: numberOr(match[6], 0) };
  const offsetMs = zoneText === undefined ? KST_OFFSET_MS : parseZoneOffsetMs(zoneText);
  return offsetMs === null ? null : wallClockToMs(date, time, offsetMs);
}

/** Text -> epoch ms. Text without a zone designator is KST wall-clock time, never machine time. */
function parseInstantMs(text: string): number | null {
  const trimmed = text.trim();
  const match = TIMESTAMP_RE.exec(trimmed);
  if (match !== null) return timestampMatchToMs(match);
  if (!ZONED_TEXT_RE.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Date, epoch MILLISECONDS (a 10-digit seconds value is not guessed), or a string -> the project's
 * canonical form `2026-11-30T23:59:00+09:00`.
 *
 * Strings: ISO with `Z` or any offset is an absolute instant. A string WITHOUT a zone designator
 * (`2026-11-28 00:00:00`, `2026-11-28T00:00:00`, `2026.11.28 00:00`) is KST wall-clock time
 * whatever the machine time zone is; a date without a time (`2026-11-28`) means 23:59:00 KST that
 * day. Returns null when the value is not a valid instant.
 */
export function toKstIso(value: Date | number | string): IsoDateTime | null {
  if (value instanceof Date) return formatKstIso(value.getTime());
  if (typeof value === 'number') return formatKstIso(value);
  if (typeof value !== 'string') return null;
  const ms = parseInstantMs(value);
  return ms === null ? null : formatKstIso(ms);
}

/** True when `endsAt` is before `now`. Unknown (null) or unreadable end times are never expired. */
export function isExpired(endsAt: IsoDateTime | null, now: Date): boolean {
  if (typeof endsAt !== 'string') return false;
  const ms = parseInstantMs(endsAt);
  return ms !== null && ms < now.getTime();
}

// ---------- Korean sale-end wording ----------

const WEEKDAY_RE = /\(\s*[월화수목금토일](?:요일)?\s*\)|[월화수목금토일]요일/g;
const RANGE_MARK_RE = /[〜∼–—→]|부터/g;
/** " - " between two dates; "D - 2" is a countdown, not a range. */
const SPACED_HYPHEN_RE = /(^|[^Dd])\s+-\s+/g;
const RANGE_SEPARATOR = '~';
const HAS_DIGIT_RE = /\d/;
/** Wording about a start or a delivery, not about the end of a sale. */
const NOT_AN_END_RE = /시작|오픈|개시|발송|배송|출고|입고|도착|출발/;
/** 오늘 / 내일 / 모레 count only next to one of these ("오늘출발" is not a deadline). */
const END_WORD_RE = /까지|마감|종료|끝/;
/** A number followed by one of these is an amount ("3.5%", "2.5일"), not a month.day date. */
const NOT_A_DATE_SUFFIX = '(?!\\d|\\s*(?:%|시간|분|일|원|개|배))';
const MERIDIEM = '(오전|오후|새벽|아침|저녁|밤|낮)?\\s*';

type YearStyle = 'full' | 'two-digit' | 'none';

/** Group 1 is the boundary before the date (kept in the text); then [year,] month, day. */
const DATE_PATTERNS: readonly { re: RegExp; year: YearStyle }[] = [
  { re: /(^|\D)(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/, year: 'full' },
  { re: /(^|\D)(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)\.?/, year: 'full' },
  {
    re: /(^|[^\d.])(\d{2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})(?!\d|\s*[:시])\.?/,
    year: 'two-digit',
  },
  { re: /(^|\D)(\d{1,2})\s*월\s*(\d{1,2})\s*일/, year: 'none' },
  { re: new RegExp(`(^|[^\\d.])(\\d{1,2})\\s*[./]\\s*(\\d{1,2})${NOT_A_DATE_SUFFIX}\\.?`), year: 'none' },
];

/** Groups: 1 boundary, 2 meridiem, 3 hour, 4 minute, 5 second. */
const DIGITAL_TIME_RE = new RegExp(
  `(^|[^\\d:])${MERIDIEM}(\\d{1,2})\\s*:\\s*(\\d{2})(?:\\s*:\\s*(\\d{2}))?(?![\\d:])`,
);
const SPOKEN_TIME_RE = new RegExp(
  `(^|\\D)${MERIDIEM}(\\d{1,2})\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분)?(?:\\s*(\\d{1,2})\\s*초)?`,
);
const MIDNIGHT_WORD = '자정';
const NOON_WORD = '정오';

/** Groups: 1 boundary, 2 "DAY" or the number of days. */
const D_DAY_RE = /(^|[^A-Za-z])D\s*-\s*(DAY|\d{1,3})(?![\dA-Za-z])/i;
const DIGITS_ONLY_RE = /^\d+$/;
/** Group 1 is an empty boundary so that cutOut() treats it like the other patterns. */
const NAMED_DAY_RE = /()(오늘|내일|모레)/;
const NAMED_DAY_OFFSETS: Readonly<Record<string, number>> = { 오늘: 0, 내일: 1, 모레: 2 };
/** Groups: 1 boundary, 2 days, 3 hours, 4 minutes. */
const COUNTDOWN_RE =
  /(^|[^\d.])(?:(\d{1,3})\s*일\s*)?(?:(\d{1,3})\s*시간\s*)?(?:(\d{1,4})\s*분\s*)?남/;

function cleanText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(WEEKDAY_RE, ' ')
    .replace(RANGE_MARK_RE, RANGE_SEPARATOR)
    .replace(SPACED_HYPHEN_RE, `$1${RANGE_SEPARATOR}`)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text without the match; the boundary character captured in group 1 stays. */
function cutOut(text: string, match: RegExpExecArray): string {
  const start = match.index + match[1].length;
  return `${text.slice(0, start)} ${text.slice(match.index + match[0].length)}`;
}

function numberOr(text: string | undefined, fallback: number): number {
  return text === undefined ? fallback : Number(text);
}

function scanDate(text: string): Scan<WrittenDate> | null {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.re.exec(text);
    if (match === null) continue;
    const rest = cutOut(text, match);
    if (pattern.year === 'none') {
      return { value: { year: null, month: Number(match[2]), day: Number(match[3]) }, rest };
    }
    const base = pattern.year === 'two-digit' ? TWO_DIGIT_YEAR_BASE : 0;
    const year = base + Number(match[2]);
    return { value: { year, month: Number(match[3]), day: Number(match[4]) }, rest };
  }
  return null;
}

/**
 * 12-hour wording -> 24-hour clock. Null when the hour does not fit the wording, or when a spoken
 * hour without 오전/오후 could be morning or evening ("6시까지", "12시까지").
 */
function to24Hour(hour: number, meridiem: string | undefined, isDigital: boolean): number | null {
  switch (meridiem) {
    case undefined:
      return isDigital || hour === 0 || hour > NOON_HOUR ? hour : null;
    case '오전':
    case '새벽':
    case '아침':
      if (hour === NOON_HOUR) return 0;
      return hour < NOON_HOUR ? hour : null;
    case '오후':
    case '저녁':
      if (hour >= 1 && hour < NOON_HOUR) return hour + NOON_HOUR;
      return hour >= NOON_HOUR && hour < END_OF_DAY_HOUR ? hour : null;
    case '밤':
      if (hour === NOON_HOUR) return END_OF_DAY_HOUR;
      return hour >= NIGHT_FIRST_HOUR && hour < NOON_HOUR ? hour + NOON_HOUR : null;
    case '낮':
      if (hour >= 1 && hour <= DAYTIME_LAST_AFTERNOON_HOUR) return hour + NOON_HOUR;
      return hour === LATE_MORNING_HOUR || hour === NOON_HOUR ? hour : null;
    default:
      return null;
  }
}

function scanClock(text: string, re: RegExp, isDigital: boolean): Scan<ClockTime> | null {
  const match = re.exec(text);
  if (match === null) return null;
  const meridiem: string | undefined = match[2];
  const hour = to24Hour(Number(match[3]), meridiem, isDigital);
  if (hour === null) return null;
  const value = { hour, minute: numberOr(match[4], 0), second: numberOr(match[5], 0) };
  return { value, rest: cutOut(text, match) };
}

function scanTimeWord(text: string, word: string, value: ClockTime): Scan<ClockTime> | null {
  const index = text.indexOf(word);
  if (index < 0) return null;
  return { value, rest: `${text.slice(0, index)} ${text.slice(index + word.length)}` };
}

/** "23:59", "오후 11:59", "23시 59분", "오전 10시", "자정" (= 24:00), "정오". */
function scanTime(text: string): Scan<ClockTime> | null {
  return (
    scanClock(text, DIGITAL_TIME_RE, true) ??
    scanClock(text, SPOKEN_TIME_RE, false) ??
    scanTimeWord(text, MIDNIGHT_WORD, MIDNIGHT_AFTER) ??
    scanTimeWord(text, NOON_WORD, NOON)
  );
}

/** Year of the end of "2024.12.20 ~ 01.05": the start year, or the one after when it wraps. */
function yearFromRangeStart(startPart: string, end: WrittenDate): number | null {
  const start = scanDate(startPart)?.value;
  if (start === undefined || start.year === null) return null;
  if (wallClockToMs({ ...start, year: start.year }, END_OF_DAY) === null) return null;
  const endsBeforeStart =
    end.month < start.month || (end.month === start.month && end.day < start.day);
  return endsBeforeStart ? start.year + 1 : start.year;
}

/** Year omitted: the KST year of now; next year when that lands more than 60 days before now. */
function resolveOmittedYear(date: WrittenDate, time: ClockTime, nowMs: number): number | null {
  const year = kstCalendarDate(nowMs).year;
  const thisYear = wallClockToMs({ year, month: date.month, day: date.day }, time);
  if (thisYear === null) return null;
  if (thisYear >= nowMs - YEAR_ROLLOVER_DAYS * DAY_MS) return thisYear;
  return wallClockToMs({ year: year + 1, month: date.month, day: date.day }, time);
}

/** A calendar date with an optional time. Any other number left in the text means "not understood". */
function parseAbsoluteEnd(endPart: string, startPart: string, nowMs: number): number | null {
  const date = scanDate(endPart);
  if (date === null) return null;
  const time = scanTime(date.rest);
  if (HAS_DIGIT_RE.test(time?.rest ?? date.rest)) return null;
  const clock = time?.value ?? END_OF_DAY;
  const { month, day } = date.value;
  const year = date.value.year ?? yearFromRangeStart(startPart, date.value);
  if (year !== null) return wallClockToMs({ year, month, day }, clock);
  return resolveOmittedYear(date.value, clock, nowMs);
}

/** "D-2", "D-DAY", "D-0": 23:59:00 KST on today + n. */
function parseDDay(part: string, nowMs: number): number | null {
  const match = D_DAY_RE.exec(part);
  if (match === null || HAS_DIGIT_RE.test(cutOut(part, match))) return null;
  const days = DIGITS_ONLY_RE.test(match[2]) ? Number(match[2]) : 0;
  return kstDayToMs(nowMs, days, END_OF_DAY);
}

/** "오늘 마감", "오늘 23:59 마감", "내일 오전 10시까지", "모레 종료". */
function parseNamedDay(part: string, nowMs: number): number | null {
  const match = NAMED_DAY_RE.exec(part);
  if (match === null || !END_WORD_RE.test(part)) return null;
  const daysAhead: number | undefined = NAMED_DAY_OFFSETS[match[2]];
  if (daysAhead === undefined) return null;
  const withoutDay = cutOut(part, match);
  const time = scanTime(withoutDay);
  if (HAS_DIGIT_RE.test(time?.rest ?? withoutDay)) return null;
  return kstDayToMs(nowMs, daysAhead, time?.value ?? END_OF_DAY);
}

/** "3일 남음" -> 23:59:00 KST on today + 3; "5시간 남음", "30분 남음", "1일 2시간 남음" -> now + that. */
function parseCountdown(part: string, nowMs: number): number | null {
  const match = COUNTDOWN_RE.exec(part);
  if (match === null || HAS_DIGIT_RE.test(cutOut(part, match))) return null;
  const days: string | undefined = match[2];
  const hours: string | undefined = match[3];
  const minutes: string | undefined = match[4];
  if (days === undefined && hours === undefined && minutes === undefined) return null;
  const dayCount = numberOr(days, 0);
  if (hours === undefined && minutes === undefined) return kstDayToMs(nowMs, dayCount, END_OF_DAY);
  return nowMs + dayCount * DAY_MS + numberOr(hours, 0) * HOUR_MS + numberOr(minutes, 0) * MINUTE_MS;
}

/**
 * Korean sale-end wording -> IsoDateTime. Returns null when the text is not understood: this
 * function never guesses (constitution III), so a caller must treat null as "알 수 없음".
 *
 * Understood:
 * - dates: `~11.30(일) 23:59`, `11.30(일)까지`, `11/30까지`, `11월 30일 23시 59분`, `2026.11.30 23:59`,
 *   `2026-11-30`, `2026년 11월 30일`, `26.11.30`, `12.03 00:00`. No time -> 23:59:00 KST.
 * - ranges (`~`, `-` with spaces, `부터`): `11.22 ~ 12.03`, `11.22(일) 19:00 ~ 12.03(목) 00:00` -> the END.
 * - countdowns: `D-2`, `D-DAY`, `D-0`, `3일 남음` -> 23:59:00 KST on today(KST) + n;
 *   `5시간 남음`, `30분 남음` -> now + n.
 * - `오늘 마감`, `오늘 23:59 마감`, `내일 마감`, `내일 오전 10시까지` (needs 까지/마감/종료/끝).
 *
 * Rules:
 * - Year omitted -> the KST year of `now`; if that is more than 60 days before `now`, next year.
 *   A range end takes its year from a start that has one (`2024.12.20 ~ 01.05` -> 2025).
 * - `자정`, `24:00` and `밤 12시` of a date mean 24:00, i.e. 00:00:00 of the NEXT day
 *   (`11월 30일 자정까지` -> `2026-12-01T00:00:00+09:00`). `24:30` is not a time -> null.
 * - A spoken hour 1..12 without 오전/오후 (`6시까지`) is ambiguous -> null. `HH:mm` is 24-hour.
 * - Null as well for: an impossible date (month 13, day 32, Feb 30), any number left over besides
 *   the date and time, text about a start or delivery (`오픈`, `발송`), text over 200 characters.
 */
export function parseKoreanEndDate(text: string, now: Date): IsoDateTime | null {
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) return null;
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) return null;
  const parts = cleanText(text).split(RANGE_SEPARATOR);
  const endPart = parts[parts.length - 1].trim();
  if (endPart === '' || NOT_AN_END_RE.test(endPart)) return null;
  const startPart = parts.length > 1 ? parts[parts.length - 2] : '';
  const ms =
    parseAbsoluteEnd(endPart, startPart, nowMs) ??
    parseDDay(endPart, nowMs) ??
    parseNamedDay(endPart, nowMs) ??
    parseCountdown(endPart, nowMs);
  return ms === null ? null : formatKstIso(ms);
}
