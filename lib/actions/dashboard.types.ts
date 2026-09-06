/**
 * View types for the market brief.
 *
 * Kept out of the `'use server'` action module: that file may only export async
 * functions, so re-exporting types from it breaks the server-action build.
 */

import type { AttentionLevel, WatchlistChange } from '@/lib/services/attention.service';
import type { SymbolInsight } from '@/lib/services/insight.service';
import type { SignalWeights } from '@/lib/market/attention-score';
import type { Vote } from '@/lib/market/personalization';

export type { AttentionLevel };
export type { VolumeBaseline } from '@/lib/market/volume';
export type { AttentionFactor, AttentionScore, SignalKind } from '@/lib/market/attention-score';
export type { CadenceRecommendation, Cadence } from '@/lib/market/monitoring-cadence';
export type { PriceBehavior } from '@/lib/market/price-behavior';
export type { Vote };
export type { SymbolInsight };

/** A change, serialised for the client (Dates become ISO strings). */
export interface DashboardChange extends Omit<WatchlistChange, 'updatedAt'> {
  updatedAt: string | null;
}

export interface MarketBrief {
  comparedTo: string | null;
  isFirstCheck: boolean;
  changes: DashboardChange[];
  needsAttention: DashboardChange[];
  /** Counts for the "since you last checked" summary. */
  meaningfulCount: number;
  majorMoveCount: number;
  unusualVolumeCount: number;
  eventCount: number;
  thresholdsReached: number;
  dataUnavailable: boolean;
  degradedSymbols: string[];
  newsUnavailable: boolean;
  /** P2: monitoring-cadence recommendations, busiest first. */
  insights: SymbolInsight[];
  /** P2: the user's personalized signal weights. */
  weights: Required<SignalWeights>;
  personalized: boolean;
  /** P2: how the user's feed has been tuned, in words. */
  weightNotes: string[];
  /** P2: the user's votes, keyed `SYMBOL:signal`. */
  feedback: Record<string, Vote>;
}
