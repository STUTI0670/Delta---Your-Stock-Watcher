'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, TrendingDown, TrendingUp, X } from 'lucide-react';
import AlertComposer from '@/components/alerts/AlertComposer';
import { deletePriceAlert, togglePriceAlert, type AlertView } from '@/lib/actions/alert.actions';
import { formatPrice } from '@/components/common/format';
import { currencyForSymbol } from '@/lib/market/currency';

function AlertRow({ alert }: { alert: AlertView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, message: string) =>
    startTransition(async () => {
      const outcome = await fn();
      if (outcome.ok) {
        toast.success(message);
        router.refresh();
      } else {
        toast.error(outcome.error ?? 'Something went wrong.');
      }
    });

  // Three distinct states, each said in words rather than by colour alone.
  const state = !alert.isEnabled ? 'Paused' : alert.isArmed ? 'Active' : 'Triggered';
  const Icon = alert.direction === 'buy' ? TrendingDown : TrendingUp;

  return (
    <div className="wp-alert-row" data-enabled={alert.isEnabled}>
      <span className="wp-alert-icon" data-direction={alert.direction} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>

      <div className="wp-alert-id">
        <Link href={`/stocks/${alert.symbol}`} className="wp-alert-symbol hover:underline">
          {alert.symbol}
        </Link>
        <span className="wp-alert-rule">
          {alert.direction === 'buy' ? 'Buy at or below ' : 'Sell at or above '}
          {formatPrice(alert.threshold, currencyForSymbol(alert.symbol))}
        </span>
      </div>

      <span
        className={`wp-pill ${state === 'Active' ? 'wp-pill-up' : ''}`}
        title={
          state === 'Triggered'
            ? 'Already notified. Re-arms once the price moves clear of the threshold.'
            : state === 'Paused'
              ? 'Disabled — it will not fire.'
              : 'Watching for your price.'
        }
      >
        {state}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={alert.isEnabled}
        aria-label={`${alert.isEnabled ? 'Pause' : 'Enable'} the ${alert.symbol} ${alert.direction} alert`}
        className="wp-toggle"
        data-on={alert.isEnabled}
        disabled={pending}
        onClick={() =>
          run(
            () => togglePriceAlert(alert.id, !alert.isEnabled),
            alert.isEnabled ? `${alert.symbol} alert paused` : `${alert.symbol} alert active`
          )
        }
      >
        <span className="wp-toggle-knob" />
      </button>

      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="wp-icon-btn"
          title="Edit price"
          aria-label={`Edit the ${alert.symbol} ${alert.direction} price`}
          disabled={pending}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="wp-icon-btn"
          title="Delete alert"
          aria-label={`Delete the ${alert.symbol} ${alert.direction} alert`}
          disabled={pending}
          onClick={() => run(() => deletePriceAlert(alert.id), `${alert.symbol} alert deleted`)}
        >
          <X className="h-4 w-4" />
        </button>
      </span>

      {editing && (
        <AlertComposer
          open
          onClose={() => setEditing(false)}
          symbol={alert.symbol}
          company={alert.company}
          currentPrice={alert.lastTriggeredPrice}
          editing={{ id: alert.id, direction: alert.direction, threshold: alert.threshold }}
        />
      )}
    </div>
  );
}

export default function AlertRows({ alerts }: { alerts: AlertView[] }) {
  return (
    <div className="wp-table">
      {alerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} />
      ))}
    </div>
  );
}
