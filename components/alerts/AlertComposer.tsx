'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { createPriceAlert, updatePriceAlert } from '@/lib/actions/alert.actions';
import { formatPrice } from '@/components/common/format';
import { currencyForSymbol } from '@/lib/market/currency';

export interface ExistingThreshold {
  direction: 'buy' | 'sell';
  threshold: number;
  isEnabled: boolean;
}

interface AlertComposerProps {
  open: boolean;
  onClose: () => void;
  symbol: string;
  company: string;
  currentPrice: number | null;
  /** Alerts already set for this symbol, shown as confirmations. */
  existing?: ExistingThreshold[];
  /** Present when editing one existing threshold rather than composing new ones. */
  editing?: { id: string; direction: 'buy' | 'sell'; threshold: number };
}

/** Offsets from the current price, so a threshold is one tap, not arithmetic. */
const BUY_OFFSETS = [-5, -10];
const SELL_OFFSETS = [5, 10];

/**
 * Set a price alert.
 *
 * Written as a sentence rather than a form: the user reads "buy when the price
 * reaches X, sell when it reaches Y" and fills in the blanks. Both sides are
 * optional, so one visit can create either or both — and the panel confirms
 * what is now live before it closes.
 */
export default function AlertComposer({
  open,
  onClose,
  symbol,
  company,
  currentPrice,
  existing = [],
  editing,
}: AlertComposerProps) {
  const router = useRouter();
  const currency = currencyForSymbol(symbol);
  const [pending, startTransition] = useTransition();
  const [buy, setBuy] = useState('');
  const [sell, setSell] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ExistingThreshold[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCreated(null);
    if (editing) {
      setBuy(editing.direction === 'buy' ? String(editing.threshold) : '');
      setSell(editing.direction === 'sell' ? String(editing.threshold) : '');
    } else {
      setBuy('');
      setSell('');
    }
  }, [open, editing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;

  const suggest = (offsetPct: number): string =>
    currentPrice === null ? '' : (currentPrice * (1 + offsetPct / 100)).toFixed(2);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const buyValue = buy.trim() ? Number(buy) : null;
    const sellValue = sell.trim() ? Number(sell) : null;

    if (buyValue === null && sellValue === null) {
      setError('Enter a buy price, a sell price, or both.');
      return;
    }
    for (const value of [buyValue, sellValue]) {
      if (value !== null && (!Number.isFinite(value) || value <= 0)) {
        setError('Prices must be above zero.');
        return;
      }
    }
    // A buy above the sell threshold would fire both at once and mean nothing.
    if (buyValue !== null && sellValue !== null && buyValue >= sellValue) {
      setError('The buy price needs to be below the sell price.');
      return;
    }
    setError(null);

    startTransition(async () => {
      if (editing) {
        const value = editing.direction === 'buy' ? buyValue : sellValue;
        if (value === null) {
          setError('Enter a price for this alert.');
          return;
        }
        const outcome = await updatePriceAlert(editing.id, { threshold: value });
        if (!outcome.ok) {
          setError(outcome.error ?? 'Could not update the alert.');
          return;
        }
        toast.success(`${symbol} alert updated`);
        onClose();
        router.refresh();
        return;
      }

      const made: ExistingThreshold[] = [];
      for (const [direction, value] of [
        ['buy', buyValue],
        ['sell', sellValue],
      ] as const) {
        if (value === null) continue;
        const outcome = await createPriceAlert({ symbol, company, direction, threshold: value });
        if (!outcome.ok) {
          setError(outcome.error ?? 'Could not create the alert.');
          return;
        }
        made.push({ direction, threshold: value, isEnabled: true });
      }

      setCreated(made);
      router.refresh();
    });
  };

  const confirmations = created ?? existing.filter((alert) => alert.isEnabled);

  return (
    <>
      <div className="wp-overlay" onClick={onClose} aria-hidden="true" />
      <div className="wp-panel" role="dialog" aria-modal="true" aria-label={`Set a price alert for ${symbol}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="wp-panel-title">{symbol}</h2>
            <p className="wp-panel-sub truncate">{company}</p>
          </div>
          <button type="button" className="wp-icon-btn -mr-1 -mt-1" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="mt-4 flex items-baseline justify-between gap-4 rounded-xl px-4 py-3"
          style={{ background: 'var(--paper-sunk)' }}
        >
          <span className="text-[13.5px]" style={{ color: 'var(--ink-3)' }}>
            Current price
          </span>
          <span className="wp-num text-[22px] font-semibold" style={{ color: 'var(--ink)' }}>
            {formatPrice(currentPrice, currency)}
          </span>
        </div>

        {created ? (
          /* The alert exists now. Say so plainly, then get out of the way. */
          <div className="mt-6">
            <p className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              You are all set.
            </p>
            <div className="mt-3 space-y-2">
              {created.map((alert) => (
                <p key={alert.direction} className="wp-confirm">
                  <span className="wp-confirm-check" aria-hidden="true">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {alert.direction === 'buy' ? 'Buy' : 'Sell'} alert active at {formatPrice(alert.threshold, currency)}
                </p>
              ))}
            </div>
            <p className="mt-4 text-[13px]" style={{ color: 'var(--ink-3)' }}>
              We will email you once when the price is reached, and again only after it moves clear and comes back.
            </p>
            <button type="button" className="wp-btn wp-btn-primary mt-6 w-full" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-5">
            <p className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              {editing ? 'Edit this alert' : 'Set a price alert'}
            </p>

            {confirmations.length > 0 && !editing && (
              <div className="space-y-2">
                {confirmations.map((alert) => (
                  <p key={alert.direction} className="wp-confirm">
                    <span className="wp-confirm-check" aria-hidden="true">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {alert.direction === 'buy' ? 'Buy' : 'Sell'} alert active at {formatPrice(alert.threshold, currency)}
                  </p>
                ))}
              </div>
            )}

            {(!editing || editing.direction === 'buy') && (
              <div>
                <label htmlFor="buy-threshold" className="wp-threshold-label block">
                  Buy when price reaches
                </label>
                <div className="wp-field mt-2">
                  <span className="wp-field-prefix">$</span>
                  <input
                    id="buy-threshold"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="wp-input"
                    value={buy}
                    onChange={(e) => setBuy(e.target.value)}
                    autoFocus
                  />
                </div>
                {currentPrice !== null && (
                  <div className="mt-2 flex gap-2">
                    {BUY_OFFSETS.map((offset) => (
                      <button key={offset} type="button" className="wp-chip" onClick={() => setBuy(suggest(offset))}>
                        {offset}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(!editing || editing.direction === 'sell') && (
              <div>
                <label htmlFor="sell-threshold" className="wp-threshold-label block">
                  Sell when price reaches
                </label>
                <div className="wp-field mt-2">
                  <span className="wp-field-prefix">$</span>
                  <input
                    id="sell-threshold"
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="wp-input"
                    value={sell}
                    onChange={(e) => setSell(e.target.value)}
                    autoFocus={Boolean(editing)}
                  />
                </div>
                {currentPrice !== null && (
                  <div className="mt-2 flex gap-2">
                    {SELL_OFFSETS.map((offset) => (
                      <button key={offset} type="button" className="wp-chip" onClick={() => setSell(suggest(offset))}>
                        +{offset}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="text-[13.5px] font-medium" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}

            <button type="submit" className="wp-btn wp-btn-primary w-full" disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save alert' : 'Create alert'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
