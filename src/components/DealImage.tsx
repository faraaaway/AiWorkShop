'use client';

import { useState, type ReactNode } from 'react';

interface DealImageProps {
  /** 대표 이미지 주소. 모르면 null */
  src: string | null;
  /** img에 덧붙일 클래스 (예: 품절일 때 흐리게) */
  className?: string;
  /** 이미지가 없거나 못 불러왔을 때 대신 보일 내용. 작은 썸네일에서는 null로 비워 둔다. */
  fallback?: ReactNode;
}

/**
 * 상품 대표 이미지. 감싸는 요소의 크기를 가득 채운다.
 * 쇼핑몰 CDN 이미지를 그대로 쓴다 (next/image는 도메인 등록이 필요해 쓰지 않음).
 */
export function DealImage({ src, className = '', fallback = '이미지 없음' }: DealImageProps) {
  const [failed, setFailed] = useState(false);

  if (src === null || failed) {
    return <div className="flex h-full w-full items-center justify-center text-xs text-[#8A9099]">{fallback}</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
