import Handlebars from 'handlebars';
import autoCloseTemplateSource from './templates/auto-close.hbs';
import type { Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

export type { SendEmailInput };

const autoCloseTemplate = Handlebars.compile(autoCloseTemplateSource);

export function buildAutoCloseEmail(account: Account): SendEmailInput {
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const htmlBody = autoCloseTemplate({
    accountId: account.accountId,
    currentBalance: fmt(account.currentBalance),
  });

  return {
    to: account.holderEmail,
    subject: 'Your PixiCred Account Has Been Automatically Closed',
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      `Your PixiCred credit card account (${account.accountId}) has been automatically closed due to non-payment.`,
      '',
      `Outstanding Balance: $${fmt(account.currentBalance)}`,
      'Closure Reason:      Non-payment (balance unpaid 14+ days past due date)',
      '',
      'If you would like to open a new account in the future, you may reapply at https://pixicred.com/apply.',
      '',
      'If you have questions, please contact us at https://pixicred.com/support.',
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
