import Handlebars from 'handlebars';
import approvalTemplateSource from './templates/approval.hbs';
import type { Application, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

export type { SendEmailInput };

const approvalTemplate = Handlebars.compile(approvalTemplateSource);

export function buildApprovalEmail(application: Application, account: Account): SendEmailInput {
  const htmlBody = approvalTemplate({
    firstName: application.firstName,
    lastName: application.lastName,
    creditLimit: account.creditLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    paymentDueDate: account.paymentDueDate,
    accountId: account.accountId,
  });

  return {
    to: application.email,
    subject: 'Congratulations! Your PixiCred Application is Approved',
    htmlBody,
    textBody: [
      `Dear ${application.firstName} ${application.lastName},`,
      '',
      'Your PixiCred credit card application has been approved.',
      '',
      `Credit Limit: $${account.creditLimit}`,
      `Opening Balance: $500.00`,
      `First Payment Due Date: ${account.paymentDueDate}`,
      '',
      `Account Setup Code: ${account.accountId}`,
      '',
      'To create your portal password, visit https://pixicred.com/setup and enter your Account Setup Code.',
      '',
      'Welcome to PixiCred!',
      'The PixiCred Team',
    ].join('\n'),
  };
}
