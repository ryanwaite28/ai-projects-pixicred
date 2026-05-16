import Handlebars from 'handlebars';
import chargeCreatedTemplateSource from './templates/charge-created.hbs';
import type { Transaction, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

const chargeCreatedTemplate = Handlebars.compile(chargeCreatedTemplateSource);

export function buildChargeCreatedEmail(transaction: Transaction, account: Account, portalBaseUrl: string): SendEmailInput {
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isDenied = transaction.status === 'DENIED';
  const merchantName = transaction.merchantName ?? 'Unknown Merchant';

  const htmlBody = chargeCreatedTemplate({
    merchantName,
    amount: fmt(transaction.amount),
    status: transaction.status,
    isDenied,
    currentBalance: fmt(account.currentBalance),
    availableCredit: fmt(account.availableCredit),
    portalBaseUrl,
  });

  const subject = isDenied
    ? `Transaction Denied — $${fmt(transaction.amount)} at ${merchantName}`
    : `Transaction Processing — $${fmt(transaction.amount)} at ${merchantName}`;

  return {
    to: account.holderEmail,
    subject,
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      isDenied
        ? `A charge of $${fmt(transaction.amount)} at ${merchantName} was denied due to insufficient available credit.`
        : `A charge of $${fmt(transaction.amount)} at ${merchantName} is processing on your PixiCred account.`,
      '',
      `Merchant:         ${merchantName}`,
      `Amount:           $${fmt(transaction.amount)}`,
      `Status:           ${transaction.status}`,
      `Current Balance:  $${fmt(account.currentBalance)}`,
      `Available Credit: $${fmt(account.availableCredit)}`,
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
