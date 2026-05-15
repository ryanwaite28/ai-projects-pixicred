import Handlebars from 'handlebars';
import transactionTemplateSource from './templates/transaction.hbs';
import type { Transaction, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

export type { SendEmailInput };

const transactionTemplate = Handlebars.compile(transactionTemplateSource);

export function buildTransactionEmail(transaction: Transaction, account: Account, baseUrl: string): SendEmailInput {
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const htmlBody = transactionTemplate({
    accountId: account.accountId,
    merchantName: transaction.merchantName ?? 'Unknown Merchant',
    amount: fmt(transaction.amount),
    newBalance: fmt(account.currentBalance),
    availableCredit: fmt(account.availableCredit),
    baseUrl,
  });

  return {
    to: account.holderEmail,
    subject: `Transaction Posted: $${fmt(transaction.amount)} at ${transaction.merchantName ?? 'Unknown Merchant'}`,
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      `A charge has been posted to your PixiCred credit card account (${account.accountId}).`,
      '',
      `Merchant:         ${transaction.merchantName ?? 'Unknown Merchant'}`,
      `Amount:           $${fmt(transaction.amount)}`,
      `New Balance:      $${fmt(account.currentBalance)}`,
      `Available Credit: $${fmt(account.availableCredit)}`,
      '',
      `If you did not authorize this transaction, please contact us at ${baseUrl}/support.`,
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
