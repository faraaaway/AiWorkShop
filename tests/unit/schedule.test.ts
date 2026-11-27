import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVAL_MINUTES,
  computeAlignedDelayMs,
  parseIntervalMinutes,
  startAutoCrawl,
  type AutoCrawlOptions,
} from '@/crawler/schedule';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

interface PendingTimer {
  run: () => void;
  ms: number;
  cancelled: boolean;
}

/** Manual timers and a controllable clock, so no test waits for real time. */
function makeHarness(overrides: Partial<AutoCrawlOptions> = {}, startAt = '2026-11-28T00:50:00+09:00') {
  const timers: PendingTimer[] = [];
  const logs: string[] = [];
  let nowMs = Date.parse(startAt);
  let runs = 0;

  const options: AutoCrawlOptions = {
    intervalMinutes: 60,
    runAllFn: async () => {
      runs += 1;
      return [];
    },
    log: (msg) => {
      logs.push(msg);
    },
    now: () => new Date(nowMs),
    setTimer: (run, ms) => {
      const timer: PendingTimer = { run, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as PendingTimer).cancelled = true;
    },
    ...overrides,
  };

  /** Lets queued promise callbacks (the async tick) finish. */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };
  /** Moves the clock to the moment the latest timer is due, fires it and waits for the run. */
  const fireLatest = async (): Promise<void> => {
    const timer = timers[timers.length - 1];
    nowMs += timer.ms;
    timer.run();
    await settle();
  };

  return {
    options,
    timers,
    logs,
    settle,
    fireLatest,
    runs: () => runs,
    advance: (ms: number) => {
      nowMs += ms;
    },
    nowIso: () => new Date(nowMs).toISOString(),
  };
}

describe('parseIntervalMinutes', () => {
  it('defaults to one hour when the variable is not set', () => {
    expect(DEFAULT_INTERVAL_MINUTES).toBe(60);
    expect(parseIntervalMinutes(undefined)).toBe(60);
    expect(parseIntervalMinutes('')).toBe(60);
    expect(parseIntervalMinutes('   ')).toBe(60);
  });

  it('reads whole minutes', () => {
    expect(parseIntervalMinutes('60')).toBe(60);
    expect(parseIntervalMinutes(' 360 ')).toBe(360);
  });

  it.each(['0', 'off', 'OFF', 'false', 'no'])('turns automatic crawling off for %s', (value) => {
    expect(parseIntervalMinutes(value)).toBeNull();
  });

  it('never goes below ten minutes, so the sites are not hammered', () => {
    expect(parseIntervalMinutes('1')).toBe(10);
    expect(parseIntervalMinutes('9')).toBe(10);
    expect(parseIntervalMinutes('10')).toBe(10);
  });

  it.each(['abc', '-5', '1.5', 'NaN', '60분'])('falls back to the default for the invalid value %s', (value) => {
    expect(parseIntervalMinutes(value)).toBe(60);
  });
});

describe('computeAlignedDelayMs', () => {
  const at = (iso: string): number => Date.parse(iso);

  it('waits until the next full hour for an hourly schedule', () => {
    expect(computeAlignedDelayMs(at('2026-11-28T00:50:00+09:00'), HOUR_MS)).toBe(10 * MINUTE_MS);
    expect(computeAlignedDelayMs(at('2026-11-28T13:07:30+09:00'), HOUR_MS)).toBe(52 * MINUTE_MS + 30 * SECOND_MS);
    expect(computeAlignedDelayMs(at('2026-11-28T23:59:59.500+09:00'), HOUR_MS)).toBe(500);
  });

  it('waits a whole interval when the clock is exactly on a boundary', () => {
    expect(computeAlignedDelayMs(at('2026-11-28T01:00:00+09:00'), HOUR_MS)).toBe(HOUR_MS);
  });

  it('aligns shorter intervals to the clock too (every 30 minutes: :00 and :30)', () => {
    expect(computeAlignedDelayMs(at('2026-11-28T00:50:00+09:00'), 30 * MINUTE_MS)).toBe(10 * MINUTE_MS);
    expect(computeAlignedDelayMs(at('2026-11-28T00:20:00+09:00'), 30 * MINUTE_MS)).toBe(10 * MINUTE_MS);
  });

  it('aligns multi-hour intervals to midnight in Korean time (every 6 hours: 0, 6, 12, 18 KST)', () => {
    expect(computeAlignedDelayMs(at('2026-11-28T01:00:00+09:00'), 6 * HOUR_MS)).toBe(5 * HOUR_MS);
    expect(computeAlignedDelayMs(at('2026-11-28T19:30:00+09:00'), 6 * HOUR_MS)).toBe(4 * HOUR_MS + 30 * MINUTE_MS);
  });
});

describe('startAutoCrawl', () => {
  it('runs on the hour, every hour', async () => {
    const h = makeHarness();

    const handle = startAutoCrawl(h.options);

    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(10 * MINUTE_MS);
    expect(handle.nextRunAt?.toISOString()).toBe(new Date('2026-11-28T01:00:00+09:00').toISOString());
    expect(h.runs()).toBe(0);

    await h.fireLatest();

    expect(h.runs()).toBe(1);
    expect(h.timers).toHaveLength(2);
    expect(h.timers[1].ms).toBe(HOUR_MS);
    expect(handle.nextRunAt?.toISOString()).toBe(new Date('2026-11-28T02:00:00+09:00').toISOString());

    await h.fireLatest();

    expect(h.runs()).toBe(2);
    expect(handle.nextRunAt?.toISOString()).toBe(new Date('2026-11-28T03:00:00+09:00').toISOString());
    handle.stop();
  });

  it('stays on the hour when a run takes a while', async () => {
    const h = makeHarness();
    h.options.runAllFn = async () => {
      h.advance(20 * MINUTE_MS); // the crawl itself takes 20 minutes
      return [];
    };

    const handle = startAutoCrawl(h.options);
    await h.fireLatest(); // starts 01:00, ends 01:20

    expect(h.timers[1].ms).toBe(40 * MINUTE_MS);
    expect(handle.nextRunAt?.toISOString()).toBe(new Date('2026-11-28T02:00:00+09:00').toISOString());
    handle.stop();
  });

  it('skips the hour it missed when a run takes longer than the interval', async () => {
    const h = makeHarness();
    h.options.runAllFn = async () => {
      h.advance(70 * MINUTE_MS);
      return [];
    };

    const handle = startAutoCrawl(h.options);
    await h.fireLatest(); // starts 01:00, ends 02:10

    expect(h.timers[1].ms).toBe(50 * MINUTE_MS);
    expect(handle.nextRunAt?.toISOString()).toBe(new Date('2026-11-28T03:00:00+09:00').toISOString());
    handle.stop();
  });

  it('keeps the schedule alive when a run throws', async () => {
    let calls = 0;
    const h = makeHarness({
      runAllFn: async () => {
        calls += 1;
        throw new Error('disk full');
      },
    });

    const handle = startAutoCrawl(h.options);
    await h.fireLatest();

    expect(calls).toBe(1);
    expect(h.timers).toHaveLength(2);
    expect(h.logs.some((line) => line.includes('disk full'))).toBe(true);
    handle.stop();
  });

  it('does not start a second run while one is still going', async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const h = makeHarness({
      runAllFn: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve([]);
        });
      },
    });

    const handle = startAutoCrawl(h.options);
    h.timers[0].run();
    await h.settle();

    expect(calls).toBe(1);
    expect(handle.nextRunAt).toBeNull(); // a run is in progress
    expect(h.timers).toHaveLength(1); // the next run is only scheduled after this one ends

    release();
    await h.settle();

    expect(h.timers).toHaveLength(2);
    handle.stop();
  });

  it('stop() cancels the pending timer and no further run is scheduled', async () => {
    const h = makeHarness();

    const handle = startAutoCrawl(h.options);
    handle.stop();

    expect(h.timers[0].cancelled).toBe(true);
    expect(handle.nextRunAt).toBeNull();

    h.timers[0].run(); // a timer that fires anyway must do nothing
    await h.settle();

    expect(h.runs()).toBe(0);
    expect(h.timers).toHaveLength(1);
  });

  it('rejects an interval below one minute', () => {
    const h = makeHarness({ intervalMinutes: 0 });

    expect(() => startAutoCrawl(h.options)).toThrow(/[가-힣]/);
  });
});
