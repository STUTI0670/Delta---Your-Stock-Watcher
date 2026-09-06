'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/actions/session';
import { clearFeedback, getFeedbackIndex, recordFeedback } from '@/lib/services/feedback.service';
import { getNotificationMode, setNotificationMode } from '@/lib/services/digest.service';
import type { SignalKind } from '@/lib/market/attention-score';
import type { Vote } from '@/lib/market/personalization';
import type { NotificationMode } from '@/database/models/notification-preference.model';

export interface ActionOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Record — or undo — a verdict on one kind of signal for one stock.
 * Passing `isUndo` clears the vote, so the thumb toggles off.
 */
export async function submitFeedback(
  symbol: string,
  signalKind: SignalKind,
  vote: Vote,
  isUndo = false
): Promise<ActionOutcome> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  try {
    if (isUndo) await clearFeedback(user.id, symbol, signalKind);
    else await recordFeedback(user.id, symbol, signalKind, vote);

    revalidatePath('/');
    revalidatePath(`/stocks/${symbol.toUpperCase()}`);
    return { ok: true };
  } catch (err) {
    console.error('submitFeedback failed', err);
    return { ok: false, error: 'Could not save your feedback.' };
  }
}

/**
 * The signed-in user's votes, keyed `SYMBOL:signal`.
 *
 * Deliberately separate from the market brief: building a second attention
 * report inside one request would advance the checkpoint twice and destroy the
 * comparison the page is about to render.
 */
export async function getFeedbackMap(): Promise<Record<string, Vote>> {
  const user = await getSessionUser();
  if (!user) return {};

  try {
    return await getFeedbackIndex(user.id);
  } catch (err) {
    console.error('getFeedbackMap failed', err);
    return {};
  }
}

export async function getAlertDeliveryMode(): Promise<NotificationMode> {
  const user = await getSessionUser();
  if (!user) return 'individual';
  return getNotificationMode(user.id);
}

export async function setAlertDeliveryMode(mode: NotificationMode): Promise<ActionOutcome> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  try {
    await setNotificationMode(user.id, mode);
    revalidatePath('/alerts');
    return { ok: true };
  } catch (err) {
    console.error('setAlertDeliveryMode failed', err);
    return { ok: false, error: 'Could not change how alerts are delivered.' };
  }
}
