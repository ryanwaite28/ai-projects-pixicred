import Handlebars from 'handlebars';
import reminderTemplateSource from './templates/payment-due-reminder.hbs';
import { computeMinimumPayment } from '../service/payment.service.js';
import type { Account, PaymentDueSchedule } from '../types/index.js';
import type { SendEmailInput } from './decline.template.js';

export type { SendEmailInput };

const reminderTemplate = Handlebars.compile(reminderTemplateSource);

export function buildPaymentDueReminderEmail(
  account: Account,
  schedule: PaymentDueSchedule,
): SendEmailInput {
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const minimumPayment = computeMinimumPayment(account.currentBalance);

  const htmlBody = reminderTemplate({
    accountId: account.accountId,
    currentBalance: fmt(account.currentBalance),
    minimumPayment: fmt(minimumPayment),
    paymentDueDate: schedule.paymentDueDate,
  });

  return {
    to: account.holderEmail,
    subject: `Payment Due on ${schedule.paymentDueDate} — PixiCred`,
    htmlBody,
    textBody: [
      'Dear Valued Customer,',
      '',
      `A payment on your PixiCred account (${account.accountId}) is due on ${schedule.paymentDueDate}.`,
      '',
      `Current Balance:    $${fmt(account.currentBalance)}`,
      `Minimum Payment:    $${fmt(minimumPayment)}`,
      `Payment Due Date:   ${schedule.paymentDueDate}`,
      '',
      'WARNING: If your balance remains unpaid 14 days after the due date, your account will be automatically closed.',
      '',
      'Log in at https://pixicred.com/dashboard to make a payment.',
      '',
      'The PixiCred Team',
    ].join('\n'),
  };
}
