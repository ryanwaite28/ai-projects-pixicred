import Handlebars from 'handlebars';
import approvalTemplateSource from './templates/approval.hbs';
import type { Application, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

export type { SendEmailInput };

const approvalTemplate = Handlebars.compile(approvalTemplateSource);

function formatCardNumber(cardNumber: string): string {
  return cardNumber.replace(/(.{4})/g, '$1 ').trim();
}

function formatCardExpiry(cardExpiry: string): string {
  // cardExpiry is YYYY-MM-DD; display as MM/YY
  const [year, month] = cardExpiry.split('-') as [string, string];
  return `${month}/${year.slice(2)}`;
}

export function buildApprovalEmail(application: Application, account: Account, baseUrl: string): SendEmailInput {
  const htmlBody = approvalTemplate({
    firstName: application.firstName,
    lastName: application.lastName,
    creditLimit: account.creditLimit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    paymentDueDate: account.paymentDueDate,
    accountId: account.accountId,
    baseUrl,
    cardNumber: formatCardNumber(account.cardNumber),
    cardExpiry: formatCardExpiry(account.cardExpiry),
    cardCvv: account.cardCvv,
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
      `To create your portal password, visit ${baseUrl}/setup and enter your Account Setup Code.`,
      '',
      'Your Card Details:',
      `  Card Number: ${formatCardNumber(account.cardNumber)}`,
      `  Expiry: ${formatCardExpiry(account.cardExpiry)}`,
      `  CVV: ${account.cardCvv}`,
      '',
      'Welcome to PixiCred!',
      'The PixiCred Team',
    ].join('\n'),
  };
}
