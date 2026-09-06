import { Schema, model, models, type Model } from 'mongoose';

export type AlertDirection = 'buy' | 'sell';

/**
 * A price threshold the user wants to be told about.
 *
 * `isArmed` is what makes the notifier idempotent: an alert fires only while it
 * is armed, disarms itself on fire, and re-arms only once price has recovered
 * clear of the threshold. See lib/market/alert-rules.ts.
 */
export interface PriceAlertDoc {
  userId: string;
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
  isEnabled: boolean;
  isArmed: boolean;
  lastTriggeredAt: Date | null;
  lastTriggeredPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const PriceAlertSchema = new Schema<PriceAlertDoc>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    company: { type: String, required: true, trim: true },
    direction: { type: String, required: true, enum: ['buy', 'sell'] },
    threshold: { type: Number, required: true, min: 0 },
    isEnabled: { type: Boolean, default: true },
    isArmed: { type: Boolean, default: true },
    lastTriggeredAt: { type: Date, default: null },
    lastTriggeredPrice: { type: Number, default: null },
  },
  { collection: 'price_alerts', timestamps: true }
);

PriceAlertSchema.index({ userId: 1, symbol: 1 });
// The alert poller scans only enabled+armed alerts.
PriceAlertSchema.index({ isEnabled: 1, isArmed: 1 });

export const PriceAlert: Model<PriceAlertDoc> =
  (models?.PriceAlert as Model<PriceAlertDoc>) || model<PriceAlertDoc>('PriceAlert', PriceAlertSchema);
