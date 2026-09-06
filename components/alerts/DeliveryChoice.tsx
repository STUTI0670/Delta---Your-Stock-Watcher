'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setAlertDeliveryMode } from '@/lib/actions/feedback.actions';
import type { NotificationMode } from '@/database/models/notification-preference.model';

const OPTIONS: Array<{ mode: NotificationMode; title: string; note: string }> = [
  {
    mode: 'individual',
    title: 'Tell me straight away',
    note: 'One email the moment a price is reached. Best when you have a few alerts you care about deeply.',
  },
  {
    mode: 'digest',
    title: 'Bundle them into one summary',
    note: 'Stay silent at the moment of the crossing and send a single roundup instead. Best when you watch a lot of stocks.',
  },
];

/**
 * How triggered alerts reach the user.
 *
 * Either way the crossing is recorded in history, so switching modes changes
 * only how loudly the user is told — never what is remembered.
 */
export default function DeliveryChoice({ mode }: { mode: NotificationMode }) {
  const router = useRouter();
  const [selected, setSelected] = useState<NotificationMode>(mode);
  const [pending, startTransition] = useTransition();

  const choose = (next: NotificationMode) => {
    if (next === selected) return;
    const previous = selected;
    setSelected(next);

    startTransition(async () => {
      const outcome = await setAlertDeliveryMode(next);
      if (outcome.ok) {
        toast.success(next === 'digest' ? 'Alerts will arrive as one summary' : 'Alerts will arrive individually');
        router.refresh();
      } else {
        setSelected(previous);
        toast.error(outcome.error ?? 'Could not change alert delivery.');
      }
    });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="How alerts reach you">
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={selected === option.mode}
          className="wp-choice"
          data-on={selected === option.mode}
          disabled={pending}
          onClick={() => choose(option.mode)}
        >
          <span className="wp-choice-radio" aria-hidden="true">
            {selected === option.mode && <span className="wp-choice-dot" />}
          </span>
          <span>
            <span className="wp-choice-title block">{option.title}</span>
            <span className="wp-choice-note block">{option.note}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
