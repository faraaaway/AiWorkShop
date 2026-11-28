'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DealsResponse } from '@/lib/types';
import { getDeals } from '@/lib/api';

const LOAD_ERROR_MESSAGE = '할인 목록을 불러오지 못했습니다.';

export interface DealsStore {
  /** 아직 못 읽었으면 null */
  data: DealsResponse | null;
  /** 불러오지 못했을 때 사람이 읽는 문장 */
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * 수집된 할인 전체를 한 번 받아 둔다 (목록·비교 화면 공용).
 * 실제 API는 종료된 할인을 기본으로 빼고 준다. 한 번에 모두 받아 두고 "종료된 할인 보기"는
 * 다른 필터처럼 화면에서 거른다 (토글할 때마다 다시 받지 않아 5,000개에서도 바로 반응한다).
 */
export function useDeals(): DealsStore {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await getDeals({ includeExpired: true });
      setData({ deals: result.deals, lastUpdatedAt: result.lastUpdatedAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : LOAD_ERROR_MESSAGE);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, reload };
}
