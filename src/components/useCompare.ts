'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { parseCompareIds, toggleCompareId } from '@/lib/compare';

const STORAGE_KEY = 'bf-deal-tracker:compare:v1';
const EMPTY: readonly string[] = [];

// 비교함은 목록 화면과 비교 화면이 함께 쓴다. 한 탭 안에서는 이 모듈의 값이 기준이고,
// 브라우저 저장소는 새로 고침·다른 탭과 맞추는 데만 쓴다 (저장이 막혀 있어도 담기는 동작한다).
let current: readonly string[] | null = null;
/** 마지막 저장이 성공했는가. 실패했다면 저장소의 값은 이 탭보다 오래된 것이다. */
let storageWritable = true;
const listeners = new Set<() => void>();

function readStored(): readonly string[] {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return text ? parseCompareIds(JSON.parse(text)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): readonly string[] {
  if (current === null) current = readStored();
  return current;
}

function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  // key가 null이면 저장소 전체가 비워진 것이다.
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  current = readStored();
  notify();
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 듣는 화면이 없던 동안(예: 수집 상태 화면) 다른 탭이 바꾼 것을 놓쳤을 수 있으니 저장소를 다시 읽는다.
 * 저장이 막혀 있을 때는 이 탭의 값이 유일한 기준이라 그대로 둔다. 내용이 같으면 배열을 바꾸지 않는다
 * (바꾸면 화면을 쓸데없이 한 번 더 그린다).
 */
function refreshFromStorage(): void {
  if (current === null || !storageWritable) return;
  const stored = readStored();
  if (!sameIds(current, stored)) current = stored;
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    refreshFromStorage();
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

function setIds(next: readonly string[]): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    storageWritable = true;
  } catch {
    // 저장 공간이 막혀 있어도 이 탭에서는 비교함이 계속 동작해야 한다.
    storageWritable = false;
  }
  notify();
}

export interface CompareStore {
  /** 담은 상품 id (담은 순서) */
  ids: readonly string[];
  /** 담겨 있으면 빼고 없으면 담는다. 가득 찼으면 담지 않는다. */
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

/** 비교함 (T051). 브라우저에 기억해 화면을 옮기거나 새로 고쳐도 남는다. */
export function useCompare(): CompareStore {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback((id: string) => setIds(toggleCompareId(getSnapshot(), id)), []);
  const remove = useCallback((id: string) => setIds(getSnapshot().filter((existing) => existing !== id)), []);
  const clear = useCallback(() => setIds(EMPTY), []);
  return { ids, toggle, remove, clear };
}
