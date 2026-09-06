/**
 * Verifies the mail setup and sends one test email.
 *
 * Gmail rejects an ordinary account password over SMTP, and the app's mail
 * failures are caught and logged rather than thrown — so a bad credential looks
 * exactly like "nothing happened". This turns that into a clear answer.
 *
 * Run: npm run check:mail
 */
import 'dotenv/config';
import nodemailer from 'nodemailer';

const user = process.env.NODEMAILER_EMAIL;
const pass = process.env.NODEMAILER_PASSWORD;
const to = process.argv[2] || user;

function fail(message, hint) {
  console.error(`\n  ✗ ${message}`);
  if (hint) console.error(`    ${hint}`);
  process.exit(1);
}

if (!user) fail('NODEMAILER_EMAIL is empty in .env', 'Set it to the Gmail address you want to send from.');
if (!pass) fail('NODEMAILER_PASSWORD is empty in .env', 'Set it to a Google App Password (16 characters).');

// A Google App Password is 16 characters, usually shown in four groups of four.
const normalised = pass.replace(/\s+/g, '');
if (normalised.length !== 16) {
  console.warn(
    `\n  ! NODEMAILER_PASSWORD is ${normalised.length} characters. Google App Passwords are 16.` +
      '\n    If this is your normal account password, Gmail will reject it.'
  );
}

console.log(`\n  Sending as : ${user}`);
console.log(`  Sending to : ${to}\n`);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user, pass: normalised },
});

try {
  await transporter.verify();
  console.log('  ✓ Gmail accepted the credentials');
} catch (err) {
  const code = err?.responseCode ?? err?.code ?? '';
  if (String(code) === '535' || /Username and Password not accepted/i.test(err?.message ?? '')) {
    fail(
      'Gmail rejected the credentials (535).',
      'This is almost always a normal password instead of an App Password.\n' +
        '    Enable 2-Step Verification, then create one at:\n' +
        '    https://myaccount.google.com/apppasswords'
    );
  }
  fail(`Could not connect to Gmail: ${err?.message ?? err}`);
}

try {
  const info = await transporter.sendMail({
    from: `"Delta" <${user}>`,
    to,
    subject: 'Delta — mail is working',
    text: 'If you are reading this, Delta can send your daily briefing and price alerts.',
    html:
      '<div style="font-family:system-ui,sans-serif;padding:24px;color:#0d1b2f">' +
      '<h2 style="margin:0 0 8px">Mail is working</h2>' +
      '<p style="color:#4a5a72;margin:0">Delta can now send your 6pm daily briefing and your price alerts.</p>' +
      '</div>',
  });

  console.log(`  ✓ Test email sent (${info.messageId})`);
  console.log(`\n  Check the inbox for ${to}.\n`);
} catch (err) {
  fail(`Sending failed: ${err?.message ?? err}`);
}
