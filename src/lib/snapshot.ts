/**
 * 공개 배포판이 읽는 할인 스냅샷의 형식과 검증. 브라우저에서도 쓰므로 Node API를 쓰지 않는다.
 * 파일은 `npm run snapshot`(src/crawler/snapshot.ts)이 `public/snapshot/deals.json`에 쓴다.
 */
import { isSiteId } from '@/lib/types';
import type { Deal, IsoDateTime } from '@/lib/types';

/** 배포판이 스냅샷을 받아 오는 주소 (public/ 아래 정적 파일). */
export const SNAPSHOT_PUBLIC_PATH = '/snapshot/deals.json';

export interface DealsSnapshot {
  /** 스냅샷을 내보낸 시각 */
  exportedAt: IsoDateTime;
  /** 마지막으로 수집에 성공한 시각. 모르면 null */
  lastUpdatedAt: IsoDateTime | null;
  /** 모든 사이트의 할인 (종료된 것 포함 — 거르는 일은 화면이 한다) */
  deals: Deal[];
}

const INVALID_SNAPSHOT_MESSAGE = '할인 스냅샷의 형식이 올바르지 않습니다.';
const HTTP_URL = /^https?:\/\//i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 화면이 믿고 쓰는 최소한만 확인한다: 식별자, 아는 사이트, 이름, http(s) 상품 주소, 숫자 할인가.
 * 상품 주소는 그대로 링크가 되므로 http(s)가 아닌 것(`javascript:` 등)은 받지 않는다.
 */
function isSnapshotDeal(value: unknown): value is Deal {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    isSiteId(value.siteId) &&
    typeof value.name === 'string' &&
    typeof value.url === 'string' &&
    HTTP_URL.test(value.url) &&
    typeof value.salePrice === 'number' &&
    Number.isFinite(value.salePrice)
  );
}

/** 받아 온 JSON을 검증해 스냅샷으로 돌려준다. 모양이 틀리면 오류를 던진다 (틀린 값을 지어내지 않는다). */
export function parseSnapshot(raw: unknown): DealsSnapshot {
  if (!isRecord(raw) || typeof raw.exportedAt !== 'string' || !Array.isArray(raw.deals)) {
    throw new Error(INVALID_SNAPSHOT_MESSAGE);
  }
  const deals: unknown[] = raw.deals;
  if (!deals.every(isSnapshotDeal)) throw new Error(INVALID_SNAPSHOT_MESSAGE);
  return {
    exportedAt: raw.exportedAt,
    lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : null,
    deals,
  };
}
