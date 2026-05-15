import Handlebars from 'handlebars';
import statementTemplateSource from './templates/statement.hbs';
import type { Statement, Account } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

export type { SendEmailInput };

const statementTemplate = Handlebars.compile(statementTemplateSource);

export function buildStatementEmail(statement: Statement, account: Account, baseUrl: string): SendEmailInput {
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const periodStart = statement.periodStart.toISOString().split('T')[0] as string;
  const periodEnd = statement.periodEnd.toISOString().split('T')[0] as string;

  const htmlBody = statementTemplate({
    periodStart,
    periodEnd,
    openingBalance: fmt(statement.openingBalance),
    totalCharges: fmt(statement.totalCharges),
    totalPayments: fmt(statement.totalPayments),
    closingBalance: fmt(statement.closingBalance),
    minimumPaymentDue: fmt(statement.minimumPaymentDue),
    dueDate: statement.dueDate,
    baseUrl,
  });

  return {
    to: account.holderEmail,
    subject: `Your PixiCred Statement: ${periodStart} to ${periodEnd}`,
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      `Your PixiCred statement for ${periodStart} to ${periodEnd} is now available.`,
      '',
      `Opening Balance:      $${fmt(statement.openingBalance)}`,
      `Total Charges:        $${fmt(statement.totalCharges)}`,
      `Total Payments:       $${fmt(statement.totalPayments)}`,
      `Closing Balance:      $${fmt(statement.closingBalance)}`,
      `Minimum Payment Due:  $${fmt(statement.minimumPaymentDue)}`,
      `Payment Due Date:     ${statement.dueDate}`,
      '',
      `Log in at ${baseUrl}/dashboard to view the full statement.`,
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
