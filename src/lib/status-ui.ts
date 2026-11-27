// 수집 상태 화면의 판단·문구 (화면 없이 테스트할 수 있는 순수 함수만 둔다).
import type { CrawlSkipReason, CrawlStartResponse, SiteId, SiteStatusView } from '@/lib/types';
import { SITE_LABELS } from '@/lib/labels';
import { formatTimeOfDay } from '@/lib/time';

/** 수집 중에는 3초마다, 평소에는 30초마다 상태를 새로 읽는다 (contracts/http-api.md). */
export const POLL_ACTIVE_MS = 3_000;
export const POLL_IDLE_MS = 30_000;

export const SKIP_REASON_LABELS: Readonly<Record<CrawlSkipReason, string>> = {
  cooldown: '쿨다운 중',
  disabled: '꺼짐',
  running: '이미 수집 중',
  not_implemented: '준비 중',
};
const UNKNOWN_SKIP_REASON = '건너뜀';

export interface Notice {
  tone: 'info' | 'error';
  text: string;
  /** 사이트별로 한 줄씩 덧붙이는 설명 (건너뛴 이유 등) */
  items?: string[];
}

/** 화면에 쓰는 사이트 이름: 서버가 준 이름, 없으면 라벨, 그것도 없으면 id. */
export function siteName(site: Pick<SiteStatusView, 'siteId' | 'displayName'>): string {
  return site.displayName || SITE_LABELS[site.siteId] || site.siteId;
}

// ── 수집 중 판단 ────────────────────────────────────────────────────────────

export function isCrawlActive(site: Pick<SiteStatusView, 'run'>): boolean {
  return site.run === 'queued' || site.run === 'running';
}

/** 대기 중이거나 수집 중인 사이트가 하나라도 있는가. 아직 못 읽었으면 false. */
export function hasActiveCrawl(sites: readonly SiteStatusView[] | null): boolean {
  return sites !== null && sites.some(isCrawlActive);
}

export function pollIntervalMs(sites: readonly SiteStatusView[] | null): number {
  return hasActiveCrawl(sites) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

// ── 수집 시작 결과 안내 ─────────────────────────────────────────────────────

/** `네이버쇼핑 — 쿨다운 중`처럼 건너뛴 사이트마다 한 줄. */
export function describeSkipped(skipped: CrawlStartResponse['skipped']): string[] {
  return (skipped ?? []).map(({ siteId, reason }) => {
    const name = SITE_LABELS[siteId] ?? siteId;
    return `${name} — ${SKIP_REASON_LABELS[reason] ?? UNKNOWN_SKIP_REASON}`;
  });
}

/** 수집 시작 응답을 안내 문구로 바꾼다. 아무것도 시작하지 못했으면 이유를 알려 준다. */
export function crawlStartNotice(result: CrawlStartResponse, label: string): Notice {
  const items = describeSkipped(result.skipped);
  const skippedPart = items.length > 0 ? { items } : {};
  if (result.started.length === 0) {
    const text =
      items.length > 0
        ? '시작한 수집이 없습니다. 사이트별 이유는 다음과 같습니다.'
        : '지금 수집할 수 있는 사이트가 없습니다. 꺼져 있거나 쿨다운 중인지 확인하세요.';
    return { tone: 'info', text, ...skippedPart };
  }
  const started = `${label} 수집을 시작했습니다. 끝나면 이 화면에 결과가 표시됩니다.`;
  const text = items.length > 0 ? `${started} ${items.length}곳은 건너뛰었습니다.` : started;
  return { tone: 'info', text, ...skippedPart };
}

// ── 차단 쿨다운 ─────────────────────────────────────────────────────────────

/** 차단된 사이트의 쿨다운이 아직 남아 있으면 `차단 해제 예정 23:30` (KST). 그 밖에는 null. */
export function cooldownText(site: Pick<SiteStatusView, 'state' | 'cooldownUntil'>, now: Date): string | null {
  if (site.state !== 'blocked' || site.cooldownUntil === null) return null;
  const until = Date.parse(site.cooldownUntil);
  if (Number.isNaN(until) || until <= now.getTime()) return null;
  return `차단 해제 예정 ${formatTimeOfDay(site.cooldownUntil, now)}`;
}

// ── 늦게 도착한 응답 버리기 ─────────────────────────────────────────────────

export interface ResponseSequence {
  /** 요청을 보낼 때 번호를 받는다. */
  begin(): number;
  /** 이 응답을 화면에 반영해도 되는가. 더 새 응답이 이미 반영됐으면 false. */
  accept(seq: number): boolean;
  /** 지금까지 보낸 요청의 응답을 모두 버린다 (화면을 떠날 때, 값을 직접 고쳤을 때). */
  invalidate(): void;
}

export function createResponseSequence(): ResponseSequence {
  let issued = 0;
  let applied = 0;
  return {
    begin: () => {
      issued += 1;
      return issued;
    },
    accept: (seq) => {
      if (seq <= applied) return false;
      applied = seq;
      return true;
    },
    invalidate: () => {
      applied = issued;
    },
  };
}

// ── 화면에 먼저 반영하기 (새 배열을 돌려준다) ──────────────────────────────

/** 방금 시작한 사이트를 서버 응답을 기다리지 않고 "대기 중"으로 보여 준다. */
export function markQueued(sites: readonly SiteStatusView[], started: readonly SiteId[]): SiteStatusView[] {
  return sites.map((site) =>
    started.includes(site.siteId) && site.run === 'idle' ? { ...site, run: 'queued' } : site,
  );
}

/** 한 사이트의 줄만 고친다. 값이 없는(undefined) 필드는 기존 값을 그대로 둔다. */
export function patchSite(
  sites: readonly SiteStatusView[],
  siteId: SiteId,
  patch: Partial<SiteStatusView>,
): SiteStatusView[] {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return sites.map((site) => (site.siteId === siteId ? { ...site, ...defined } : site));
}
