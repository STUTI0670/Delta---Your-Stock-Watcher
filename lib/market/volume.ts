/**
 * Volume baseline for a symbol, measured from its own recent daily history.
 *
 * P1.2 allows volume as a signal "if reliable data is available". Yahoo's daily
 * history supplies both the latest session's volume and the average to judge it
 * against, so "unusual activity" is a measured fact rather than a guess.
 *
 * Deliberately simple and deterministic: an average, a ratio, and a threshold.
 *
 * Pure: no React, no database, no network.
 */

import { MEANINGFUL_VOLUME_SPIKE_RATIO, MIN_SESSIONS_FOR_VOLUME_BASELINE } from '@/lib/market/config';

export interface VolumeBar {
  close: number;
  volume?: number | null;
}

export interface VolumeBaseline {
  symbol: string;
  /** Sessions with usable volume that the average is based on. */
  sessions: number;
  /** True once there is enough history for the average to mean anything. */
  hasBaseline: boolean;
  averageVolume: number | null;
  latestVolume: number | null;
  /** latestVolume / averageVolume, when both are known. */
  ratio: number | null;
  /** True when the latest session is an outlier against its own norm. */
  isUnusual: boolean;
}

export function computeVolumeBaseline(symbol: string, bars: VolumeBar[]): VolumeBaseline {
  const volumes = (bars ?? [])
    .map((bar) => bar.volume)
    .filter((volume): volume is number => typeof volume === 'number' && Number.isFinite(volume) && volume > 0);

  if (volumes.length < MIN_SESSIONS_FOR_VOLUME_BASELINE) {
    return {
      symbol,
      sessions: volumes.length,
      hasBaseline: false,
      averageVolume: null,
      latestVolume: volumes.length > 0 ? volumes[volumes.length - 1] : null,
      ratio: null,
      isUnusual: false,
    };
  }

  const latestVolume = volumes[volumes.length - 1];
  // The latest session is excluded from its own baseline, otherwise a genuine
  // spike drags the average up and partially hides itself.
  const priorVolumes = volumes.slice(0, -1);
  const averageVolume = priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length;
  const ratio = averageVolume > 0 ? latestVolume / averageVolume : null;

  return {
    symbol,
    sessions: priorVolumes.length,
    hasBaseline: true,
    averageVolume,
    latestVolume,
    ratio,
    isUnusual: ratio !== null && ratio >= MEANINGFUL_VOLUME_SPIKE_RATIO,
  };
}

/** "2.4× normal" — the phrase the UI uses for an unusual session. */
export function describeVolume(baseline: VolumeBaseline): string | null {
  if (!baseline.hasBaseline || baseline.ratio === null) return null;
  return `${baseline.ratio.toFixed(1)}× normal`;
}

/**
 * Normalise a close series to 0..1 for a sparkline. Returns an empty array when
 * there is nothing meaningful to draw.
 */
export function sparklineSeries(bars: VolumeBar[], maxPoints = 30): number[] {
  const closes = (bars ?? [])
    .map((bar) => bar.close)
    .filter((close): close is number => typeof close === 'number' && Number.isFinite(close) && close > 0)
    .slice(-maxPoints);

  if (closes.length < 2) return [];

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  // A perfectly flat series has no range to normalise against; draw it centred.
  if (max === min) return closes.map(() => 0.5);

  return closes.map((close) => (close - min) / (max - min));
}
