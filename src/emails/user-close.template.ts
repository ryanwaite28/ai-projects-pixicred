import Handlebars from 'handlebars';
import userCloseTemplateSource from './templates/user-close.hbs';
import type { Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

export type { SendEmailInput };

const userCloseTemplate = Handlebars.compile(userCloseTemplateSource);

export function buildUserCloseEmail(account: Account): SendEmailInput {
  const closedAtFormatted = account.closedAt
    ? account.closedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : 'recently';

  const htmlBody = userCloseTemplate({
    accountId: account.accountId,
    closedAt: closedAtFormatted,
  });

  return {
    to: account.holderEmail,
    subject: 'Your PixiCred Account Has Been Closed',
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      `Your PixiCred credit card account (${account.accountId}) has been closed at your request.`,
      `The closure took effect on ${closedAtFormatted}.`,
      '',
      'If you wish to open a new PixiCred account in the future, you are welcome to reapply at any time.',
      'Visit https://pixicred.com/apply to submit a new application.',
      '',
      'Thank you for being a PixiCred customer.',
      'The PixiCred Team',
    ].join('\n'),
  };
}
