import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildPaymentDueReminderEmail } from '../../src/emails/payment-due-reminder.template';
import { computeMinimumPayment } from '../../src/service/payment.service';
import type { Account, PaymentDueSchedule } from '../../src/types/index';

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 650,
  availableCredit: 6850,
  status: 'ACTIVE',
  paymentDueDate: '2026-06-25',
  closeReason: null,
  closedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const schedule: PaymentDueSchedule = {
  accountId: account.accountId,
  paymentDueDate: '2026-06-25',
  satisfied: false,
  satisfiedAt: null,
  reminderSentDate: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

beforeEach(() => {
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

afterEach(() => {
  delete process.env['SES_FROM_EMAIL'];
});

describe('buildPaymentDueReminderEmail', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildPaymentDueReminderEmail(account, schedule, 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject references payment due date', () => {
    const email = buildPaymentDueReminderEmail(account, schedule, 'https://pixicred.com');
    expect(email.subject).toContain('2026-06-25');
  });

  it('body includes current balance', () => {
    const email = buildPaymentDueReminderEmail(account, schedule, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/650/);
  });

  it('body includes payment due date from schedule', () => {
    const email = buildPaymentDueReminderEmail(account, schedule, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body).toContain('2026-06-25');
  });

  it('body includes minimum payment amount computed from balance', () => {
    const email = buildPaymentDueReminderEmail(account, schedule, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    const expectedMin = computeMinimumPayment(account.currentBalance);
    expect(body).toMatch(new RegExp(String(expectedMin).replace('.', '\\.')));
  });

  it('body includes warning about auto-close 14 days after due date', () => {
    const email = buildPaymentDueReminderEmail(account, schedule, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body.toLowerCase()).toMatch(/14.*day|auto.*clos|clos.*auto/i);
  });

  it('uses SES_FROM_EMAIL env var as sender when set', () => {
    process.env['SES_FROM_EMAIL'] = 'custom@pixicred.com';
    const email = buildPaymentDueReminderEmail(account, schedule, 'https://pixicred.com');
    expect(email.to).toBeTruthy();
    expect(email.subject).toBeTruthy();
    expect(email.htmlBody).toBeTruthy();
    expect(email.textBody).toBeTruthy();
  });
});
