import { afterEach, describe, expect, it, vi } from 'vitest';
import { READ_ONLY_MESSAGE, isReadOnlyDeploy } from '@/lib/deploy-mode';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isReadOnlyDeploy', () => {
  it('NEXT_PUBLIC_BF_READONLY가 "1"이면 공개 배포판(읽기 전용)이다', () => {
    vi.stubEnv('NEXT_PUBLIC_BF_READONLY', '1');
    expect(isReadOnlyDeploy()).toBe(true);
  });

  it.each([
    ['빈 문자열', ''],
    ['0', '0'],
    ['true', 'true'],
  ])('값이 %s이면 평소 모드다 (내 PC에서 수집까지 하는 앱)', (_label, value) => {
    vi.stubEnv('NEXT_PUBLIC_BF_READONLY', value);
    expect(isReadOnlyDeploy()).toBe(false);
  });

  it('값이 없으면 평소 모드다', () => {
    vi.stubEnv('NEXT_PUBLIC_BF_READONLY', undefined);
    expect(isReadOnlyDeploy()).toBe(false);
  });

  it('막힌 기능을 설명하는 문구는 한글이다', () => {
    expect(READ_ONLY_MESSAGE).toMatch(/[가-힣]/);
  });
});
