'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bell, Check, Plus } from 'lucide-react';
import AlertComposer, { type ExistingThreshold } from '@/components/alerts/AlertComposer';
import { addToWatchlist, removeFromWatchlist } from '@/lib/actions/watchlist.actions';

export default function StockActions({
  symbol,
  company,
  currentPrice,
  isWatched,
  existingAlerts = [],
}: {
  symbol: string;
  company: string;
  currentPrice: number | null;
  isWatched: boolean;
  existingAlerts?: ExistingThreshold[];
}) {
  const router = useRouter();
  const [watched, setWatched] = useState(isWatched);
  const [pending, startTransition] = useTransition();
  const [composing, setComposing] = useState(false);

  const toggle = () => {
    const next = !watched;
    setWatched(next);

    startTransition(async () => {
      const outcome = next ? await addToWatchlist(symbol, company) : await removeFromWatchlist(symbol);
      if (outcome.ok) {
        toast.success(next ? `${symbol} is on your watchlist` : `${symbol} removed`);
        router.refresh();
      } else {
        setWatched(!next);
        toast.error(outcome.error ?? 'Something went wrong.');
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="wp-btn wp-btn-quiet"
        data-on={watched}
        onClick={toggle}
        disabled={pending}
        aria-pressed={watched}
      >
        {watched ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {watched ? 'Watching' : 'Watch'}
      </button>
      <button type="button" className="wp-btn wp-btn-primary" onClick={() => setComposing(true)}>
        <Bell className="h-4 w-4" />
        Set price alert
      </button>

      {composing && (
        <AlertComposer
          open
          onClose={() => setComposing(false)}
          symbol={symbol}
          company={company}
          currentPrice={currentPrice}
          existing={existingAlerts}
        />
      )}
    </div>
  );
}
