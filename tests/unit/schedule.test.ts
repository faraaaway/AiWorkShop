import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVAL_MINUTES,
  computeFirstDelayMs,
  parseIntervalMinutes,
  startAutoCrawl,
  type AutoCrawlOptions,
} from '@/crawler/schedule';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const STARTUP_DELAY_MS = 15_000;

interface PendingTimer {
  run: () => void;
  ms: number;
  cancelled: boolean;
}

/** Manual timers and a controllable clock, so no test waits for real time. */
function makeHarness(overrides: Partial<AutoCrawlOptions> = {}) {
  const timers: PendingTimer[] = [];
  const logs: string[] = [];
  let nowMs = Date.parse('2026-11-28T01:00:00+09:00');
  let runs = 0;

  const options: AutoCrawlOptions = {
    intervalMinutes: 60,
    runAllFn: async () => {
      runs += 1;
      return [];
    },
    getLastRunAts: async () => [],
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

describe('computeFirstDelayMs', () => {
  const now = Date.parse('2026-11-28T01:00:00+09:00');

  it('starts shortly after boot when nothing was ever collected', () => {
    expect(computeFirstDelayMs([], HOUR_MS, now)).toBe(STARTUP_DELAY_MS);
    expect(computeFirstDelayMs([null, null], HOUR_MS, now)).toBe(STARTUP_DELAY_MS);
  });

  it('waits for the rest of the interval after the most recent run', () => {
    const lastRuns = ['2026-11-28T00:10:00+09:00', '2026-11-28T00:40:00+09:00', null];

    expect(computeFirstDelayMs(lastRuns, HOUR_MS, now)).toBe(40 * MINUTE_MS);
  });

  it('starts shortly after boot when the last run is older than the interval', () => {
    expect(computeFirstDelayMs(['2026-11-27T20:00:00+09:00'], HOUR_MS, now)).toBe(STARTUP_DELAY_MS);
  });

  it('ignores unreadable timestamps and runs dated in the future', () => {
    expect(computeFirstDelayMs(['not a date'], HOUR_MS, now)).toBe(STARTUP_DELAY_MS);
    expect(computeFirstDelayMs(['2026-11-29T00:00:00+09:00'], HOUR_MS, now)).toBe(STARTUP_DELAY_MS);
  });
});

describe('startAutoCrawl', () => {
  it('schedules the first run, then one run per interval measured from the end of the previous run', async () => {
    const h = makeHarness();

    const handle = startAutoCrawl(h.options);
    await h.settle();

    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(STARTUP_DELAY_MS);
    expect(handle.nextRunAt?.toISOString()).toBe(new Date('2026-11-28T01:00:15+09:00').toISOString());
    expect(h.runs()).toBe(0);

    await h.fireLatest();

    expect(h.runs()).toBe(1);
    expect(h.timers).toHaveLength(2);
    expect(h.timers[1].ms).toBe(HOUR_MS);

    await h.fireLatest();

    expect(h.runs()).toBe(2);
    expect(h.timers[2].ms).toBe(HOUR_MS);
    handle.stop();
  });

  it('waits out the rest of the interval when a crawl ran recently', async () => {
    const h = makeHarness({ getLastRunAts: async () => ['2026-11-28T00:45:00+09:00'] });

    const handle = startAutoCrawl(h.options);
    await h.settle();

    expect(h.timers[0].ms).toBe(45 * MINUTE_MS);
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
    await h.settle();
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
    await h.settle();
    h.timers[0].run();
    await h.settle();

    expect(calls).toBe(1);
    expect(h.timers).toHaveLength(1); // the next run is only scheduled after this one ends

    release();
    await h.settle();

    expect(h.timers).toHaveLength(2);
    handle.stop();
  });

  it('stop() cancels the pending timer and no further run is scheduled', async () => {
    const h = makeHarness();

    const handle = startAutoCrawl(h.options);
    await h.settle();
    handle.stop();

    expect(h.timers[0].cancelled).toBe(true);
    expect(handle.nextRunAt).toBeNull();

    h.timers[0].run(); // a timer that fires anyway must do nothing
    await h.settle();

    expect(h.runs()).toBe(0);
    expect(h.timers).toHaveLength(1);
  });

  it('still schedules the first run when the last-run lookup fails', async () => {
    const h = makeHarness({
      getLastRunAts: async () => {
        throw new Error('status unreadable');
      },
    });

    const handle = startAutoCrawl(h.options);
    await h.settle();

    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(STARTUP_DELAY_MS);
    handle.stop();
  });

  it('rejects an interval below one minute', () => {
    const h = makeHarness({ intervalMinutes: 0 });

    expect(() => startAutoCrawl(h.options)).toThrow(/[가-힣]/);
  });
});
