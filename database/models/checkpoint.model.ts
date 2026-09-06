import { Schema, model, models, type Model } from 'mongoose';

/**
 * The heart of Delta: a durable record of the last time a user actually
 * reviewed their watchlist, plus the market state as it stood at that moment.
 *
 * Every "since you last checked" comparison is measured against this document,
 * which is why it lives in the database rather than in browser storage — it has
 * to survive refreshes, logouts and device switches.
 */
export interface CheckpointPriceSnapshot {
  symbol: string;
  price: number;
  volume?: number;
  capturedAt: Date;
}

export interface CheckpointDoc {
  userId: string;
  /** When the user last meaningfully reviewed their watchlist. */
  checkedAt: Date;
  /** Market state captured at `checkedAt`, one entry per watched symbol. */
  snapshots: CheckpointPriceSnapshot[];
  createdAt: Date;
  updatedAt: Date;
}

const SnapshotSchema = new Schema<CheckpointPriceSnapshot>(
  {
    symbol: { type: String, required: true, uppercase: true, trim: true },
    price: { type: Number, required: true },
    volume: { type: Number },
    capturedAt: { type: Date, required: true },
  },
  { _id: false }
);

const CheckpointSchema = new Schema<CheckpointDoc>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    checkedAt: { type: Date, required: true },
    snapshots: { type: [SnapshotSchema], default: [] },
  },
  { collection: 'checkpoints', timestamps: true }
);

export const Checkpoint: Model<CheckpointDoc> =
  (models?.Checkpoint as Model<CheckpointDoc>) || model<CheckpointDoc>('Checkpoint', CheckpointSchema);
