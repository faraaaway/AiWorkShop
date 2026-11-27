'use client';

import { useEffect, useState } from 'react';

/** 현재 시각을 일정 간격으로 갱신해 준다 (남은 시간 표시가 스스로 줄어들도록). */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
