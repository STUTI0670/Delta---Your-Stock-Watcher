import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { sendDailyNewsSummary, sendSignUpEmail } from '@/lib/inngest/functions';
import { pollPriceAlerts, sendAlertDigests } from '@/lib/inngest/alert-poller';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [sendSignUpEmail, sendDailyNewsSummary, pollPriceAlerts, sendAlertDigests],
});
