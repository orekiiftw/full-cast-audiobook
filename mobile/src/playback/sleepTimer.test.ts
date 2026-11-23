import { SLEEP_OFF, beginSleep, formatSleepRemaining, resumeSleep, tickSleep } from "./sleepTimer";

const START = 1_700_000_000_000;

describe("sleep timer", () => {
  it("starts a preset countdown and clears it for Off", () => {
    expect(beginSleep(900, START)).toEqual({ preset: 900, deadline: START + 900_000, remainingSeconds: 900 });
    expect(beginSleep(null, START)).toEqual(SLEEP_OFF);
  });

  it("counts down while playing", () => {
    const state = beginSleep(900, START);

    const afterOneSecond = tickSleep(state, START + 1000, true);
    expect(afterOneSecond.pauseNow).toBe(false);
    expect(afterOneSecond.state.remainingSeconds).toBe(899);

    const afterMinute = tickSleep(state, START + 60_000, true);
    expect(afterMinute.state.remainingSeconds).toBe(840);
  });

  it("freezes while paused and rebases the deadline on resume", () => {
    const state = beginSleep(900, START);
    const paused = tickSleep(state, START + 30_000, false);

    expect(paused.state.remainingSeconds).toBe(900);

    const resumed = resumeSleep(paused.state, START + 120_000);
    expect(resumed.deadline).toBe(START + 120_000 + 900_000);

    const oneSecondLater = tickSleep(resumed, START + 121_000, true);
    expect(oneSecondLater.state.remainingSeconds).toBe(899);
  });

  it("stops playback and resets when the deadline passes", () => {
    const state = beginSleep(15, START);
    const expired = tickSleep(state, START + 15_000, true);

    expect(expired.pauseNow).toBe(true);
    expect(expired.state).toEqual(SLEEP_OFF);
  });

  it("does nothing when no timer is set", () => {
    expect(tickSleep(SLEEP_OFF, START, true)).toEqual({ state: SLEEP_OFF, pauseNow: false });
  });

  it("formats the remaining time as m:ss", () => {
    expect(formatSleepRemaining(null)).toBeNull();
    expect(formatSleepRemaining(65)).toBe("1:05");
    expect(formatSleepRemaining(900)).toBe("15:00");
  });
});
