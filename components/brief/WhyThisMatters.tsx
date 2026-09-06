'use client';

import { useState, useTransition } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { submitFeedback } from '@/lib/actions/feedback.actions';
import { SIGNAL_LABELS } from '@/lib/market/personalization';
import type { AttentionFactor, SignalKind, Vote } from '@/lib/actions/dashboard.types';

const KIND_ORDER: Record<SignalKind, number> = { price: 0, volume: 1, event: 2, threshold: 3 };

interface WhyThisMattersProps {
  symbol: string;
  factors: AttentionFactor[];
  /** Signals that could not be evaluated, so their absence is explained. */
  unavailable: SignalKind[];
  total: number;
  /** The user's existing votes, keyed `SYMBOL:signal`. */
  feedback: Record<string, Vote>;
}

/**
 * The score, itemised.
 *
 * Every line is a measurement that actually added points, so the total is
 * always fully accounted for. The thumbs let the user say whether that kind of
 * signal is worth their attention, which tunes how it is weighted next time.
 */
export default function WhyThisMatters({ symbol, factors, unavailable, total, feedback }: WhyThisMattersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<SignalKind | null>(null);

  const vote = (kind: SignalKind, next: Vote) => {
    const current = feedback[`${symbol}:${kind}`];
    const isUndo = current === next;

    setBusy(kind);
    startTransition(async () => {
      const outcome = await submitFeedback(symbol, kind, next, isUndo);
      setBusy(null);

      if (outcome.ok) {
        toast.success(
          isUndo
            ? 'Feedback cleared'
            : next === 'useful'
              ? `We'll weigh ${SIGNAL_LABELS[kind].toLowerCase()} more for you`
              : `We'll weigh ${SIGNAL_LABELS[kind].toLowerCase()} less for you`
        );
        router.refresh();
      } else {
        toast.error(outcome.error ?? 'Could not save your feedback.');
      }
    });
  };

  if (factors.length === 0 && unavailable.length === 0) return null;

  const sorted = [...factors].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  return (
    <section className="wp-why" aria-label={`Why ${symbol} was surfaced`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="wp-section-title">Why you&rsquo;re seeing this</h2>
        <span className="wp-score" data-band={total >= 6 ? 'critical' : total >= 3 ? 'watch' : 'normal'}>
          <span className="wp-score-num">{total}</span> attention score
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-3 text-[14px]" style={{ color: 'var(--ink-3)' }}>
          Nothing crossed a threshold, so {symbol} was not flagged for your attention.
        </p>
      ) : (
        <div className="wp-why-list">
          {sorted.map((factor) => {
            const current = feedback[`${symbol}:${factor.kind}`];
            const disabled = pending && busy === factor.kind;

            return (
              <div key={factor.kind} className="wp-why-item">
                <span className="wp-why-kind">{SIGNAL_LABELS[factor.kind]}</span>
                <span className="wp-why-text">{factor.text}</span>
                <span className="wp-why-points">+{factor.points}</span>

                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="wp-vote"
                    data-on={current === 'useful'}
                    disabled={disabled}
                    aria-pressed={current === 'useful'}
                    aria-label={`${SIGNAL_LABELS[factor.kind]} is useful`}
                    title="Useful — show me more of this"
                    onClick={() => vote(factor.kind, 'useful')}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="wp-vote"
                    data-on={current === 'not-useful'}
                    disabled={disabled}
                    aria-pressed={current === 'not-useful'}
                    aria-label={`${SIGNAL_LABELS[factor.kind]} is not useful`}
                    title="Not useful — show me less of this"
                    onClick={() => vote(factor.kind, 'not-useful')}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {unavailable.length > 0 && (
        <p className="wp-why-missing">
          Not counted this time:{' '}
          {unavailable.map((kind) => SIGNAL_LABELS[kind].toLowerCase()).join(', ')} — we could not measure{' '}
          {unavailable.length === 1 ? 'it' : 'them'}, which is not the same as nothing having happened.
        </p>
      )}
    </section>
  );
}
