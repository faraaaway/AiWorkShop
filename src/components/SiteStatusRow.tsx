import type { RunPhase, SiteState, SiteStatusView } from '@/lib/types';
import { SITE_STATE_LABELS } from '@/lib/labels';
import { cooldownText, isCrawlActive, siteName } from '@/lib/status-ui';
import { formatAgo, formatDateTime } from '@/lib/time';

// 색만으로 구분하지 않도록 배지에는 항상 상태 이름을 함께 쓴다.
const STATE_BADGE: Record<SiteState, string> = {
  ok: 'bg-[#E3F5EA] text-[#0B6B34]',
  failed: 'bg-[#FDECEE] text-[#9B0C1F]',
  suspect_layout: 'bg-[#FFF4D6] text-[#5C4400]',
  blocked: 'bg-[#15171A] text-white',
  login_required: 'bg-[#E4EEFF] text-[#1F4FA8]',
  disabled: 'bg-[#EEF0F3] text-[#5B616A]',
  // 준비 중(수집기 없음)은 점선, 미실행(아직 안 돌림)은 실선으로 구분한다.
  not_implemented: 'border border-dashed border-[#C9CDD3] bg-white text-[#5B616A]',
  never_run: 'border border-[#DFE2E7] bg-white text-[#5B616A]',
};

/** 수집이 진행 중일 때만 이름이 있다 ('idle'은 없음). */
const RUN_LABELS: Partial<Record<RunPhase, string>> = {
  queued: '대기 중',
  running: '수집 중',
};

const ROW_BUTTON =
  'shrink-0 rounded-full border border-[#15171A] font-bold text-[#15171A] hover:bg-[#15171A] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] disabled:cursor-not-allowed disabled:border-[#DFE2E7] disabled:text-[#A3A8B0] disabled:hover:bg-transparent disabled:hover:text-[#A3A8B0]';

interface SiteStatusRowProps {
  site: SiteStatusView;
  now: Date;
  /** 다른 수집이 진행 중이라 새로 시작할 수 없다 */
  busy: boolean;
  /** 켜기/끄기 요청을 보내는 중 */
  toggling: boolean;
  onCrawl: (site: SiteStatusView) => void;
  /** 차단 쿨다운을 무시하고 다시 수집 (확인은 부르는 쪽에서 받는다) */
  onForceRetry: (site: SiteStatusView) => void;
  onToggle: (site: SiteStatusView, enabled: boolean) => void;
}

/** 서버가 알려 주는 수집 여부(run)가 있으면 그것을, 없으면 마지막 결과(state)를 배지로 보여 준다. */
function StatusBadge({ site }: { site: SiteStatusView }) {
  const runLabel = RUN_LABELS[site.run];
  if (runLabel) {
    return <span className="rounded-md bg-[#15171A] px-2 py-0.5 text-xs font-semibold text-white">{runLabel}…</span>;
  }
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATE_BADGE[site.state] ?? STATE_BADGE.never_run}`}>
      {SITE_STATE_LABELS[site.state] ?? site.state}
    </span>
  );
}

interface EnabledSwitchProps {
  name: string;
  enabled: boolean;
  pending: boolean;
  onChange: (enabled: boolean) => void;
}

/** 사이트 켜기/끄기. 꺼진 사이트는 전체 수집에서 빠진다. */
function EnabledSwitch({ name, enabled, pending, onChange }: EnabledSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${name} 수집 사용`}
      title={enabled ? '켜짐 — 누르면 전체 수집에서 뺍니다' : '꺼짐 — 누르면 다시 수집합니다'}
      disabled={pending}
      onClick={() => onChange(!enabled)}
      className="inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] disabled:cursor-wait disabled:opacity-60"
    >
      <span className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? 'bg-[#15171A]' : 'bg-[#C9CDD3]'}`}>
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  );
}

interface BlockedLineProps {
  site: SiteStatusView;
  now: Date;
  disabled: boolean;
  onForceRetry: (site: SiteStatusView) => void;
}

/** 차단된 사이트: 언제 풀리는지와, 기다리지 않고 다시 시도하는 버튼. */
function BlockedLine({ site, now, disabled, onForceRetry }: BlockedLineProps) {
  const cooldown = cooldownText(site, now);
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[#5B616A]">
      {cooldown && (
        <span>
          <strong className="font-semibold tabular-nums text-[#15171A]">{cooldown}</strong> · 그때까지 전체 수집에서 건너뜁니다.
        </span>
      )}
      <button type="button" onClick={() => onForceRetry(site)} disabled={disabled} className={`h-8 px-3 text-xs ${ROW_BUTTON}`}>
        강제 재시도
      </button>
    </p>
  );
}

function LastRunFacts({ site, now }: { site: SiteStatusView; now: Date }) {
  const failedSinceSuccess = site.lastSuccessAt !== null && site.lastSuccessAt !== site.lastRunAt && site.state !== 'ok';
  return (
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
  );
}

/** 수집 상태 한 줄 (T039): 이름 · 상태 배지 · 마지막 수집 · 건수 · 메시지 · 켜기/끄기 · [지금 수집]. */
export function SiteStatusRow({ site, now, busy, toggling, onCrawl, onForceRetry, onToggle }: SiteStatusRowProps) {
  const name = siteName(site);
  const active = isCrawlActive(site);
  const blocked = site.state === 'blocked';
  const coolingDown = site.cooldownUntil !== null && Date.parse(site.cooldownUntil) > now.getTime();
  // 꺼진 사이트와 수집기가 아직 없는 사이트만 막는다 (contracts/http-api.md). 수집 중에는 잠시 막는다.
  const cannotCrawl = !site.enabled || site.state === 'not_implemented' || active || busy;

  return (
    <li className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-2 px-4 py-4 sm:grid-cols-[10rem_1fr_auto] sm:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-col sm:items-start sm:gap-1.5">
        <h2 className="truncate text-base font-bold text-[#15171A]">{name}</h2>
        <StatusBadge site={site} />
      </div>

      <div className="col-span-2 row-start-2 min-w-0 text-sm text-[#3D4249] sm:col-span-1 sm:row-start-auto">
        <LastRunFacts site={site} now={now} />
        {site.message && <p className="mt-1 break-words text-[#5B616A]">{site.message}</p>}
        {blocked && <BlockedLine site={site} now={now} disabled={!site.enabled || active || busy} onForceRetry={onForceRetry} />}
        {!blocked && coolingDown && (
          <p className="mt-1 text-[#5B616A]">{formatDateTime(site.cooldownUntil)}까지 전체 수집에서 건너뜁니다.</p>
        )}
      </div>

      <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 sm:col-start-3 sm:row-start-auto">
        <EnabledSwitch name={name} enabled={site.enabled} pending={toggling} onChange={(enabled) => onToggle(site, enabled)} />
        <button type="button" onClick={() => onCrawl(site)} disabled={cannotCrawl} className={`h-9 px-4 text-sm ${ROW_BUTTON}`}>
          {RUN_LABELS[site.run] ?? '지금 수집'}
        </button>
      </div>
    </li>
  );
}
