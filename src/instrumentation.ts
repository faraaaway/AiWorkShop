import { isReadOnlyDeploy } from '@/lib/deploy-mode';

/**
 * Next.js calls register() once when the server process starts (dev and production).
 * It switches on automatic crawling: every enabled site once per BF_AUTO_CRAWL_MINUTES
 * (default 60; "0" or "off" disables it). See src/crawler/schedule.ts.
 */
export async function register(): Promise<void> {
  // Next compiles this file for the edge runtime too. The crawler needs Node APIs (child
  // processes, the file system), so its import must sit inside this exact condition: the bundler
  // replaces NEXT_RUNTIME at build time and drops the block from the edge build.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    // 공개 배포판은 수집하지 않는다 (PC에서 내보낸 스냅샷만 보여 준다, lib/deploy-mode.ts).
    if (isReadOnlyDeploy()) return;
    const { ensureAutoCrawl } = await import('@/crawler/schedule');
    ensureAutoCrawl();
  }
}
