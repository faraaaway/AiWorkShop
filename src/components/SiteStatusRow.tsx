import type { SiteState, SiteStatus } from '@/lib/types';
import { SITE_LABELS, SITE_STATE_LABELS } from '@/lib/labels';
import { formatAgo, formatDateTime } from '@/lib/time';

/** `GET /api/status`가 돌려주는 한 줄 (SiteStatus + displayName). */
export type SiteStatusView = SiteStatus & { displayName?: string };

// 색만으로 구분하지 않도록 배지에는 항상 상태 이름을 함께 쓴다.
const STATE_BADGE: Record<SiteState, string> = {
  ok: 'bg-[#E3F5EA] text-[#0B6B34]',
  failed: 'bg-[#FDECEE] text-[#9B0C1F]',
  suspect_layout: 'bg-[#FFF4D6] text-[#5C4400]',
  blocked: 'bg-[#15171A] text-white',
  login_required: 'bg-[#E4EEFF] text-[#1F4FA8]',
  disabled: 'bg-[#EEF0F3] text-[#5B616A]',
  never_run: 'border border-[#DFE2E7] bg-white text-[#5B616A]',
};

interface SiteStatusRowProps {
  site: SiteStatusView;
  now: Date;
  /** 이 화면에서 수집을 시작했고 아직 결과가 오지 않았다 */
  running: boolean;
  /** 다른 수집이 진행 중이라 새로 시작할 수 없다 */
  busy: boolean;
  onCrawl: (site: SiteStatusView) => void;
}

/** 수집 상태 한 줄 (T039): 이름 · 상태 배지 · 마지막 수집 · 건수 · 메시지 · [지금 수집]. */
export function SiteStatusRow({ site, now, running, busy, onCrawl }: SiteStatusRowProps) {
  const name = site.displayName ?? SITE_LABELS[site.siteId] ?? site.siteId;
  const coolingDown = site.cooldownUntil !== null && Date.parse(site.cooldownUntil) > now.getTime();
  const disabled = site.state === 'disabled' || !site.enabled;
  const failedSinceSuccess = site.lastSuccessAt !== null && site.lastSuccessAt !== site.lastRunAt && site.state !== 'ok';

  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2 px-4 py-4 sm:grid-cols-[10rem_1fr_auto] sm:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-col sm:items-start sm:gap-1.5">
        <h2 className="truncate text-base font-bold text-[#15171A]">{name}</h2>
        {running ? (
          <span className="rounded-md bg-[#15171A] px-2 py-0.5 text-xs font-semibold text-white">수집 중…</span>
        ) : (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATE_BADGE[site.state] ?? STATE_BADGE.never_run}`}>
            {SITE_STATE_LABELS[site.state] ?? site.state}
          </span>
        )}
      </div>

      <div className="col-span-2 row-start-2 min-w-0 text-sm text-[#3D4249] sm:col-span-1 sm:row-start-auto">
        <dl className="flex flex-wrap gap-x-5 gap-y-1">
          <div className="flex gap-1.5">
            <dt className="text-[#8A9099]">마지막 수집</dt>
            <dd className="tabular-nums">
              {site.lastRunAt ? (
                <>
                  <time dateTime={site.lastRunAt}>{formatDateTime(site.lastRunAt)}</time> ({formatAgo(site.lastRunAt, now)})
                </>
              ) : (
                '없음'
              )}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-[#8A9099]">할인</dt>
            <dd className="tabular-nums">{site.dealCount.toLocaleString('ko-KR')}건</dd>
          </div>
          {failedSinceSuccess && (
            <div className="flex gap-1.5">
              <dt className="text-[#8A9099]">마지막 성공</dt>
              <dd className="tabular-nums">{formatDateTime(site.lastSuccessAt)}</dd>
            </div>
          )}
        </dl>
        {site.message && <p className="mt-1 break-words text-[#5B616A]">{site.message}</p>}
        {coolingDown && (
          <p className="mt-1 text-[#5B616A]">
            {formatDateTime(site.cooldownUntil)}까지 전체 수집에서 건너뜁니다.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onCrawl(site)}
        disabled={disabled || running || busy}
        className="col-start-2 row-start-1 h-9 shrink-0 rounded-full border border-[#15171A] px-4 text-sm font-bold text-[#15171A] hover:bg-[#15171A] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] disabled:cursor-not-allowed disabled:border-[#DFE2E7] disabled:text-[#A3A8B0] disabled:hover:bg-transparent disabled:hover:text-[#A3A8B0] sm:col-start-3 sm:row-start-auto"
      >
        {running ? '수집 중' : '지금 수집'}
      </button>
    </li>
  );
}
