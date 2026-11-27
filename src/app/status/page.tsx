'use client';

import { useState } from 'react';
import type { SiteId, SiteStatusView } from '@/lib/types';
import { ApiError, setSiteEnabled, startCrawl } from '@/lib/api';
import { POLL_IDLE_MS, cooldownText, crawlStartNotice, hasActiveCrawl, siteName, type Notice } from '@/lib/status-ui';
import { AppHeader } from '@/components/AppHeader';
import { SiteStatusRow } from '@/components/SiteStatusRow';
import { useNow } from '@/components/useNow';
import { useSiteStatus, type SiteStatusStore } from '@/components/useSiteStatus';

/** 서버가 보낸 한글 문장(ApiError)만 그대로 보여 주고, 그 밖의 오류는 준비된 문구로 바꾼다. */
function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.message ? cause.message : fallback;
}

/** 수집 시작·강제 재시도·켜기/끄기. 실패는 삼키지 않고 안내 영역(notice)에 보여 준다. */
function useStatusActions({ refresh, patch, markStarted }: SiteStatusStore, now: Date) {
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 켜기/끄기 요청을 보내는 중인 사이트 */
  const [toggling, setToggling] = useState<SiteId[]>([]);

  const crawl = async (siteId: SiteId | 'all', label: string, force: boolean) => {
    setNotice(null);
    try {
      const result = await startCrawl(siteId, { force });
      setNotice(crawlStartNotice(result, label));
      if (result.started.length > 0) markStarted(result.started);
      else void refresh();
    } catch (cause) {
      setNotice({ tone: 'error', text: messageOf(cause, `${label} 수집을 시작하지 못했습니다.`) });
      void refresh();
    }
  };

  const forceRetry = (site: SiteStatusView) => {
    const name = siteName(site);
    const until = cooldownText(site, now);
    // 차단 뒤 쉬는 시간을 건너뛰는 것은 사람이 직접 확인하고 결정한다 (헌법 II).
    const ok = window.confirm(
      `${name}은(는) 차단이 감지된 사이트입니다${until ? ` (${until})` : ''}.\n사이트에 직접 접속해 문제가 풀렸는지 확인하셨나요? 그래도 지금 수집할까요?`,
    );
    if (ok) void crawl(site.siteId, name, true);
  };

  const toggle = async (site: SiteStatusView, enabled: boolean) => {
    setNotice(null);
    setToggling((ids) => [...ids, site.siteId]);
    // 먼저 화면에 반영하고, 실패하면 되돌린다. 켤 때의 실제 상태는 서버 응답으로 채운다.
    patch(site.siteId, { enabled, state: enabled ? site.state : 'disabled' });
    try {
      patch(site.siteId, await setSiteEnabled(site.siteId, enabled));
    } catch (cause) {
      patch(site.siteId, { enabled: site.enabled, state: site.state });
      const fallback = `${siteName(site)} ${enabled ? '켜기' : '끄기'}에 실패했습니다.`;
      setNotice({ tone: 'error', text: messageOf(cause, fallback) });
      void refresh();
    } finally {
      setToggling((ids) => ids.filter((id) => id !== site.siteId));
    }
  };

  return { notice, toggling, crawl, forceRetry, toggle };
}

function NoticeBox({ notice }: { notice: Notice }) {
  const tone = notice.tone === 'error' ? 'bg-[#FDECEE] text-[#9B0C1F]' : 'bg-[#EEF0F3] text-[#3D4249]';
  return (
    <div className={`rounded-lg px-3.5 py-2.5 text-sm ${tone}`}>
      <p>{notice.text}</p>
      {notice.items && (
        <ul className="mt-1 list-disc pl-5">
          {notice.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 rounded-lg bg-[#FDECEE] px-3.5 py-3 text-sm text-[#9B0C1F]">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-1 font-bold underline underline-offset-2">
        다시 불러오기
      </button>
    </div>
  );
}

export default function StatusPage() {
  const status = useSiteStatus();
  const { sites, loadError, refresh } = status;
  const now = useNow(POLL_IDLE_MS);
  const { notice, toggling, crawl, forceRetry, toggle } = useStatusActions(status, now);
  // 이 화면에서 시작했든 다른 곳(CLI 등)에서 시작했든 서버가 알려 주는 대로 따른다.
  const anyActive = hasActiveCrawl(sites);

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
            onClick={() => void crawl('all', '전체', false)}
            disabled={!sites || anyActive}
            className="h-11 shrink-0 rounded-full bg-[#15171A] px-5 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] disabled:cursor-not-allowed disabled:bg-[#C9CDD3]"
          >
            {anyActive ? '수집 중…' : '전체 수집'}
          </button>
        </div>

        <div aria-live="polite" className="mt-3 min-h-0">
          {notice && <NoticeBox notice={notice} />}
        </div>

        {loadError && <LoadError message={loadError} onRetry={() => void refresh()} />}

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
                busy={anyActive}
                toggling={toggling.includes(site.siteId)}
                onCrawl={(target) => void crawl(target.siteId, siteName(target), false)}
                onForceRetry={forceRetry}
                onToggle={(target, enabled) => void toggle(target, enabled)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
