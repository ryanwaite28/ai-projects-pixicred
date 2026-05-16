import Handlebars from 'handlebars';
import chargePostedTemplateSource from './templates/charge-posted.hbs';
import type { Transaction, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

const chargePostedTemplate = Handlebars.compile(chargePostedTemplateSource);

export function buildChargePostedEmail(transaction: Transaction, account: Account, portalBaseUrl: string): SendEmailInput {
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const merchantName = transaction.merchantName ?? 'Unknown Merchant';

  const htmlBody = chargePostedTemplate({
    merchantName,
    amount: fmt(transaction.amount),
    createdAt: fmtDate(transaction.createdAt),
    postedAt: fmtDate(transaction.statusUpdatedAt),
    portalBaseUrl,
  });

  return {
    to: account.holderEmail,
    subject: `Transaction Posted — $${fmt(transaction.amount)} at ${merchantName}`,
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      `A charge of $${fmt(transaction.amount)} at ${merchantName} has posted to your PixiCred account.`,
      '',
      `Merchant:         ${merchantName}`,
      `Amount:           $${fmt(transaction.amount)}`,
      `Transaction Date: ${fmtDate(transaction.createdAt)}`,
      `Posted Date:      ${fmtDate(transaction.statusUpdatedAt)}`,
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
