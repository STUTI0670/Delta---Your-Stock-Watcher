import { Schema, model, models, type Model } from 'mongoose';

export type FeedbackSignalKind = 'price' | 'volume' | 'event' | 'threshold';
export type FeedbackVote = 'useful' | 'not-useful';

/**
 * A user's verdict on one kind of signal for one stock.
 *
 * Stored per (user, symbol, signal) so a newer opinion replaces the older one
 * rather than accumulating — someone who changes their mind should not have to
 * out-vote their own history.
 */
export interface ChangeFeedbackDoc {
  userId: string;
  symbol: string;
  signalKind: FeedbackSignalKind;
  vote: FeedbackVote;
  createdAt: Date;
  updatedAt: Date;
}

const ChangeFeedbackSchema = new Schema<ChangeFeedbackDoc>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    signalKind: { type: String, required: true, enum: ['price', 'volume', 'event', 'threshold'] },
    vote: { type: String, required: true, enum: ['useful', 'not-useful'] },
  },
  { collection: 'change_feedback', timestamps: true }
);

ChangeFeedbackSchema.index({ userId: 1, symbol: 1, signalKind: 1 }, { unique: true });

export const ChangeFeedback: Model<ChangeFeedbackDoc> =
  (models?.ChangeFeedback as Model<ChangeFeedbackDoc>) ||
  model<ChangeFeedbackDoc>('ChangeFeedback', ChangeFeedbackSchema);
