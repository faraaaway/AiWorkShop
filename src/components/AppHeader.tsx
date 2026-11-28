"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isReadOnlyDeploy } from "@/lib/deploy-mode";
import { formatAgo, formatDateTime } from "@/lib/time";

/** public/black-friday-logo.png — 검은색, 투명 배경, 카트(왼쪽)+글자(오른쪽). width/height는 원본 크기(비율 유지용). */
const LOGO = {
  src: "/black-friday-logo.png",
  width: 628,
  height: 112,
} as const;

const STATUS_HREF = "/status";

const TABS = [
  { href: "/", label: "할인 목록" },
  { href: "/compare", label: "가격 비교" },
  { href: STATUS_HREF, label: "수집 상태" },
];

/** 머리말 오른쪽에 넣는 "마지막 업데이트" 한 줄 (FR-020). 시각을 모르면 지어내지 않는다. */
export function LastUpdated({ at, now }: { at: string | null; now: Date }) {
  if (at === null) return <span>마지막 업데이트 알 수 없음</span>;
  return (
    <span>
      마지막 업데이트 <time dateTime={at}>{formatDateTime(at)}</time> ({formatAgo(at, now)})
    </span>
  );
}

/** 화면 공통 머리말: 왼쪽에 로고와 그 아래 이름, 오른쪽 끝에 목록↔상태 이동 탭과 화면별 정보(마지막 업데이트 등). */
export function AppHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  // 공개 배포판은 수집하지 않으므로 수집 상태 탭을 보이지 않는다 (lib/deploy-mode.ts).
  const readOnly = isReadOnlyDeploy();
  const tabs = readOnly ? TABS.filter((tab) => tab.href !== STATUS_HREF) : TABS;
  return (
    <header className="bg-white">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4">
        <div className="flex flex-col items-start gap-1">
          {/* 장식용 로고: 바로 아래 제목이 같은 내용을 말하므로 대체 텍스트는 비워 둔다. */}
          <Image
            src={LOGO.src}
            alt=""
            width={LOGO.width}
            height={LOGO.height}
            priority
            className="h-12 w-auto"
          />
          {/* 휴대폰 폭에서는 한 줄에 들어가도록 작게 쓴다 (320px 폭에서도 줄이 바뀌지 않는 크기). */}
          <h1 className="my-1 mt-4 whitespace-nowrap text-[22px] font-extrabold tracking-tight text-[#15171A] sm:text-4xl">
            블랙프라이데이 할인 모아보기
          </h1>
        </div>
        {/* 오른쪽 끝: 위에 화면 이동 탭, 그 아래에 화면별 정보(마지막 업데이트 등). */}
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <nav aria-label="화면 이동" className="flex gap-1">
            {tabs.map((tab) => {
              const current = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] ${current ? "bg-[#EEF0F3] font-bold text-[#15171A]" : "font-medium text-[#8A9099] hover:text-[#15171A]"}`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          {children && <div className="text-xs text-[#8A9099]">{children}</div>}
        </div>
      </div>
      {readOnly && (
        // 휴대폰 폭에서는 한 줄에 들어가는 짧은 문구를 작게 쓰고, 넓은 화면에서는 전체 문장을 보여 준다.
        <p className="mx-auto max-w-screen-2xl truncate px-4 pb-3 text-[11px] leading-5 text-[#8A9099] sm:overflow-visible sm:whitespace-normal sm:text-xs">
          <span className="sm:hidden">데모용 공개판 · 실제 가격·마감은 각 상품 페이지에서 확인</span>
          <span className="hidden sm:inline">
            데모용 공개판입니다. 가격과 마감은 위 업데이트 시각에 수집한 값이니, 실제 값은 각 상품 페이지에서 확인하세요.
          </span>
        </p>
      )}
    </header>
  );
}
