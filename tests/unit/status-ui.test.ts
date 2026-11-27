import { describe, expect, it } from 'vitest';
import type { SiteStatusView } from '@/lib/types';
import {
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  autoCrawlText,
  cooldownText,
  crawlStartNotice,
  createResponseSequence,
  describeSkipped,
  hasActiveCrawl,
  markQueued,
  patchSite,
  pollIntervalMs,
} from '@/lib/status-ui';
import { formatTimeOfDay } from '@/lib/time';

// 기준 시각: 2026-11-27 21:00 KST
const NOW = new Date('2026-11-27T21:00:00+09:00');

function site(siteId: SiteStatusView['siteId'], over: Partial<SiteStatusView> = {}): SiteStatusView {
  return {
    siteId,
    displayName: siteId,
    enabled: true,
    state: 'ok',
    lastRunAt: null,
    lastSuccessAt: null,
    dealCount: 0,
    message: null,
    cooldownUntil: null,
    run: 'idle',
    ...over,
  };
}

describe('수집 중 판단과 새로고침 간격', () => {
  it('queued 또는 running인 사이트가 하나라도 있으면 3초마다 읽는다', () => {
    expect(hasActiveCrawl([site('musinsa'), site('29cm', { run: 'queued' })])).toBe(true);
    expect(hasActiveCrawl([site('musinsa', { run: 'running' })])).toBe(true);
    expect(pollIntervalMs([site('musinsa', { run: 'running' })])).toBe(POLL_ACTIVE_MS);
    expect(POLL_ACTIVE_MS).toBe(3_000);
  });

  it('모두 idle이거나 아직 못 읽었으면 느린 간격으로 돌아간다', () => {
    expect(hasActiveCrawl([site('musinsa'), site('29cm')])).toBe(false);
    expect(hasActiveCrawl(null)).toBe(false);
    expect(pollIntervalMs([site('musinsa')])).toBe(POLL_IDLE_MS);
    expect(pollIntervalMs(null)).toBe(POLL_IDLE_MS);
  });
});

describe('건너뛴 사이트 안내', () => {
  it('건너뛴 이유를 한글로 바꾼다', () => {
    expect(
      describeSkipped([
        { siteId: 'naver', reason: 'cooldown' },
        { siteId: 'zigzag', reason: 'disabled' },
        { siteId: 'musinsa', reason: 'running' },
        { siteId: 'ably', reason: 'not_implemented' },
      ]),
    ).toEqual(['네이버쇼핑 — 쿨다운 중', '지그재그 — 꺼짐', '무신사 — 이미 수집 중', '에이블리 — 준비 중']);
  });

  it('skipped가 없으면 빈 목록', () => {
    expect(describeSkipped(undefined)).toEqual([]);
    expect(describeSkipped([])).toEqual([]);
  });

  it('시작한 사이트와 건너뛴 사이트를 함께 알린다', () => {
    const notice = crawlStartNotice(
      { started: ['musinsa', '29cm'], skipped: [{ siteId: 'naver', reason: 'cooldown' }] },
      '전체',
    );
    expect(notice.tone).toBe('info');
    expect(notice.text).toContain('전체 수집을 시작했습니다');
    expect(notice.text).toContain('1곳');
    expect(notice.items).toEqual(['네이버쇼핑 — 쿨다운 중']);
  });

  it('건너뛴 곳이 없으면 목록 없이 시작만 알린다', () => {
    const notice = crawlStartNotice({ started: ['musinsa'] }, '무신사');
    expect(notice.text).toContain('무신사 수집을 시작했습니다');
    expect(notice.items).toBeUndefined();
  });

  it('아무것도 시작하지 못했으면 이유를 사이트별로 보여 준다', () => {
    const notice = crawlStartNotice(
      {
        started: [],
        skipped: [
          { siteId: 'naver', reason: 'cooldown' },
          { siteId: 'ably', reason: 'not_implemented' },
        ],
      },
      '전체',
    );
    expect(notice.text).toContain('시작한 수집이 없습니다');
    expect(notice.items).toEqual(['네이버쇼핑 — 쿨다운 중', '에이블리 — 준비 중']);
  });

  it('이유를 받지 못했을 때만 일반 문구를 쓴다', () => {
    const notice = crawlStartNotice({ started: [] }, '전체');
    expect(notice.text).toContain('지금 수집할 수 있는 사이트가 없습니다');
    expect(notice.items).toBeUndefined();
  });
});

describe('차단 해제 예정 시각', () => {
  it('차단된 사이트는 쿨다운이 끝나는 시각을 KST로 보여 준다', () => {
    const blocked = site('naver', { state: 'blocked', cooldownUntil: '2026-11-27T23:30:00+09:00' });
    expect(cooldownText(blocked, NOW)).toBe('차단 해제 예정 23:30');
  });

  it('다른 시간대 표기로 받아도 KST 시각으로 바꾼다', () => {
    // 13:15Z = 22:15 KST
    const blocked = site('naver', { state: 'blocked', cooldownUntil: '2026-11-27T13:15:00Z' });
    expect(cooldownText(blocked, NOW)).toBe('차단 해제 예정 22:15');
  });

  it('자정을 넘기면 날짜를 함께 쓴다', () => {
    const blocked = site('naver', { state: 'blocked', cooldownUntil: '2026-11-28T03:00:00+09:00' });
    expect(cooldownText(blocked, NOW)).toBe('차단 해제 예정 11/28 03:00');
  });

  it('차단이 아니거나, 시각을 모르거나, 이미 지났으면 표시하지 않는다', () => {
    expect(cooldownText(site('naver', { state: 'failed', cooldownUntil: '2026-11-27T23:30:00+09:00' }), NOW)).toBeNull();
    expect(cooldownText(site('naver', { state: 'blocked', cooldownUntil: null }), NOW)).toBeNull();
    expect(cooldownText(site('naver', { state: 'blocked', cooldownUntil: '날짜 아님' }), NOW)).toBeNull();
    expect(cooldownText(site('naver', { state: 'blocked', cooldownUntil: '2026-11-27T20:59:00+09:00' }), NOW)).toBeNull();
  });

  it('formatTimeOfDay: 같은 날은 HH:mm, 다른 날은 M/D HH:mm, 모르면 "알 수 없음"', () => {
    expect(formatTimeOfDay('2026-11-27T09:05:00+09:00', NOW)).toBe('09:05');
    expect(formatTimeOfDay('2026-11-28T00:00:00+09:00', NOW)).toBe('11/28 00:00');
    expect(formatTimeOfDay(null, NOW)).toBe('알 수 없음');
  });
});

describe('늦게 도착한 응답 버리기', () => {
  it('보낸 순서대로 도착하면 모두 반영한다', () => {
    const sequence = createResponseSequence();
    const first = sequence.begin();
    const second = sequence.begin();
    expect(sequence.accept(first)).toBe(true);
    expect(sequence.accept(second)).toBe(true);
  });

  it('더 새 응답이 반영된 뒤에 온 옛 응답은 버린다', () => {
    const sequence = createResponseSequence();
    const first = sequence.begin();
    const second = sequence.begin();
    expect(sequence.accept(second)).toBe(true);
    expect(sequence.accept(first)).toBe(false);
  });

  it('같은 응답을 두 번 반영하지 않는다', () => {
    const sequence = createResponseSequence();
    const only = sequence.begin();
    expect(sequence.accept(only)).toBe(true);
    expect(sequence.accept(only)).toBe(false);
  });

  it('invalidate 이전에 보낸 요청의 응답은 모두 버리고, 그 뒤 요청은 반영한다', () => {
    const sequence = createResponseSequence();
    const before = sequence.begin();
    sequence.invalidate();
    const after = sequence.begin();
    expect(sequence.accept(before)).toBe(false);
    expect(sequence.accept(after)).toBe(true);
  });
});

describe('화면에 먼저 반영하기', () => {
  it('방금 시작한 사이트만 queued로 바꾸고 원본은 그대로 둔다', () => {
    const before = [site('musinsa'), site('29cm'), site('wconcept', { run: 'running' })];
    const after = markQueued(before, ['musinsa', 'wconcept']);
    expect(after.map((s) => s.run)).toEqual(['queued', 'idle', 'running']);
    expect(before.map((s) => s.run)).toEqual(['idle', 'idle', 'running']);
  });

  it('한 사이트만 고치고 나머지 줄은 건드리지 않는다', () => {
    const before = [site('musinsa'), site('29cm')];
    const after = patchSite(before, '29cm', { enabled: false, state: 'disabled' });
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toMatchObject({ siteId: '29cm', enabled: false, state: 'disabled', displayName: '29cm' });
    expect(before[1].enabled).toBe(true);
  });

  it('서버가 일부 필드만 돌려줘도 이름과 수집 여부는 남는다', () => {
    const before = [site('musinsa', { displayName: '무신사', run: 'running' })];
    const after = patchSite(before, 'musinsa', { enabled: false, state: 'disabled', displayName: undefined });
    expect(after[0].displayName).toBe('무신사');
    expect(after[0].run).toBe('running');
  });
});

describe('autoCrawlText', () => {
  const now = new Date('2026-11-28T00:50:00+09:00');

  it('shows the interval in hours and the next run time in KST', () => {
    const info = { intervalMinutes: 60, nextRunAt: '2026-11-28T01:26:00+09:00' };

    expect(autoCrawlText(info, now)).toBe('자동 수집: 1시간마다 · 다음 수집 01:26');
  });

  it('shows minutes when the interval is not a whole number of hours', () => {
    const info = { intervalMinutes: 90, nextRunAt: '2026-11-28T01:26:00+09:00' };

    expect(autoCrawlText(info, now)).toBe('자동 수집: 90분마다 · 다음 수집 01:26');
  });

  it('adds the date when the next run is on another day', () => {
    const info = { intervalMinutes: 360, nextRunAt: '2026-11-29T03:00:00+09:00' };

    expect(autoCrawlText(info, now)).toBe('자동 수집: 6시간마다 · 다음 수집 11/29 03:00');
  });

  it('says a scheduled run is in progress when there is no next time yet', () => {
    expect(autoCrawlText({ intervalMinutes: 60, nextRunAt: null }, now)).toBe('자동 수집: 1시간마다 · 지금 수집 중');
  });

  it('says so when automatic crawling is off, and shows nothing when the server does not report it', () => {
    expect(autoCrawlText(null, now)).toContain('꺼짐');
    expect(autoCrawlText(undefined, now)).toBeNull();
  });
});
