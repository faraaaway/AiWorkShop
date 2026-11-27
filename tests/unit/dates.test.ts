import { afterEach, describe, expect, it } from 'vitest';

import { isExpired, parseKoreanEndDate, toKstIso } from '@/lib/dates';

/** Friday 2026-11-27 12:00:00 KST, written as an explicit instant so the machine zone is irrelevant. */
const NOW = new Date('2026-11-27T03:00:00Z');
const KST_ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
const ORIGINAL_TZ = process.env.TZ;

function restoreTimeZone(): void {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
}

describe('toKstIso', () => {
  it('converts a Date to the +09:00 form', () => {
    expect(toKstIso(new Date('2026-11-30T14:59:00Z'))).toBe('2026-11-30T23:59:00+09:00');
  });

  it('treats a number as epoch milliseconds', () => {
    expect(toKstIso(Date.UTC(2026, 10, 27, 15, 0, 0))).toBe('2026-11-28T00:00:00+09:00');
  });

  it('does not guess that a 10-digit number is epoch seconds', () => {
    expect(toKstIso(1795791600)).toBe('1970-01-22T03:49:51+09:00');
  });

  it('converts ISO strings with Z or any offset', () => {
    expect(toKstIso('2026-11-30T14:59:00Z')).toBe('2026-11-30T23:59:00+09:00');
    expect(toKstIso('2026-11-30T14:59:00.123Z')).toBe('2026-11-30T23:59:00+09:00');
    expect(toKstIso('2026-11-30T09:59:00-05:00')).toBe('2026-11-30T23:59:00+09:00');
    expect(toKstIso('2026-11-30T23:59:00+09:00')).toBe('2026-11-30T23:59:00+09:00');
    expect(toKstIso('2026-11-30 23:59:00+0900')).toBe('2026-11-30T23:59:00+09:00');
  });

  it('reads a string without a zone designator as KST wall-clock time', () => {
    expect(toKstIso('2026-11-28 00:00:00')).toBe('2026-11-28T00:00:00+09:00');
    expect(toKstIso('2026-11-28T00:00:00')).toBe('2026-11-28T00:00:00+09:00');
    expect(toKstIso('2026-11-28T08:30:15.250')).toBe('2026-11-28T08:30:15+09:00');
    expect(toKstIso('2026.11.28 00:00')).toBe('2026-11-28T00:00:00+09:00');
    expect(toKstIso('  2026/11/28 7:05  ')).toBe('2026-11-28T07:05:00+09:00');
  });

  it('reads a date without a time as 23:59:00 KST that day', () => {
    expect(toKstIso('2026-11-28')).toBe('2026-11-28T23:59:00+09:00');
    expect(toKstIso('2026.11.28')).toBe('2026-11-28T23:59:00+09:00');
  });

  it('reads 24:00 as 00:00 of the next day', () => {
    expect(toKstIso('2026-11-30 24:00')).toBe('2026-12-01T00:00:00+09:00');
  });

  it('returns null for values that are not a valid instant', () => {
    expect(toKstIso(Number.NaN)).toBeNull();
    expect(toKstIso(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toKstIso(8.64e15)).toBeNull();
    expect(toKstIso(new Date(Number.NaN))).toBeNull();
    expect(toKstIso('')).toBeNull();
    expect(toKstIso('상시')).toBeNull();
    expect(toKstIso('not a date')).toBeNull();
  });

  it('returns null for impossible calendar values', () => {
    expect(toKstIso('2026-13-01')).toBeNull();
    expect(toKstIso('2026-11-32')).toBeNull();
    expect(toKstIso('2026-02-30 10:00:00')).toBeNull();
    expect(toKstIso('2026-11-28 25:00:00')).toBeNull();
    expect(toKstIso('2026-11-28 10:60:00')).toBeNull();
    expect(toKstIso('2026-11-28 24:30:00')).toBeNull();
  });

  it('returns null for zone-less text it cannot read without guessing the zone', () => {
    expect(toKstIso('Nov 28, 2026')).toBeNull();
    expect(toKstIso('1795791600000')).toBeNull();
    expect(toKstIso('2026')).toBeNull();
  });

  it('always produces the canonical shape', () => {
    const inputs: (Date | number | string)[] = [NOW, NOW.getTime(), '2026-01-01T00:00:00Z', '2026-1-5'];
    for (const input of inputs) {
      expect(toKstIso(input)).toMatch(KST_ISO_SHAPE);
    }
  });
});

describe('parseKoreanEndDate — absolute dates', () => {
  it.each([
    ['~11.30(일) 23:59', '2026-11-30T23:59:00+09:00'],
    ['11.30(일)까지', '2026-11-30T23:59:00+09:00'],
    ['11/30까지', '2026-11-30T23:59:00+09:00'],
    ['11월 30일 23시 59분', '2026-11-30T23:59:00+09:00'],
    ['11월 30일(월) 오후 11시 59분까지', '2026-11-30T23:59:00+09:00'],
    ['2026.11.30 23:59', '2026-11-30T23:59:00+09:00'],
    ['2026. 11. 30. 23:59:59', '2026-11-30T23:59:59+09:00'],
    ['2026년 11월 30일까지', '2026-11-30T23:59:00+09:00'],
    ['2026-11-30', '2026-11-30T23:59:00+09:00'],
    ['12.03 00:00', '2026-12-03T00:00:00+09:00'],
    ['12.03(목) 오전 10시 마감', '2026-12-03T10:00:00+09:00'],
    ['26.11.30 23:59', '2026-11-30T23:59:00+09:00'],
    ['11.30. 23:59', '2026-11-30T23:59:00+09:00'],
    ['12.03. 10:00', '2026-12-03T10:00:00+09:00'],
    ['12월 3일 0시', '2026-12-03T00:00:00+09:00'],
    ['12월 3일 정오까지', '2026-12-03T12:00:00+09:00'],
    ['세일 종료 11.30', '2026-11-30T23:59:00+09:00'],
    ['기간 : 11.30(일) 23:59 까지', '2026-11-30T23:59:00+09:00'],
  ])('reads "%s"', (text, expected) => {
    expect(parseKoreanEndDate(text, NOW)).toBe(expected);
  });

  it('reads 자정 of a date as 24:00, i.e. 00:00:00 of the next day', () => {
    expect(parseKoreanEndDate('11월 30일 자정까지', NOW)).toBe('2026-12-01T00:00:00+09:00');
    expect(parseKoreanEndDate('11.30 24:00', NOW)).toBe('2026-12-01T00:00:00+09:00');
    expect(parseKoreanEndDate('11월 30일 밤 12시까지', NOW)).toBe('2026-12-01T00:00:00+09:00');
  });

  it('reads full-width characters the same as ASCII', () => {
    expect(parseKoreanEndDate('～１１．３０（일）　２３：５９', NOW)).toBe('2026-11-30T23:59:00+09:00');
  });

  it('takes the end of a range', () => {
    expect(parseKoreanEndDate('11.22 ~ 12.03', NOW)).toBe('2026-12-03T23:59:00+09:00');
    expect(parseKoreanEndDate('11.22(일) 19:00 ~ 12.03(목) 00:00', NOW)).toBe(
      '2026-12-03T00:00:00+09:00',
    );
    expect(parseKoreanEndDate('2026-11-22 - 2026-12-03', NOW)).toBe('2026-12-03T23:59:00+09:00');
    expect(parseKoreanEndDate('25.11.24 - 25.12.03', NOW)).toBe('2025-12-03T23:59:00+09:00');
    expect(parseKoreanEndDate('1차 11.22 ~ 11.30', NOW)).toBe('2026-11-30T23:59:00+09:00');
    expect(parseKoreanEndDate('11월 22일부터 12월 3일까지', NOW)).toBe('2026-12-03T23:59:00+09:00');
  });

  it('takes the year of a range end from the start when only the start has one', () => {
    const later = new Date('2027-03-01T03:00:00Z');
    expect(parseKoreanEndDate('2024.11.22 ~ 12.03', later)).toBe('2024-12-03T23:59:00+09:00');
    expect(parseKoreanEndDate('2024.12.20 ~ 01.05', later)).toBe('2025-01-05T23:59:00+09:00');
  });

  it('returns null for a range that has a start but no end', () => {
    expect(parseKoreanEndDate('11.22 ~', NOW)).toBeNull();
    expect(parseKoreanEndDate('11.22부터', NOW)).toBeNull();
  });
});

describe('parseKoreanEndDate — omitted year', () => {
  it('uses the year of now', () => {
    expect(parseKoreanEndDate('12.25까지', NOW)).toBe('2026-12-25T23:59:00+09:00');
  });

  it('keeps a date that ended up to 60 days ago in the year of now', () => {
    expect(parseKoreanEndDate('11.20까지', NOW)).toBe('2026-11-20T23:59:00+09:00');
    expect(parseKoreanEndDate('10.01까지', NOW)).toBe('2026-10-01T23:59:00+09:00');
  });

  it('rolls over to next year when the date lands more than 60 days before now', () => {
    expect(parseKoreanEndDate('1.5까지', NOW)).toBe('2027-01-05T23:59:00+09:00');
    expect(parseKoreanEndDate('12.20 ~ 01.05', new Date('2026-12-28T03:00:00Z'))).toBe(
      '2027-01-05T23:59:00+09:00',
    );
  });

  it('reads the year in KST just after the Korean new year', () => {
    // 2026-12-31T15:30:00Z is already 2027-01-01 00:30 in Korea.
    const kstNewYear = new Date('2026-12-31T15:30:00Z');
    expect(parseKoreanEndDate('1.3까지', kstNewYear)).toBe('2027-01-03T23:59:00+09:00');
  });

  it('returns null when the day does not exist in the chosen year', () => {
    expect(parseKoreanEndDate('2월 29일까지', new Date('2026-02-01T03:00:00Z'))).toBeNull();
    expect(parseKoreanEndDate('2월 29일까지', new Date('2028-02-01T03:00:00Z'))).toBe(
      '2028-02-29T23:59:00+09:00',
    );
  });
});

describe('parseKoreanEndDate — relative wording', () => {
  it.each([
    ['D-2', '2026-11-29T23:59:00+09:00'],
    ['d-2', '2026-11-29T23:59:00+09:00'],
    ['D-DAY', '2026-11-27T23:59:00+09:00'],
    ['D-Day 마감임박', '2026-11-27T23:59:00+09:00'],
    ['D-0', '2026-11-27T23:59:00+09:00'],
    ['D - 2', '2026-11-29T23:59:00+09:00'],
    ['오늘 오후 6시 마감', '2026-11-27T18:00:00+09:00'],
    ['모레 종료', '2026-11-29T23:59:00+09:00'],
    ['1일 2시간 남음', '2026-11-28T14:00:00+09:00'],
    ['오늘 마감', '2026-11-27T23:59:00+09:00'],
    ['오늘 23:59 마감', '2026-11-27T23:59:00+09:00'],
    ['오늘 자정까지', '2026-11-28T00:00:00+09:00'],
    ['내일 마감', '2026-11-28T23:59:00+09:00'],
    ['내일 오전 10시까지', '2026-11-28T10:00:00+09:00'],
    ['3일 남음', '2026-11-30T23:59:00+09:00'],
    ['5시간 남음', '2026-11-27T17:00:00+09:00'],
    ['30분 남음', '2026-11-27T12:30:00+09:00'],
    ['5시간 30분 남음', '2026-11-27T17:30:00+09:00'],
  ])('reads "%s"', (text, expected) => {
    expect(parseKoreanEndDate(text, NOW)).toBe(expected);
  });

  it('crosses month and year boundaries when counting days', () => {
    const lateDecember = new Date('2026-12-30T03:00:00Z');
    expect(parseKoreanEndDate('D-5', NOW)).toBe('2026-12-02T23:59:00+09:00');
    expect(parseKoreanEndDate('3일 남음', lateDecember)).toBe('2027-01-02T23:59:00+09:00');
    expect(parseKoreanEndDate('내일 마감', new Date('2026-12-31T03:00:00Z'))).toBe(
      '2027-01-01T23:59:00+09:00',
    );
  });

  it('counts "today" in KST even when the UTC date is still the previous day', () => {
    // 2026-11-27T15:30:00Z is 2026-11-28 00:30 in Korea.
    const justAfterKstMidnight = new Date('2026-11-27T15:30:00Z');
    expect(parseKoreanEndDate('오늘 마감', justAfterKstMidnight)).toBe('2026-11-28T23:59:00+09:00');
    expect(parseKoreanEndDate('D-2', justAfterKstMidnight)).toBe('2026-11-30T23:59:00+09:00');
    // 2026-11-27T14:59:59Z is 2026-11-27 23:59:59 in Korea.
    const justBeforeKstMidnight = new Date('2026-11-27T14:59:59Z');
    expect(parseKoreanEndDate('오늘 마감', justBeforeKstMidnight)).toBe('2026-11-27T23:59:00+09:00');
    expect(parseKoreanEndDate('5시간 남음', justBeforeKstMidnight)).toBe('2026-11-28T04:59:59+09:00');
  });

  it('prefers an explicit date over a countdown in the same text', () => {
    expect(parseKoreanEndDate('11월 30일 자정까지 D-DAY', NOW)).toBe('2026-12-01T00:00:00+09:00');
  });
});

describe('parseKoreanEndDate — never guesses', () => {
  it.each([
    [''],
    ['   '],
    ['상시'],
    ['재고 소진 시'],
    ['99.99'],
    ['13.01까지'],
    ['13월 1일까지'],
    ['11.32까지'],
    ['11월 32일'],
    ['2.30까지'],
    ['2026-02-30'],
    ['2026.13.01'],
    ['11.30 25:00'],
    ['11.30 23:60'],
    ['11.30 24:30'],
    ['11월 30일 밤 12시 30분까지'],
    ['11-30까지'],
    ['3시간 남음 (11.27)'],
    ['자정까지'],
    ['마감임박'],
    ['D+3'],
    ['D-'],
  ])('returns null for "%s"', (text) => {
    expect(parseKoreanEndDate(text, NOW)).toBeNull();
  });

  it('returns null when the hour is ambiguous between morning and evening', () => {
    expect(parseKoreanEndDate('11월 30일 6시까지', NOW)).toBeNull();
    expect(parseKoreanEndDate('11월 30일 12시까지', NOW)).toBeNull();
    expect(parseKoreanEndDate('11월 30일 오전 13시까지', NOW)).toBeNull();
  });

  it('returns null for numbers that are not dates', () => {
    expect(parseKoreanEndDate('최대 3.5% 할인', NOW)).toBeNull();
    expect(parseKoreanEndDate('2.5일 남음', NOW)).toBeNull();
    expect(parseKoreanEndDate('11.30까지 최대 80% 할인', NOW)).toBeNull();
    expect(parseKoreanEndDate('11.30 12.03', NOW)).toBeNull();
  });

  it('returns null for wording that is not a sale end', () => {
    expect(parseKoreanEndDate('오늘출발', NOW)).toBeNull();
    expect(parseKoreanEndDate('오늘의 특가', NOW)).toBeNull();
    expect(parseKoreanEndDate('11.22(일) 19:00 오픈', NOW)).toBeNull();
    expect(parseKoreanEndDate('12.03 발송 예정', NOW)).toBeNull();
  });

  it('returns null when now is not a valid date', () => {
    expect(parseKoreanEndDate('D-2', new Date(Number.NaN))).toBeNull();
    expect(parseKoreanEndDate('11.30까지', new Date(Number.NaN))).toBeNull();
  });

  it('does not mutate now', () => {
    const now = new Date(NOW.getTime());
    parseKoreanEndDate('3일 남음', now);
    expect(now.getTime()).toBe(NOW.getTime());
  });
});

describe('isExpired', () => {
  it('is false when the end time is unknown', () => {
    expect(isExpired(null, NOW)).toBe(false);
  });

  it('is false when the end time cannot be read', () => {
    expect(isExpired('not a date', NOW)).toBe(false);
    expect(isExpired('', NOW)).toBe(false);
  });

  it('is true when the end time is before now', () => {
    expect(isExpired('2026-11-27T11:59:59+09:00', NOW)).toBe(true);
    expect(isExpired('2026-11-27T02:59:59Z', NOW)).toBe(true);
  });

  it('is false when the end time is now or later', () => {
    expect(isExpired('2026-11-27T12:00:00+09:00', NOW)).toBe(false);
    expect(isExpired('2026-11-27T12:00:01+09:00', NOW)).toBe(false);
    expect(isExpired('2026-11-30T23:59:00+09:00', NOW)).toBe(false);
  });

  it('compares instants, not text', () => {
    // 23:59 KST on the 27th is 14:59 UTC; "now" below is 15:00 UTC the same day.
    expect(isExpired('2026-11-27T23:59:00+09:00', new Date('2026-11-27T15:00:00Z'))).toBe(true);
    expect(isExpired('2026-11-27T23:59:00+09:00', new Date('2026-11-27T14:58:00Z'))).toBe(false);
  });
});

describe('machine time zone independence', () => {
  afterEach(restoreTimeZone);

  it.each([['UTC'], ['Asia/Seoul'], ['America/Los_Angeles'], ['Pacific/Kiritimati']])(
    'gives the same answers with TZ=%s',
    (timeZone) => {
      process.env.TZ = timeZone;

      expect(toKstIso('2026-11-28 00:00:00')).toBe('2026-11-28T00:00:00+09:00');
      expect(toKstIso('2026-11-28')).toBe('2026-11-28T23:59:00+09:00');
      expect(toKstIso('2026-11-30T14:59:00Z')).toBe('2026-11-30T23:59:00+09:00');
      expect(parseKoreanEndDate('~11.30(일) 23:59', NOW)).toBe('2026-11-30T23:59:00+09:00');
      expect(parseKoreanEndDate('11월 30일 자정까지', NOW)).toBe('2026-12-01T00:00:00+09:00');
      expect(parseKoreanEndDate('오늘 마감', new Date('2026-11-27T15:30:00Z'))).toBe(
        '2026-11-28T23:59:00+09:00',
      );
      expect(parseKoreanEndDate('D-2', new Date('2026-11-27T14:59:59Z'))).toBe(
        '2026-11-29T23:59:00+09:00',
      );
      expect(isExpired('2026-11-27 23:59:00', new Date('2026-11-27T15:00:00Z'))).toBe(true);
    },
  );
});
