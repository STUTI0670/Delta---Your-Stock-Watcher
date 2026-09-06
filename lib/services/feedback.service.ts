/**
 * Feedback service — records what a user found useful and turns it into the
 * signal weights the attention score reads.
 */

import { deriveSignalWeights, type Vote } from '@/lib/market/personalization';
import type { SignalKind, SignalWeights } from '@/lib/market/attention-score';
import { mongoFeedbackRepository, type FeedbackRepository, type StoredFeedback } from '@/lib/services/repositories';

export async function recordFeedback(
  userId: string,
  symbol: string,
  signalKind: SignalKind,
  vote: Vote,
  repo: FeedbackRepository = mongoFeedbackRepository,
  now: Date = new Date()
): Promise<void> {
  if (!userId) throw new Error('A signed-in user is required.');
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) throw new Error('A symbol is required.');

  await repo.record({ userId, symbol: normalized, signalKind, vote, createdAt: now });
}

export async function clearFeedback(
  userId: string,
  symbol: string,
  signalKind: SignalKind,
  repo: FeedbackRepository = mongoFeedbackRepository
): Promise<boolean> {
  if (!userId) return false;
  return repo.clear(userId, symbol.trim().toUpperCase(), signalKind);
}

export async function listFeedback(
  userId: string,
  repo: FeedbackRepository = mongoFeedbackRepository
): Promise<StoredFeedback[]> {
  if (!userId) return [];
  return repo.listByUser(userId);
}

/**
 * The user's personalized signal weights. Falls back to neutral if the lookup
 * fails, so a feedback outage degrades to the default experience rather than
 * breaking the briefing.
 */
export async function getSignalWeights(
  userId: string,
  repo: FeedbackRepository = mongoFeedbackRepository,
  now: Date = new Date()
): Promise<Required<SignalWeights>> {
  try {
    return deriveSignalWeights(await listFeedback(userId, repo), now);
  } catch (err) {
    console.error('getSignalWeights failed; falling back to neutral weights', err);
    return deriveSignalWeights([], now);
  }
}

/** The user's votes indexed as `SYMBOL:signal`, for quick lookup in the UI. */
export async function getFeedbackIndex(
  userId: string,
  repo: FeedbackRepository = mongoFeedbackRepository
): Promise<Record<string, Vote>> {
  const records = await listFeedback(userId, repo);
  return records.reduce<Record<string, Vote>>((acc, record) => {
    acc[`${record.symbol}:${record.signalKind}`] = record.vote;
    return acc;
  }, {});
}
