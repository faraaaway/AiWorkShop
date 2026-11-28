/**
 * 공개 배포판(읽기 전용) 판별.
 *
 * 내 PC에서 도는 앱은 수집까지 하지만, 공개 배포판(Vercel)은 수집할 수 없다(Obscura 실행 파일도,
 * 내용이 유지되는 디스크도, 상주 프로세스도 없다). 그래서 배포판은 PC에서 내보낸 스냅샷
 * (`public/snapshot/deals.json`, `npm run snapshot`)만 보여 주고 수집·설정 변경은 막는다.
 * 값은 `next.config.ts`가 Vercel 빌드(또는 `BF_READONLY=1`)에서 '1'로 넣어 준다.
 */

/** 배포판에서 막힌 기능을 눌렀을 때 보여 주는 문구. */
export const READ_ONLY_MESSAGE = '공개 배포판에서는 수집과 설정 변경을 할 수 없습니다. 할인 목록만 볼 수 있습니다.';

export function isReadOnlyDeploy(): boolean {
  // Next가 빌드할 때 이 표현식을 값으로 바꿔 넣는다(브라우저 코드 포함). 꼭 이 모양 그대로 써야 한다.
  return process.env.NEXT_PUBLIC_BF_READONLY === '1';
}
