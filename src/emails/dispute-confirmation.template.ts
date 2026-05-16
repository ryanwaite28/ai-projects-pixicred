import Handlebars from 'handlebars';
import disputeConfirmationTemplateSource from './templates/dispute-confirmation.hbs';
import type { Transaction, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

const disputeConfirmationTemplate = Handlebars.compile(disputeConfirmationTemplateSource);

export function buildDisputeConfirmationEmail(transaction: Transaction, account: Account, portalBaseUrl: string): SendEmailInput {
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const merchantName = transaction.merchantName ?? 'Unknown Merchant';
  const transactionIdShort = `${transaction.transactionId.slice(0, 8)}...`;

  const htmlBody = disputeConfirmationTemplate({
    transactionIdShort,
    merchantName,
    amount: fmt(transaction.amount),
    disputedAt: fmtDate(transaction.statusUpdatedAt),
    portalBaseUrl,
  });

  return {
    to: account.holderEmail,
    subject: `Dispute Received — $${fmt(transaction.amount)} at ${merchantName}`,
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      `We have received your dispute for a charge of $${fmt(transaction.amount)} at ${merchantName}.`,
      'Your dispute is under review and we will notify you once a decision has been made.',
      '',
      `Transaction ID: ${transactionIdShort}`,
      `Merchant:       ${merchantName}`,
      `Amount:         $${fmt(transaction.amount)}`,
      `Dispute Filed:  ${fmtDate(transaction.statusUpdatedAt)}`,
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
