'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { searchStocks } from '@/lib/actions/market.actions';
import { addToWatchlist } from '@/lib/actions/watchlist.actions';
import { toast } from 'sonner';

interface Result {
  symbol: string;
  name: string;
  exchange: string;
}

/**
 * Find a stock and put it under watch. Search is a verb here, not a page —
 * the whole flow is "type, pick, it's on your watchlist".
 */
export default function CommandSearch({ variant = 'trigger' }: { variant?: 'trigger' | 'primary' | 'tab' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
    else {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // Debounced lookup; an empty query shows the popular list.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const found = await searchStocks(query.trim());
        if (!cancelled) {
          setResults(found);
          setActive(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const watch = useCallback(
    async (result: Result) => {
      setAdding(result.symbol);
      const outcome = await addToWatchlist(result.symbol, result.name);
      setAdding(null);

      if (outcome.ok) {
        toast.success(`${result.symbol} added to your watchlist`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(outcome.error ?? 'Could not add that stock.');
      }
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void watch(results[active]);
    }
  };

  return (
    <>
      {variant === 'primary' ? (
        <button type="button" className="wp-btn wp-btn-primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add a stock
        </button>
      ) : variant === 'tab' ? (
        <button type="button" className="wp-tab" data-active={open} onClick={() => setOpen(true)}>
          <Search className="h-[18px] w-[18px]" strokeWidth={2} />
          Search
        </button>
      ) : (
        <button type="button" className="wp-search-trigger" onClick={() => setOpen(true)}>
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Search stocks</span>
          <kbd className="wp-kbd hidden sm:inline">⌘K</kbd>
        </button>
      )}

      {open && (
        <>
          <div className="wp-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="wp-palette" role="dialog" aria-modal="true" aria-label="Find a stock">
            <div className="wp-palette-head">
              <Search className="h-[18px] w-[18px] shrink-0" style={{ color: 'var(--ink-4)' }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search by symbol or company"
                className="wp-search-input"
                aria-label="Search stocks"
              />
            </div>

            <div className="wp-palette-body">
              {loading && results.length === 0 ? (
                <p className="px-5 py-8 text-[14px]" style={{ color: 'var(--ink-3)' }}>
                  Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="px-5 py-8 text-[14px]" style={{ color: 'var(--ink-3)' }}>
                  {query.trim() ? `Nothing matches “${query.trim()}”.` : 'Start typing to find a stock.'}
                </p>
              ) : (
                results.map((result, i) => (
                  <button
                    key={`${result.symbol}-${i}`}
                    type="button"
                    className="wp-result"
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void watch(result)}
                    disabled={adding === result.symbol}
                  >
                    <span className="wp-result-symbol">{result.symbol}</span>
                    <span className="wp-result-name">{result.name}</span>
                    <span
                      className="ml-auto flex shrink-0 items-center gap-1 text-[12.5px] font-semibold"
                      style={{ color: 'var(--blue)' }}
                    >
                      {adding === result.symbol ? (
                        'Adding…'
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" /> Watch
                        </>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="wp-palette-foot">
              <span>↑↓ move</span>
              <span>↵ add to watchlist</span>
              <span>esc close</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
