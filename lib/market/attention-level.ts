/**
 * Combining the P1 rule with the P2 score.
 *
 * P1 decided attention from severity alone: a large move is critical, a notable
 * move or unusual volume is worth watching. P2 adds a score that also weighs
 * volume, news and the user's own triggered alerts.
 *
 * The two are combined by taking whichever is higher. Scoring may only
 * *escalate* attention, never demote it — so adding the score can never make
 * the product quieter about something P1 already considered urgent, and a 6%
 * move stays critical even when no other signal fired.
 *
 * Pure: no React, no database, no network.
 */

import type { AttentionBand } from '@/lib/market/attention-score';
import type { Severity } from '@/lib/market/change-detection';

export type AttentionLevel = AttentionBand;

const RANK: Record<AttentionLevel, number> = { normal: 0, watch: 1, critical: 2 };

/** The P1 rule, unchanged: severity and unusual volume alone decide a floor. */
export function baselineLevel(severity: Severity, volumeIsUnusual: boolean): AttentionLevel {
  if (severity === 'large') return 'critical';
  if (severity === 'notable') return 'watch';
  if (volumeIsUnusual) return 'watch';
  return 'normal';
}

/** Whichever of the P1 floor and the P2 band demands more attention. */
export function combineLevels(baseline: AttentionLevel, band: AttentionLevel): AttentionLevel {
  return RANK[band] > RANK[baseline] ? band : baseline;
}
