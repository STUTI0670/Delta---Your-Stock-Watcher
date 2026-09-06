import { Schema, model, models, type Model } from 'mongoose';

/**
 * A single symbol a user has chosen to keep under watch.
 * One document per (user, symbol).
 */
export interface WatchItemDoc {
  userId: string;
  symbol: string;
  company: string;
  addedAt: Date;
}

const WatchItemSchema = new Schema<WatchItemDoc>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    company: { type: String, required: true, trim: true },
    addedAt: { type: Date, default: Date.now },
  },
  { collection: 'watch_items', timestamps: false }
);

WatchItemSchema.index({ userId: 1, symbol: 1 }, { unique: true });

export const WatchItem: Model<WatchItemDoc> =
  (models?.WatchItem as Model<WatchItemDoc>) || model<WatchItemDoc>('WatchItem', WatchItemSchema);
