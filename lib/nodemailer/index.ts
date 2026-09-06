import nodemailer from 'nodemailer';
import {WELCOME_EMAIL_TEMPLATE, NEWS_SUMMARY_EMAIL_TEMPLATE, DAILY_BRIEF_EMAIL_TEMPLATE} from "@/lib/nodemailer/templates";
import type {DailyBrief} from "@/lib/services/brief-email";

export const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.NODEMAILER_EMAIL!,
        pass: process.env.NODEMAILER_PASSWORD!,
    }
})

export const sendWelcomeEmail = async ({ email, name, intro }: WelcomeEmailData) => {
    const htmlTemplate = WELCOME_EMAIL_TEMPLATE
        .replace('{{name}}', name)
        .replace('{{intro}}', intro);

    const mailOptions = {
        from: `"Delta" <alerts@delta.app>`,
        to: email,
        subject: `Welcome to Delta - your stock market toolkit is ready!`,
        text: 'Thanks for joining Delta',
        html: htmlTemplate,
    }

    await transporter.sendMail(mailOptions);
}

export const sendNewsSummaryEmail = async (
    { email, date, newsContent }: { email: string; date: string; newsContent: string }
): Promise<void> => {
    const htmlTemplate = NEWS_SUMMARY_EMAIL_TEMPLATE
        .replace('{{date}}', date)
        .replace('{{newsContent}}', newsContent);

    const mailOptions = {
        from: `"Delta News" <alerts@delta.app>`,
        to: email,
        subject: `📈 Market News Summary Today - ${date}`,
        text: `Today's market news summary from Delta`,
        html: htmlTemplate,
    };

    await transporter.sendMail(mailOptions);
};

/** Where the email's call to action points. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://delta.app';

/**
 * Send one user their daily briefing.
 *
 * The subject line carries the answer — "3 meaningful changes: NVDA +7.6%" —
 * so the email is useful from the inbox list without being opened.
 */
export const sendDailyBriefEmail = async (
    { email, date, brief }: { email: string; date: string; brief: DailyBrief }
): Promise<void> => {
    const html = DAILY_BRIEF_EMAIL_TEMPLATE
        .replace(/{{date}}/g, date)
        .replace(/{{headline}}/g, brief.headline)
        .replace(/{{standfirst}}/g, brief.standfirst)
        .replace(/{{changes}}/g, brief.changesHtml)
        .replace(/{{news}}/g, brief.newsHtml)
        .replace(/{{appUrl}}/g, APP_URL);

    await transporter.sendMail({
        from: `"Delta" <${process.env.NODEMAILER_EMAIL ?? 'alerts@delta.app'}>`,
        to: email,
        subject: brief.subject,
        text: brief.text,
        html,
    });
};
