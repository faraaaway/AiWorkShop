import type { NextConfig } from "next";

/**
 * 공개 배포판(Vercel)은 읽기 전용이다: 수집·설정 변경을 막고 `public/snapshot/deals.json`만 보여 준다
 * (src/lib/deploy-mode.ts). Vercel 빌드에서는 자동으로 켜지고, 내 PC에서 흉내 내려면 `BF_READONLY=1`로
 * 실행한다. 여기서 넣은 값은 빌드할 때 서버·브라우저 코드 양쪽에 그대로 박힌다.
 */
const readOnlyDeploy = process.env.BF_READONLY === "1" || process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BF_READONLY: readOnlyDeploy ? "1" : "",
  },
};

export default nextConfig;
