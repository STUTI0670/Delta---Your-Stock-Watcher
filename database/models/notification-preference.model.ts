import { Schema, model, models, type Model } from 'mongoose';

export type NotificationMode = 'individual' | 'digest';

/**
 * How a user wants to hear about triggered alerts.
 *
 * 'individual' sends one email per crossing (the P1 behaviour, and the default).
 * 'digest' stays silent at trigger time and instead rolls everything up into a
 * single periodic summary.
 */
export interface NotificationPreferenceDoc {
  userId: string;
  mode: NotificationMode;
  /** Last time a digest was sent, so the job knows what is still pending. */
  lastDigestAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationPreferenceSchema = new Schema<NotificationPreferenceDoc>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    mode: { type: String, required: true, enum: ['individual', 'digest'], default: 'individual' },
    lastDigestAt: { type: Date, default: null },
  },
  { collection: 'notification_preferences', timestamps: true }
);

export const NotificationPreference: Model<NotificationPreferenceDoc> =
  (models?.NotificationPreference as Model<NotificationPreferenceDoc>) ||
  model<NotificationPreferenceDoc>('NotificationPreference', NotificationPreferenceSchema);
