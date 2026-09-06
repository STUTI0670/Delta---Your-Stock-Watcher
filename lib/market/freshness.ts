/**
 * Delta never presents delayed data as if it were live, so every quote
 * carries a value, a timestamp and a source, and the UI labels anything past
 * the staleness window.
 */

import { STALE_QUOTE_AFTER_MS } from '@/lib/market/config';

export function isStale(updatedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!updatedAt) return true;
  const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return true;
  return now.getTime() - date.getTime() > STALE_QUOTE_AFTER_MS;
}

/** "just now" / "18 min ago" / "3 hr ago" / "2 days ago" */
export function describeAge(updatedAt: Date | string | null | undefined, now: Date = new Date()): string {
  if (!updatedAt) return 'never updated';
  const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 'never updated';

  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** "Yesterday, 6:20 PM" style label for the previous checkpoint. */
export function describeCheckpointTime(checkedAt: Date | string | null | undefined, now: Date = new Date()): string {
  if (!checkedAt) return 'this is your first check';
  const date = checkedAt instanceof Date ? checkedAt : new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return 'this is your first check';

  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameDay = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (sameDay) return `today at ${time}`;
  if (isYesterday) return `yesterday at ${time}`;

  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

/**
 * "6 hours 24 minutes" — the elapsed span shown in the hero.
 * Returns the two most significant units so the phrase stays readable.
 */
export function describeElapsed(
  since: Date | string | null | undefined,
  now: Date = new Date()
): { value: string; unit: string } | null {
  if (!since) return null;
  const date = since instanceof Date ? since : new Date(since);
  if (Number.isNaN(date.getTime())) return null;

  const totalMinutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));

  if (totalMinutes < 1) return { value: 'Just', unit: 'now' };
  if (totalMinutes < 60) return { value: String(totalMinutes), unit: totalMinutes === 1 ? 'minute' : 'minutes' };

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    if (minutes === 0) return { value: String(totalHours), unit: totalHours === 1 ? 'hour' : 'hours' };
    return { value: `${totalHours}h ${minutes}m`, unit: 'ago' };
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (hours === 0) return { value: String(days), unit: days === 1 ? 'day' : 'days' };
  return { value: `${days}d ${hours}h`, unit: 'ago' };
}

export type QuoteFreshness = 'live' | 'delayed' | 'closed' | 'unavailable';

export interface QuoteStatus {
  /** The sentence shown under a price. */
  text: string;
  tone: QuoteFreshness;
}

/** Beyond this, a quote is not "delayed" — the market it belongs to is shut. */
const SESSION_GAP_MS = 8 * 60 * 60 * 1000;

/**
 * How to describe the age of a price to a person.
 *
 * A price from last Friday is not "delayed" — the exchange was closed, and the
 * figure is the latest one that exists. Saying "delayed" there reads as a fault
 * in the product, so past one session's gap we name the session instead. Only a
 * quote that is stale *while trading hours are plausible* is called delayed.
 */
export function describeQuoteStatus(
  updatedAt: Date | string | null | undefined,
  now: Date = new Date()
): QuoteStatus {
  if (!updatedAt) return { text: 'No price available', tone: 'unavailable' };

  const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return { text: 'No price available', tone: 'unavailable' };

  const elapsed = now.getTime() - date.getTime();

  if (elapsed <= STALE_QUOTE_AFTER_MS) return { text: `Updated ${describeAge(date, now)}`, tone: 'live' };

  if (elapsed < SESSION_GAP_MS) return { text: `Updated ${describeAge(date, now)}`, tone: 'delayed' };

  // Past a session gap we stop describing sessions and just state when the
  // price is from. We do not know the exchange's calendar, and a US close read
  // in IST falls on the local Saturday — so "Friday's close" would be a claim
  // we cannot back. A plain local timestamp is always true.
  return {
    text: `Last price ${date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}`,
    tone: 'closed',
  };
}
