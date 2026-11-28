/**
 * 공개 배포판용 할인 스냅샷 내보내기:
 *   npm run snapshot
 * data/(git 제외)에 수집해 둔 모든 사이트의 할인을 `public/snapshot/deals.json` 하나로 쓴다.
 * 이 파일을 커밋·푸시하면 Vercel이 다시 배포하고, 배포판은 이 파일만 읽는다(lib/deploy-mode.ts).
 * 사이트에 접속하지 않는다 — 수집은 `npm run crawl`이나 개발 서버의 자동 수집이 한다.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toKstIso } from '@/lib/dates';
import { SITE_LABELS } from '@/lib/labels';
import { latestSuccessAt, partitionSettledStatuses } from '@/lib/server/status-view';
import type { DealsSnapshot } from '@/lib/snapshot';
import { readAllDeals, readStatus } from '@/lib/store';
import { SITE_IDS } from '@/lib/types';
import type { Deal, IsoDateTime, SiteId, SiteStatus } from '@/lib/types';

/** 저장소 루트 기준 스냅샷 파일 위치 (Next가 `/snapshot/deals.json`으로 내보낸다). */
export const SNAPSHOT_FILE = path.join('public', 'snapshot', 'deals.json');

const EXIT_OK = 0;
const EXIT_PROBLEM = 1;
const EXIT_USAGE = 2;
const ALLOW_PARTIAL_FLAG = '--allow-partial';
const USAGE = [
  '사용법: npm run snapshot [-- --allow-partial]',
  '  --allow-partial   읽지 못한 사이트가 있어도 그 사이트를 빼고 내보냄',
].join('\n');
const BYTES_PER_KB = 1024;
const NO_DEALS_MESSAGE =
  '수집된 할인이 없어 스냅샷을 만들지 않았습니다. 먼저 "npm run crawl -- --site all"로 수집해 주세요.';

export interface ExportOptions {
  /** 쓸 파일. 기본은 저장소의 public/snapshot/deals.json */
  outFile?: string;
  now?: Date;
  /** 읽지 못한 사이트가 있어도 그 사이트를 빼고 내보낸다. 기본은 false (오류로 멈춘다). */
  allowPartial?: boolean;
}

export interface SnapshotArgs {
  allowPartial: boolean;
}

export interface ExportResult {
  outFile: string;
  dealCount: number;
  /** 할인이 있는 사이트만, 사이트 고정 순서 */
  siteCounts: Partial<Record<SiteId, number>>;
  lastUpdatedAt: IsoDateTime | null;
  exportedAt: IsoDateTime;
  bytes: number;
  /** 읽지 못해 뺀 것에 대한 설명 (없으면 빈 배열) */
  problems: string[];
}

function byId(a: Deal, b: Deal): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 순수 함수: 할인과 사이트 상태로 스냅샷을 만든다. id 순으로 정렬해 내보낼 때마다 같은 순서가 나온다. */
export function buildSnapshot(deals: readonly Deal[], statuses: readonly SiteStatus[], now: Date): DealsSnapshot {
  return {
    exportedAt: toKstIso(now) ?? now.toISOString(),
    lastUpdatedAt: latestSuccessAt(statuses),
    deals: [...deals].sort(byId),
  };
}

/** 할인 하나를 한 줄에 쓴다: 파일은 작게 유지하면서 git에서는 바뀐 상품만 달라 보인다. */
export function formatSnapshotFile(snapshot: DealsSnapshot): string {
  const head = JSON.stringify({ exportedAt: snapshot.exportedAt, lastUpdatedAt: snapshot.lastUpdatedAt });
  const lines = snapshot.deals.map((deal) => JSON.stringify(deal));
  return `${head.slice(0, -1)},"deals":[\n${lines.join(',\n')}\n]}\n`;
}

function countBySite(deals: readonly Deal[]): Partial<Record<SiteId, number>> {
  const counts: Partial<Record<SiteId, number>> = {};
  for (const siteId of SITE_IDS) {
    const count = deals.filter((deal) => deal.siteId === siteId).length;
    if (count > 0) counts[siteId] = count;
  }
  return counts;
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 읽을 수 있는 사이트 상태만 돌려주고, 못 읽은 것은 설명을 남긴다 (마지막 업데이트 계산에서 빠진다). */
async function readStatusesOrProblems(): Promise<{ statuses: SiteStatus[]; problems: string[] }> {
  const results = await Promise.allSettled(SITE_IDS.map((siteId) => readStatus(siteId)));
  const { statuses, failures } = partitionSettledStatuses(SITE_IDS, results);
  return {
    statuses,
    problems: failures.map(
      ({ siteId, reason }) => `${siteId} 상태를 읽지 못해 마지막 업데이트 계산에서 뺐습니다: ${toErrorText(reason)}`,
    ),
  };
}

function buildPartialMessage(problems: readonly string[]): string {
  return [
    '읽지 못한 사이트가 있어 스냅샷을 만들지 않았습니다 (그대로 올리면 공개 목록에서 그 사이트가 통째로 빠집니다):',
    ...problems.map((problem) => `  - ${problem}`),
    `그 사이트를 빼고라도 내보내려면 "npm run snapshot -- ${ALLOW_PARTIAL_FLAG}"로 실행하세요.`,
  ].join('\n');
}

/**
 * 임시 파일에 쓴 뒤 바꿔치기해 중간 상태가 남지 않게 한다. 임시 파일은 같은 폴더에 둔다(다른 드라이브면
 * 바꿔치기가 안 된다). 실패하면 임시 파일을 지운다 — public/ 아래라 남으면 그대로 공개된다.
 */
async function writeFileAtomically(file: string, text: string): Promise<void> {
  const tempFile = `${file}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(tempFile, text, 'utf8');
    await rename(tempFile, file);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}

/**
 * data/의 할인을 스냅샷 파일로 쓴다. 다음 경우에는 쓰지 않고 오류를 던진다 (공개된 스냅샷을 망가뜨리지 않는다):
 * 할인이 하나도 없을 때, 그리고 읽지 못한 사이트가 있는데 `allowPartial`이 아닐 때.
 */
export async function exportSnapshot(options: ExportOptions = {}): Promise<ExportResult> {
  const outFile = path.resolve(options.outFile ?? SNAPSHOT_FILE);
  const [dealsRead, statusesRead] = await Promise.all([readAllDeals(), readStatusesOrProblems()]);
  if (dealsRead.problems.length > 0 && options.allowPartial !== true) {
    throw new Error(buildPartialMessage(dealsRead.problems));
  }
  if (dealsRead.deals.length === 0) throw new Error(NO_DEALS_MESSAGE);

  const snapshot = buildSnapshot(dealsRead.deals, statusesRead.statuses, options.now ?? new Date());
  const text = formatSnapshotFile(snapshot);
  await writeFileAtomically(outFile, text);

  return {
    outFile,
    dealCount: snapshot.deals.length,
    siteCounts: countBySite(snapshot.deals),
    lastUpdatedAt: snapshot.lastUpdatedAt,
    exportedAt: snapshot.exportedAt,
    bytes: Buffer.byteLength(text, 'utf8'),
    problems: [...dealsRead.problems, ...statusesRead.problems],
  };
}

function printLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

function printErrorLine(text: string): void {
  process.stderr.write(`${text}\n`);
}

function describeResult(result: ExportResult): string[] {
  const sites = SITE_IDS.flatMap((siteId) => {
    const count = result.siteCounts[siteId];
    return count === undefined ? [] : [`${SITE_LABELS[siteId]} ${count}`];
  });
  return [
    `스냅샷을 썼습니다: ${path.relative(process.cwd(), result.outFile)}`,
    `  할인 ${result.dealCount}개 (${sites.join(', ')})`,
    `  마지막 수집 성공: ${result.lastUpdatedAt ?? '알 수 없음'} · 크기 약 ${Math.round(result.bytes / BYTES_PER_KB)}KB`,
    '공개 배포판에 반영하려면 이 파일을 커밋하고 푸시하세요:',
    '  git add public/snapshot/deals.json',
    '  git commit -m "chore: update the public deal snapshot"',
    '  git push',
  ];
}

/** `[]` or `['--allow-partial']`; anything else is not understood (null). */
export function parseArgs(argv: readonly string[]): SnapshotArgs | null {
  if (argv.some((arg) => arg !== ALLOW_PARTIAL_FLAG)) return null;
  return { allowPartial: argv.includes(ALLOW_PARTIAL_FLAG) };
}

/** Runs the export and returns the exit code; never calls process.exit, so output is not cut off. */
export async function main(argv: readonly string[] = []): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    printErrorLine(USAGE);
    return EXIT_USAGE;
  }
  try {
    const result = await exportSnapshot({ allowPartial: args.allowPartial });
    result.problems.forEach((problem) => printErrorLine(`주의: ${problem}`));
    describeResult(result).forEach(printLine);
    return EXIT_OK;
  } catch (error) {
    printErrorLine(`스냅샷을 만들지 못했습니다: ${toErrorText(error)}`);
    return EXIT_PROBLEM;
  }
}

/** True for `tsx src/crawler/snapshot.ts`, false when a test or another module imports this file. */
function isRunDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const here = path.resolve(fileURLToPath(import.meta.url));
  const started = path.resolve(entry);
  // Windows paths differ only by letter case between shells (c:\ vs C:\).
  return process.platform === 'win32' ? here.toLowerCase() === started.toLowerCase() : here === started;
}

if (isRunDirectly()) {
  void main(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
