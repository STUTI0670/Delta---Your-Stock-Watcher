import { describe, expect, it } from 'vitest';
import { baselineLevel, combineLevels, type AttentionLevel } from '@/lib/market/attention-level';
import { bandFor, computeAttentionScore } from '@/lib/market/attention-score';
import type { Severity } from '@/lib/market/change-detection';

const LEVELS: AttentionLevel[] = ['normal', 'watch', 'critical'];
const RANK: Record<AttentionLevel, number> = { normal: 0, watch: 1, critical: 2 };

describe('baselineLevel — the P1 rule, unchanged', () => {
  it('treats a large move as critical', () => {
    expect(baselineLevel('large', false)).toBe('critical');
  });

  it('treats a notable move as worth watching', () => {
    expect(baselineLevel('notable', false)).toBe('watch');
  });

  it('promotes a flat stock on unusual volume alone', () => {
    expect(baselineLevel('none', true)).toBe('watch');
  });

  it('leaves a quiet stock alone', () => {
    expect(baselineLevel('none', false)).toBe('normal');
  });
});

describe('combineLevels — scoring may escalate but never demote', () => {
  it('never returns less attention than the P1 baseline', () => {
    for (const baseline of LEVELS) {
      for (const band of LEVELS) {
        const result = combineLevels(baseline, band);
        expect(RANK[result]).toBeGreaterThanOrEqual(RANK[baseline]);
      }
    }
  });

  it('takes whichever of the two is higher', () => {
    expect(combineLevels('normal', 'critical')).toBe('critical');
    expect(combineLevels('critical', 'normal')).toBe('critical');
    expect(combineLevels('watch', 'critical')).toBe('critical');
    expect(combineLevels('critical', 'watch')).toBe('critical');
    expect(combineLevels('normal', 'watch')).toBe('watch');
    expect(combineLevels('normal', 'normal')).toBe('normal');
  });
});

describe('the P1 guarantee survives the P2 score', () => {
  /**
   * The regression this protects against: a 7% move scores 3 on its own, which
   * bands as "watch". Without the floor, adding scoring would have quietly
   * demoted every large move that had no other signal.
   */
  it('keeps a large move critical even when it is the only signal', () => {
    const score = computeAttentionScore({ changePercent: 7 });
    expect(score.band).toBe('watch');

    const level = combineLevels(baselineLevel('large', false), score.band);
    expect(level).toBe('critical');
  });

  it('keeps an unusual-volume stock at least worth watching', () => {
    const score = computeAttentionScore({ changePercent: 0, volumeRatio: 2.4 });
    expect(bandFor(score.total)).toBe('normal');

    expect(combineLevels(baselineLevel('none', true), score.band)).toBe('watch');
  });

  it('lets accumulated signals escalate a stock P1 would have called quiet', () => {
    // A small move, but a volume spike, news and a triggered alert alongside it.
    const score = computeAttentionScore({
      changePercent: 2,
      volumeRatio: 3.2,
      newsCount: 3,
      thresholdCrossings: 2,
    });
    expect(score.total).toBeGreaterThanOrEqual(6);

    const level = combineLevels(baselineLevel('none', false), score.band);
    expect(level).toBe('critical');
  });

  it('holds for every severity and signal combination', () => {
    const severities: Severity[] = ['none', 'notable', 'large'];

    for (const severity of severities) {
      for (const unusualVolume of [false, true]) {
        for (const changePercent of [0.2, 2, 4, 7]) {
          const score = computeAttentionScore({
            changePercent,
            volumeRatio: unusualVolume ? 2.5 : 1,
          });
          const baseline = baselineLevel(severity, unusualVolume);
          const level = combineLevels(baseline, score.band);

          expect(RANK[level]).toBeGreaterThanOrEqual(RANK[baseline]);
          if (severity === 'large') expect(level).toBe('critical');
        }
      }
    }
  });
});
