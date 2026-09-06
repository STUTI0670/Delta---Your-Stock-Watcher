import Link from 'next/link';
import { Bell, Check } from 'lucide-react';
import AlertRows from '@/components/alerts/AlertRows';
import SectionHeading from '@/components/common/SectionHeading';
import DeliveryChoice from '@/components/alerts/DeliveryChoice';
import { getAlertDeliveryMode } from '@/lib/actions/feedback.actions';
import { getAlertHistory, getAlerts } from '@/lib/actions/alert.actions';
import { formatPrice } from '@/components/common/format';
import { currencyForSymbol } from '@/lib/market/currency';

export const dynamic = 'force-dynamic';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function AlertsPage() {
  const [alerts, history, deliveryMode] = await Promise.all([
    getAlerts(),
    getAlertHistory(30),
    getAlertDeliveryMode(),
  ]);
  const active = alerts.filter((alert) => alert.isEnabled).length;

  return (
    <section className="pt-10 md:pt-14">
      <h1 className="wp-page-title">Price alerts</h1>
      <p className="wp-page-sub">
        {active === 0
          ? 'Name a price on any stock and we will watch it in the background.'
          : `${active} ${active === 1 ? 'price is' : 'prices are'} being watched for you. We tell you once when a price is reached, then wait for it to move clear before it can tell you again.`}
      </p>

      <div className="mt-8">
        <SectionHeading label="Your thresholds" count={alerts.length} />
        {alerts.length === 0 ? (
          <div className="wp-empty">
            <span className="wp-empty-art">
              <Bell className="h-6 w-6" />
            </span>
            <h2 className="wp-empty-title">No price alerts yet</h2>
            <p className="wp-empty-body">
              Open any stock on your watchlist and set a buy or sell price. We will keep an eye on it for you.
            </p>
            <div className="wp-empty-action">
              <Link href="/watchlist" className="wp-btn wp-btn-primary">
                Go to your watchlist
              </Link>
            </div>
          </div>
        ) : (
          <AlertRows alerts={alerts} />
        )}
      </div>

      {/* How triggered alerts reach you. History is kept either way. */}
      <div className="mt-12">
        <SectionHeading label="How alerts reach you" />
        <div className="mt-3">
          <DeliveryChoice mode={deliveryMode} />
        </div>
      </div>

      <div className="mt-12">
        <SectionHeading label="Alert history" count={history.length} />
        {history.length === 0 ? (
          <div className="wp-notice wp-notice-neutral">
            <span>Nothing has reached one of your prices yet. This is where we will log it when it does.</span>
          </div>
        ) : (
          <div className="wp-table">
            {history.map((event) => (
              <div key={event.id} className="wp-alert-row">
                <span className="wp-alert-icon" data-direction={event.direction} aria-hidden="true">
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                </span>
                <div className="wp-alert-id">
                  <Link href={`/stocks/${event.symbol}`} className="wp-alert-symbol hover:underline">
                    {event.symbol}
                  </Link>
                  <span className="wp-alert-rule">
                    Reached {formatPrice(event.triggeredPrice, currencyForSymbol(event.symbol))} ·{' '}
                    {event.direction === 'buy' ? 'buy at' : 'sell at'}{' '}
                    {formatPrice(event.threshold, currencyForSymbol(event.symbol))}
                  </span>
                </div>
                <span className="shrink-0 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                  {formatWhen(event.triggeredAt)}
                </span>
                {!event.notified && (
                  <span className="wp-pill wp-pill-warn" title="The notification could not be delivered.">
                    Not sent
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
