'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AutoCrawlInfo, SiteId, SiteStatusView, StatusResponse } from '@/lib/types';
import { ApiError, getStatus } from '@/lib/api';
import { createResponseSequence, markQueued, patchSite, pollIntervalMs } from '@/lib/status-ui';

const LOAD_ERROR_FALLBACK = '수집 상태를 불러오지 못했습니다.';

export interface SiteStatusStore {
  /** 아직 한 번도 못 읽었으면 null */
  sites: SiteStatusView[] | null;
  /** 자동 수집 설정. 꺼져 있으면 null, 아직 못 읽었거나 서버가 알려 주지 않으면 undefined */
  autoCrawl: AutoCrawlInfo | null | undefined;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** 서버 응답을 기다리지 않고 한 줄을 먼저 고친다. */
  patch: (siteId: SiteId, change: Partial<SiteStatusView>) => void;
  /** 방금 시작한 사이트를 "대기 중"으로 표시해 빠른 새로고침을 시작한다. */
  markStarted: (started: readonly SiteId[]) => void;
}

async function loadStatus(): Promise<StatusResponse> {
  const result = await getStatus();
  if (!Array.isArray(result?.sites)) throw new ApiError(LOAD_ERROR_FALLBACK, 0);
  return result;
}

/**
 * 수집 상태를 읽고 주기적으로 새로 읽는다. 간격은 서버가 알려 주는 `run`으로 정한다:
 * 대기·수집 중인 사이트가 있으면 3초, 없으면 30초 (다른 곳에서 시작한 수집도 따라간다).
 */
export function useSiteStatus(): SiteStatusStore {
  const [sites, setSites] = useState<SiteStatusView[] | null>(null);
  const [autoCrawl, setAutoCrawl] = useState<AutoCrawlInfo | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 응답이 보낸 순서와 다르게 도착해도 옛 값이 새 값을 덮어쓰지 않게 한다.
  const [sequence] = useState(createResponseSequence);

  const refresh = useCallback(async () => {
    const seq = sequence.begin();
    let next: StatusResponse | null = null;
    let error: string | null = null;
    try {
      next = await loadStatus();
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : LOAD_ERROR_FALLBACK;
    }
    if (!sequence.accept(seq)) return;
    if (next) {
      setSites(next.sites);
      setAutoCrawl(next.autoCrawl);
    }
    setLoadError(error);
  }, [sequence]);

  // 처음 한 번 읽는다. 화면을 떠난 뒤에 도착하는 응답은 버린다.
  useEffect(() => {
    void refresh();
    return () => sequence.invalidate();
  }, [refresh, sequence]);

  const interval = pollIntervalMs(sites);
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), interval);
    return () => window.clearInterval(timer);
  }, [refresh, interval]);

  // 화면에서 직접 고친 값이 그 전에 보낸 조회의 응답으로 되돌아가지 않게, 진행 중인 조회는 버린다.
  const patch = useCallback(
    (siteId: SiteId, change: Partial<SiteStatusView>) => {
      sequence.invalidate();
      setSites((current) => (current ? patchSite(current, siteId, change) : current));
    },
    [sequence],
  );

  const markStarted = useCallback(
    (started: readonly SiteId[]) => {
      sequence.invalidate();
      setSites((current) => (current ? markQueued(current, started) : current));
    },
    [sequence],
  );

  return { sites, autoCrawl, loadError, refresh, patch, markStarted };
}
