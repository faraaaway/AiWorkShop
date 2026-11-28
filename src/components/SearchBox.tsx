'use client';

import { useId, useRef } from 'react';

interface SearchBoxProps {
  value: string;
  onChange: (next: string) => void;
  /** 바깥 크기·배치용 클래스 */
  className?: string;
}

const LABEL = '상품명·브랜드 검색';

/**
 * 목록 검색창. 치는 대로 바로 걸러지므로 확인 버튼은 없다.
 * - 휴대폰: 글자 16px(더 작으면 iOS가 입력할 때 화면을 확대한다), 높이 40px, 키보드의 "검색"을 누르면
 *   키보드를 내려 결과가 보이게 한다.
 * - 지우기 버튼은 브라우저마다 생김새가 달라 기본 것을 숨기고 직접 그린다.
 */
export function SearchBox({ value, onChange, className = '' }: SearchBoxProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      role="search"
      className={`relative ${className}`}
      onSubmit={(event) => {
        event.preventDefault();
        inputRef.current?.blur();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {LABEL}
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A9099]"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="m14 14 4 4" />
      </svg>
      <input
        ref={inputRef}
        id={id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={LABEL}
        className="h-10 w-full rounded-full border border-[#DFE2E7] bg-[#F7F8FA] pl-10 pr-10 text-base text-[#15171A] placeholder:text-[#A3A8B0] focus:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== '' && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          aria-label="검색어 지우기"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-lg leading-none text-[#8A9099] hover:text-[#15171A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#15171A]"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </form>
  );
}
