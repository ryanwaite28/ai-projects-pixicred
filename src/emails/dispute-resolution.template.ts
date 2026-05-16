import Handlebars from 'handlebars';
import disputeResolutionTemplateSource from './templates/dispute-resolution.hbs';
import type { Transaction, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

const disputeResolutionTemplate = Handlebars.compile(disputeResolutionTemplateSource);

export function buildDisputeResolutionEmail(
  transaction: Transaction,
  account: Account,
  outcome: 'DISPUTE_ACCEPTED' | 'DISPUTE_DENIED',
  portalBaseUrl: string,
): SendEmailInput {
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const isAccepted = outcome === 'DISPUTE_ACCEPTED';
  const merchantName = transaction.merchantName ?? 'Unknown Merchant';
  const transactionIdShort = `${transaction.transactionId.slice(0, 8)}...`;

  const htmlBody = disputeResolutionTemplate({
    transactionIdShort,
    merchantName,
    amount: fmt(transaction.amount),
    outcome,
    isAccepted,
    resolvedAt: fmtDate(transaction.statusUpdatedAt),
    portalBaseUrl,
  });

  const subject = isAccepted
    ? `Dispute Accepted — $${fmt(transaction.amount)} at ${merchantName}`
    : `Dispute Denied — $${fmt(transaction.amount)} at ${merchantName}`;

  return {
    to: account.holderEmail,
    subject,
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      isAccepted
        ? `Your dispute for a charge of $${fmt(transaction.amount)} at ${merchantName} has been accepted. A credit will be applied to your account if applicable.`
        : `Your dispute for a charge of $${fmt(transaction.amount)} at ${merchantName} has been denied. The original charge stands.`,
      '',
      `Transaction ID:   ${transactionIdShort}`,
      `Merchant:         ${merchantName}`,
      `Amount:           $${fmt(transaction.amount)}`,
      `Outcome:          ${outcome}`,
      `Resolution Date:  ${fmtDate(transaction.statusUpdatedAt)}`,
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
