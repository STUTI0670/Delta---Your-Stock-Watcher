'use server';

import { revalidatePath } from 'next/cache';
import type { AlertDirection } from '@/lib/market/alert-rules';
import { getSessionUser } from '@/lib/actions/session';
import {
  createAlert,
  deleteAlert,
  listAlertHistory,
  listAlerts,
  setAlertEnabled,
  updateAlert,
} from '@/lib/services/alert.service';

export interface AlertView {
  id: string;
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
  isEnabled: boolean;
  isArmed: boolean;
  lastTriggeredAt: string | null;
  lastTriggeredPrice: number | null;
}

export interface AlertEventView {
  id: string;
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
  triggeredPrice: number;
  message: string;
  triggeredAt: string;
  notified: boolean;
}

export interface AlertActionResult {
  ok: boolean;
  error?: string;
}

export async function getAlerts(): Promise<AlertView[]> {
  const user = await getSessionUser();
  if (!user) return [];

  const alerts = await listAlerts(user.id);
  return alerts.map((alert) => ({
    id: alert.id,
    symbol: alert.symbol,
    company: alert.company,
    direction: alert.direction,
    threshold: alert.threshold,
    isEnabled: alert.isEnabled,
    isArmed: alert.isArmed,
    lastTriggeredAt: alert.lastTriggeredAt ? alert.lastTriggeredAt.toISOString() : null,
    lastTriggeredPrice: alert.lastTriggeredPrice,
  }));
}

export async function getAlertHistory(limit = 25): Promise<AlertEventView[]> {
  const user = await getSessionUser();
  if (!user) return [];

  const events = await listAlertHistory(user.id, limit);
  return events.map((event) => ({
    id: event.id ?? `${event.alertId}-${event.triggeredAt.getTime()}`,
    symbol: event.symbol,
    company: event.company,
    direction: event.direction,
    threshold: event.threshold,
    triggeredPrice: event.triggeredPrice,
    message: event.message,
    triggeredAt: event.triggeredAt.toISOString(),
    notified: Boolean(event.notifiedAt),
  }));
}

export async function createPriceAlert(input: {
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
}): Promise<AlertActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  try {
    await createAlert({ ...input, userId: user.id });
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    console.error('createPriceAlert failed', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create this alert.' };
  }
}

export async function updatePriceAlert(
  alertId: string,
  patch: { threshold?: number; direction?: AlertDirection; isEnabled?: boolean }
): Promise<AlertActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  try {
    const updated = await updateAlert(user.id, alertId, patch);
    if (!updated) return { ok: false, error: 'Alert not found.' };
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    console.error('updatePriceAlert failed', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update this alert.' };
  }
}

export async function togglePriceAlert(alertId: string, isEnabled: boolean): Promise<AlertActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  try {
    const updated = await setAlertEnabled(user.id, alertId, isEnabled);
    if (!updated) return { ok: false, error: 'Alert not found.' };
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    console.error('togglePriceAlert failed', err);
    return { ok: false, error: 'Could not update this alert.' };
  }
}

export async function deletePriceAlert(alertId: string): Promise<AlertActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  try {
    const removed = await deleteAlert(user.id, alertId);
    if (!removed) return { ok: false, error: 'Alert not found.' };
    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    console.error('deletePriceAlert failed', err);
    return { ok: false, error: 'Could not delete this alert.' };
  }
}
