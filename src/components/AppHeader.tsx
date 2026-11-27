"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** public/black-friday-logo.png — 검은색, 투명 배경, 카트(왼쪽)+글자(오른쪽). width/height는 원본 크기(비율 유지용). */
const LOGO = {
  src: "/black-friday-logo.png",
  width: 628,
  height: 112,
} as const;

const TABS = [
  { href: "/", label: "할인 목록" },
  { href: "/status", label: "수집 상태" },
];

/** 화면 공통 머리말: 왼쪽에 로고와 그 아래 이름, 오른쪽 끝에 목록↔상태 이동 탭과 화면별 정보(마지막 업데이트 등). */
export function AppHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
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
          <h1 className="text-4xl my-1 mt-4 font-extrabold tracking-tight text-[#15171A]">
            블랙프라이데이 할인 모아보기
          </h1>
        </div>
        {/* 오른쪽 끝: 위에 화면 이동 탭, 그 아래에 화면별 정보(마지막 업데이트 등). */}
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <nav aria-label="화면 이동" className="flex gap-1">
            {TABS.map((tab) => {
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
    </header>
  );
}
