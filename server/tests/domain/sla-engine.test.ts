import { describe, expect, it } from 'vitest';
import {
  computeDueDates,
  evaluateSlaWindow,
  formatRemaining,
  resumeFromHold,
  MINUTE_MS,
} from '../../src/domain/sla/sla-engine.js';

const at = (base: Date, minutes: number): Date => new Date(base.getTime() + minutes * MINUTE_MS);
const T0 = new Date('2025-03-10T09:00:00.000Z');

describe('computeDueDates', () => {
  it('hedef tarihleri politikadaki dakikalara gore uretir', () => {
    const dues = computeDueDates(T0, { responseMinutes: 60, resolutionMinutes: 480 });
    expect(dues.responseDueAt.toISOString()).toBe('2025-03-10T10:00:00.000Z');
    expect(dues.resolutionDueAt.toISOString()).toBe('2025-03-10T17:00:00.000Z');
  });
});

describe('evaluateSlaWindow', () => {
  const dueAt = at(T0, 100); // 100 dakikalik pencere

  it('pencerenin basinda "on_track" doner', () => {
    const result = evaluateSlaWindow({ createdAt: T0, dueAt, now: at(T0, 10) });
    expect(result.state).toBe('on_track');
    expect(result.consumedRatio).toBeCloseTo(0.1, 5);
    expect(result.remainingMs).toBe(90 * MINUTE_MS);
  });

  it('esige gelindiginde "at_risk" doner', () => {
    const result = evaluateSlaWindow({ createdAt: T0, dueAt, now: at(T0, 80), riskThreshold: 0.8 });
    expect(result.state).toBe('at_risk');
  });

  it('esigin bir dakika oncesinde hala "on_track"', () => {
    const result = evaluateSlaWindow({ createdAt: T0, dueAt, now: at(T0, 79), riskThreshold: 0.8 });
    expect(result.state).toBe('on_track');
  });

  it('hedef gecildiginde "breached" doner ve kalan sure negatiftir', () => {
    const result = evaluateSlaWindow({ createdAt: T0, dueAt, now: at(T0, 130) });
    expect(result.state).toBe('breached');
    expect(result.remainingMs).toBe(-30 * MINUTE_MS);
  });

  it('zamaninda tamamlanan pencere "met" olur', () => {
    const result = evaluateSlaWindow({ createdAt: T0, dueAt, completedAt: at(T0, 90), now: at(T0, 500) });
    expect(result.state).toBe('met');
  });

  it('gec tamamlanan pencere "breached" olarak muhurlenir', () => {
    const result = evaluateSlaWindow({ createdAt: T0, dueAt, completedAt: at(T0, 120), now: at(T0, 500) });
    expect(result.state).toBe('breached');
  });

  it('bilet beklemedeyken SLA saati durur', () => {
    const result = evaluateSlaWindow({
      createdAt: T0,
      dueAt,
      pausedAt: at(T0, 50),
      now: at(T0, 5000), // gercek zaman cok ilerlemis olsa da
    });
    expect(result.state).toBe('on_track');
    expect(result.remainingMs).toBe(50 * MINUTE_MS);
  });

  it('duraklatma suresi tuketilen oranin disinda tutulur', () => {
    // 30 dk beklendi, hedef 30 dk ileri kaydirildi: gercek tuketim 40/100.
    const shiftedDue = at(T0, 130);
    const result = evaluateSlaWindow({
      createdAt: T0,
      dueAt: shiftedDue,
      pausedTotalSeconds: 30 * 60,
      now: at(T0, 70),
    });
    expect(result.windowMs).toBe(100 * MINUTE_MS);
    expect(result.consumedRatio).toBeCloseTo(0.4, 5);
    expect(result.state).toBe('on_track');
  });

  it('hedef tarihi olmayan pencere daima "on_track"', () => {
    const result = evaluateSlaWindow({ createdAt: T0, dueAt: null, now: at(T0, 10_000) });
    expect(result.state).toBe('on_track');
    expect(result.remainingMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('resumeFromHold', () => {
  it('beklemede gecen sureyi toplar ve hedefleri ayni kadar oteler', () => {
    const result = resumeFromHold({
      pausedAt: at(T0, 30),
      now: at(T0, 90),
      pausedTotalSeconds: 0,
      responseDueAt: at(T0, 60),
      resolutionDueAt: at(T0, 480),
      firstResponseAt: null,
    });

    expect(result.heldSeconds).toBe(60 * 60);
    expect(result.pausedTotalSeconds).toBe(3600);
    expect(result.responseDueAt?.toISOString()).toBe(at(T0, 120).toISOString());
    expect(result.resolutionDueAt?.toISOString()).toBe(at(T0, 540).toISOString());
  });

  it('ilk yanit verilmisse yanit hedefi kaydirilmaz', () => {
    const result = resumeFromHold({
      pausedAt: at(T0, 30),
      now: at(T0, 90),
      pausedTotalSeconds: 1800,
      responseDueAt: at(T0, 60),
      resolutionDueAt: at(T0, 480),
      firstResponseAt: at(T0, 20),
    });

    expect(result.responseDueAt?.toISOString()).toBe(at(T0, 60).toISOString());
    expect(result.resolutionDueAt?.toISOString()).toBe(at(T0, 540).toISOString());
    expect(result.pausedTotalSeconds).toBe(1800 + 3600);
  });

  it('arka arkaya duraklatmalarda toplam sure birikir', () => {
    const first = resumeFromHold({
      pausedAt: at(T0, 10),
      now: at(T0, 25),
      pausedTotalSeconds: 0,
      responseDueAt: at(T0, 60),
      resolutionDueAt: at(T0, 480),
      firstResponseAt: null,
    });

    const second = resumeFromHold({
      pausedAt: at(T0, 40),
      now: at(T0, 70),
      pausedTotalSeconds: first.pausedTotalSeconds,
      responseDueAt: first.responseDueAt,
      resolutionDueAt: first.resolutionDueAt,
      firstResponseAt: null,
    });

    expect(second.pausedTotalSeconds).toBe(45 * 60);
    expect(second.resolutionDueAt?.toISOString()).toBe(at(T0, 525).toISOString());
  });
});

describe('formatRemaining', () => {
  it('kalan sureyi insan okunur bicimde yazar', () => {
    expect(formatRemaining(135 * MINUTE_MS)).toBe('2s 15dk kaldi');
    expect(formatRemaining(-65 * MINUTE_MS)).toBe('1s 5dk gecti');
    expect(formatRemaining(30 * MINUTE_MS)).toBe('30dk kaldi');
    expect(formatRemaining(26 * 60 * MINUTE_MS)).toBe('1g 2s 0dk kaldi');
  });
});
