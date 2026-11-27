'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '할인 목록' },
  { href: '/status', label: '수집 상태' },
];

/** 화면 공통 머리말: 이름, 목록↔상태 이동 탭, 오른쪽에 화면별 정보(마지막 업데이트 등). */
export function AppHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="bg-white">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-end justify-between gap-x-4 gap-y-1 px-4 pt-4">
        <h1 className="text-xl font-extrabold tracking-tight text-[#15171A]">블프 할인 모아보기</h1>
        {children && <div className="text-xs text-[#8A9099]">{children}</div>}
      </div>
      <nav aria-label="화면 이동" className="mx-auto mt-2 flex max-w-screen-2xl gap-1 px-2.5 pb-2">
        {TABS.map((tab) => {
          const current = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? 'page' : undefined}
              className={`rounded-full px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] ${current ? 'bg-[#EEF0F3] font-bold text-[#15171A]' : 'font-medium text-[#8A9099] hover:text-[#15171A]'}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
