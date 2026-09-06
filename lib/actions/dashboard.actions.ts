'use server';

import { getSessionUser } from '@/lib/actions/session';
import { getFeedbackIndex } from '@/lib/services/feedback.service';
import { describeWeights, type Vote } from '@/lib/market/personalization';
import { buildAttentionReport, type WatchlistChange } from '@/lib/services/attention.service';
import type { DashboardChange, MarketBrief } from '@/lib/actions/dashboard.types';

function serialize(change: WatchlistChange): DashboardChange {
  return { ...change, updatedAt: change.updatedAt ? change.updatedAt.toISOString() : null };
}

/**
 * The market brief. Reads the checkpoint, compares, renders — and advances the
 * checkpoint only after the comparison has been built.
 */
export async function getMarketBrief(): Promise<MarketBrief | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const [report, feedback] = await Promise.all([
    buildAttentionReport(user.id),
    getFeedbackIndex(user.id).catch(() => ({}) as Record<string, Vote>),
  ]);

  return {
    comparedTo: report.comparedTo ? report.comparedTo.toISOString() : null,
    isFirstCheck: report.isFirstCheck,
    changes: report.changes.map(serialize),
    needsAttention: report.needsAttention.map(serialize),
    meaningfulCount: report.needsAttention.length,
    majorMoveCount: report.changes.filter((change) => change.severity === 'large').length,
    unusualVolumeCount: report.changes.filter((change) => change.volume?.isUnusual).length,
    eventCount: report.changes.reduce((sum, change) => sum + change.newsCount, 0),
    thresholdsReached: report.thresholdsReached,
    dataUnavailable: report.dataUnavailable,
    degradedSymbols: report.degradedSymbols,
    newsUnavailable: report.newsUnavailable,
    insights: report.insights,
    weights: report.weights,
    personalized: report.personalized,
    weightNotes: describeWeights(report.weights),
    feedback,
  };
}

/** One symbol's "what changed?" view for the detail page. */
export async function getSymbolBrief(symbol: string): Promise<DashboardChange | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const report = await buildAttentionReport(user.id);
  const change = report.changes.find((item) => item.symbol === symbol.trim().toUpperCase());
  return change ? serialize(change) : null;
}
