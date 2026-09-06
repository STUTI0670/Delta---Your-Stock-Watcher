import { Schema, model, models, type Model } from 'mongoose';
import type { AlertDirection } from '@/database/models/price-alert.model';

/**
 * An immutable record of a threshold that was actually crossed and notified.
 * This is the user-facing alert history and the audit trail proving the
 * notifier is backed by the database rather than transient UI state.
 */
export interface AlertEventDoc {
  userId: string;
  alertId: string;
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
  triggeredPrice: number;
  message: string;
  triggeredAt: Date;
  notifiedAt: Date | null;
  notificationError: string | null;
}

const AlertEventSchema = new Schema<AlertEventDoc>(
  {
    userId: { type: String, required: true, index: true },
    alertId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    company: { type: String, required: true, trim: true },
    direction: { type: String, required: true, enum: ['buy', 'sell'] },
    threshold: { type: Number, required: true },
    triggeredPrice: { type: Number, required: true },
    message: { type: String, required: true },
    triggeredAt: { type: Date, required: true, default: Date.now },
    notifiedAt: { type: Date, default: null },
    notificationError: { type: String, default: null },
  },
  { collection: 'alert_events', timestamps: false }
);

AlertEventSchema.index({ userId: 1, triggeredAt: -1 });

export const AlertEvent: Model<AlertEventDoc> =
  (models?.AlertEvent as Model<AlertEventDoc>) || model<AlertEventDoc>('AlertEvent', AlertEventSchema);
