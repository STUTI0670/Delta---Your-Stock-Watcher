import {inngest} from "@/lib/inngest/client";
import type { NewsArticle } from "@/lib/market/types";
import {PERSONALIZED_WELCOME_EMAIL_PROMPT} from "@/lib/inngest/prompts";
import {sendDailyBriefEmail, sendWelcomeEmail} from "@/lib/nodemailer";
import {buildAttentionReport} from "@/lib/services/attention.service";
import {composeDailyBrief, type DailyBrief} from "@/lib/services/brief-email";
import {getAllUsersForNewsEmail} from "@/lib/actions/user.actions";
import { getWatchlistNews } from "@/lib/actions/market.actions";
import { getFormattedTodayDate } from "@/lib/utils";

export const sendSignUpEmail = inngest.createFunction(
    { id: 'sign-up-email' },
    { event: 'app/user.created'},
    async ({ event, step }) => {
        const userProfile = `
            - Country: ${event.data.country}
            - Investment goals: ${event.data.investmentGoals}
            - Risk tolerance: ${event.data.riskTolerance}
            - Preferred industry: ${event.data.preferredIndustry}
        `

        const prompt = PERSONALIZED_WELCOME_EMAIL_PROMPT.replace('{{userProfile}}', userProfile)

        const response = await step.ai.infer('generate-welcome-intro', {
            model: step.ai.models.gemini({ model: 'gemini-2.5-flash-lite' }),
            body: {
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt }
                        ]
                    }]
            }
        })

        await step.run('send-welcome-email', async () => {
            const part = response.candidates?.[0]?.content?.parts?.[0];
            const introText = (part && 'text' in part ? part.text : null) ||'Thanks for joining Delta. You now have the tools to track markets and make smarter moves.'

            const { data: { email, name } } = event;

            return await sendWelcomeEmail({ email, name, intro: introText });
        })

        return {
            success: true,
            message: 'Welcome email sent successfully'
        }
    }
)

/**
 * When the daily briefing email goes out.
 *
 * Inngest crons are UTC unless a timezone is named, so the zone is stated
 * explicitly — otherwise "19:00" silently means 00:30 local for a reader in
 * India. Override with DAILY_EMAIL_CRON to move it.
 */
const DAILY_EMAIL_CRON = process.env.DAILY_EMAIL_CRON ?? 'TZ=Asia/Kolkata 0 19 * * *';

/** Stories attached beneath the brief, per user. */
const NEWS_PER_USER = 5;

/**
 * The daily briefing.
 *
 * This job sends the product's actual answer — what meaningfully changed on the
 * reader's own watchlist since they last checked, with the same attention
 * scores and reasons the dashboard shows — rather than a list of headlines that
 * never mentions their holdings. News is attached underneath as context.
 *
 * Two things it is careful about:
 *
 *  - It builds each report with `advanceCheckpoint: false`. The user has not
 *    checked anything; a job that moved the baseline would tell them at 18:45
 *    what changed and then guarantee the app said "nothing changed" when they
 *    opened it a minute later.
 *  - One user's failure is contained to that user, so a single dead symbol or
 *    bad address does not cancel everyone else's briefing.
 */
export const sendDailyNewsSummary = inngest.createFunction(
    { id: 'daily-news-summary' },
    [ { event: 'app/send.daily.news' }, { cron: DAILY_EMAIL_CRON } ],
    async ({ step }) => {
        const users = await step.run('get-all-users', getAllUsersForNewsEmail)

        if(!users || users.length === 0) return { success: false, message: 'No users found for the daily briefing' };

        // Step #1: build each reader's brief from their own watchlist.
        const briefs = await step.run('build-briefs', async () => {
            const prepared: Array<{ user: UserForNewsEmail; brief: DailyBrief | null }> = [];

            for (const user of users as UserForNewsEmail[]) {
                if (!user.id) {
                    console.error('daily-brief: user has no id, skipping', user.email);
                    prepared.push({ user, brief: null });
                    continue;
                }

                try {
                    // Reading only — the baseline belongs to the user's own visits.
                    const report = await buildAttentionReport(user.id, new Date(), { advanceCheckpoint: false });

                    const symbols = report.changes.map((change) => change.symbol);
                    const news: NewsArticle[] = symbols.length
                        ? await getWatchlistNews(symbols, NEWS_PER_USER).catch(() => [])
                        : [];

                    const brief = composeDailyBrief({ report, news });
                    prepared.push({ user, brief: brief.worthSending ? brief : null });
                } catch (e) {
                    console.error('daily-brief: could not build a brief for', user.email, e);
                    prepared.push({ user, brief: null });
                }
            }

            return prepared;
        });

        // Step #2: send. Failures are per-recipient.
        const sent = await step.run('send-briefs', async () => {
            let delivered = 0;

            await Promise.all(
                briefs.map(async ({ user, brief }) => {
                    if (!brief) return;
                    try {
                        await sendDailyBriefEmail({ email: user.email, date: getFormattedTodayDate(), brief });
                        delivered += 1;
                    } catch (e) {
                        console.error('daily-brief: send failed for', user.email, e);
                    }
                })
            );

            return delivered;
        });

        return { success: true, message: `Daily briefing sent to ${sent} of ${users.length} users`, sent }
    }
)
