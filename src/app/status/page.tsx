'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteId } from '@/lib/types';
import { getStatus, startCrawl } from '@/lib/api';
import { formatDateTime } from '@/lib/time';
import { AppHeader } from '@/components/AppHeader';
import { SiteStatusRow, type SiteStatusView } from '@/components/SiteStatusRow';
import { useNow } from '@/components/useNow';

/** 수집 중에는 3초마다, 평소에는 30초마다 상태를 새로 읽는다. */
const REFRESH_RUNNING_MS = 3_000;
const REFRESH_IDLE_MS = 30_000;
/** 전체 수집 목표 시간(30분)이 지나도 결과가 없으면 "수집 중" 표시를 내린다. */
const RUNNING_TIMEOUT_MS = 30 * 60 * 1000;

interface Notice {
  tone: 'info' | 'error';
  text: string;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function StatusPage() {
  const [sites, setSites] = useState<SiteStatusView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 이 화면에서 시작한 수집: siteId → 시작한 시각(ms) */
  const [running, setRunning] = useState<Partial<Record<SiteId, number>>>({});
  const now = useNow(REFRESH_IDLE_MS);
  const runningRef = useRef(running);
  runningRef.current = running;

  const refresh = useCallback(async () => {
    try {
      const result = await getStatus();
      const list: SiteStatusView[] = result.sites;
      setSites(list);
      setLoadError(null);

      // 시작한 뒤에 수집 기록이 갱신됐거나 너무 오래 걸리면 "수집 중"을 내린다.
      const current = runningRef.current;
      const next: Partial<Record<SiteId, number>> = {};
      for (const site of list) {
        const startedAt = current[site.siteId];
        if (startedAt === undefined) continue;
        const lastRun = site.lastRunAt ? Date.parse(site.lastRunAt) : 0;
        const finished = lastRun >= startedAt - 1000;
        const timedOut = Date.now() - startedAt > RUNNING_TIMEOUT_MS;
        if (!finished && !timedOut) next[site.siteId] = startedAt;
      }
      if (Object.keys(next).length !== Object.keys(current).length) setRunning(next);
    } catch (cause) {
      setLoadError(messageOf(cause, '수집 상태를 불러오지 못했습니다.'));
    }
  }, []);

  const anyRunning = Object.keys(running).length > 0;

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), anyRunning ? REFRESH_RUNNING_MS : REFRESH_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [refresh, anyRunning]);

  const crawl = async (siteId: SiteId | 'all', force: boolean, label: string) => {
    const startedAt = Date.now();
    setNotice(null);
    try {
      const result = await startCrawl(siteId, force ? { force: true } : undefined);
      const started: SiteId[] = result.started;
      if (started.length === 0) {
        setNotice({ tone: 'info', text: '지금 수집할 수 있는 사이트가 없습니다. 꺼져 있거나 쉬는 중인지 확인하세요.' });
        return;
      }
      setRunning((previous) => {
        const next = { ...previous };
        for (const id of started) next[id] = startedAt;
        return next;
      });
      setNotice({ tone: 'info', text: `${label} 수집을 시작했습니다. 끝나면 이 화면에 결과가 표시됩니다.` });
    } catch (cause) {
      setNotice({ tone: 'error', text: messageOf(cause, `${label} 수집을 시작하지 못했습니다.`) });
    } finally {
      void refresh();
    }
  };

  const crawlSite = (site: SiteStatusView) => {
    const name = site.displayName ?? site.siteId;
    const coolingDown = site.cooldownUntil !== null && Date.parse(site.cooldownUntil) > Date.now();
    if (coolingDown) {
      // 차단 뒤 쉬는 시간을 건너뛰는 것은 사람이 직접 확인하고 결정한다 (헌법 II).
      const ok = window.confirm(
        `${name}은(는) 차단이 감지되어 ${formatDateTime(site.cooldownUntil)}까지 쉬는 중입니다.\n사이트에 직접 접속해 문제가 풀렸는지 확인하셨나요? 그래도 지금 수집할까요?`,
      );
      if (!ok) return;
    }
    void crawl(site.siteId, coolingDown, name);
  };

  return (
    <div className="min-h-screen bg-white text-[#15171A]">
      <AppHeader />

      <main className="mx-auto max-w-4xl px-4 pb-16 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#3D4249]">
            사이트별 수집 결과입니다. 한 곳이 실패해도 다른 사이트의 할인은 그대로 표시됩니다.
          </p>
          <button
            type="button"
            onClick={() => void crawl('all', false, '전체')}
            disabled={!sites || anyRunning}
            className="h-11 shrink-0 rounded-full bg-[#15171A] px-5 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] disabled:cursor-not-allowed disabled:bg-[#C9CDD3]"
          >
            {anyRunning ? '수집 중…' : '전체 수집'}
          </button>
        </div>

        <div aria-live="polite" className="mt-3 min-h-0">
          {notice && (
            <p
              className={`rounded-lg px-3.5 py-2.5 text-sm ${notice.tone === 'error' ? 'bg-[#FDECEE] text-[#9B0C1F]' : 'bg-[#EEF0F3] text-[#3D4249]'}`}
            >
              {notice.text}
            </p>
          )}
        </div>

        {loadError && (
          <div role="alert" className="mt-3 rounded-lg bg-[#FDECEE] px-3.5 py-3 text-sm text-[#9B0C1F]">
            <p>{loadError}</p>
            <button type="button" onClick={() => void refresh()} className="mt-1 font-bold underline underline-offset-2">
              다시 불러오기
            </button>
          </div>
        )}

        {!sites && !loadError && (
          <p className="mt-8 text-sm text-[#8A9099]" aria-busy="true">
            수집 상태를 불러오는 중…
          </p>
        )}

        {sites && (
          <ul className="mt-4 divide-y divide-[#EEF0F3] rounded-xl border border-[#E6E8EC]">
            {sites.map((site) => (
              <SiteStatusRow
                key={site.siteId}
                site={site}
                now={now}
                running={running[site.siteId] !== undefined}
                busy={anyRunning}
                onCrawl={crawlSite}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
