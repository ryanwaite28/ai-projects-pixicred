import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildChargePostedEmail } from '../../src/emails/charge-posted.template';
import type { Transaction, Account } from '../../src/types/index';

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 700,
  availableCredit: 6800,
  status: 'ACTIVE',
  paymentDueDate: '2026-06-25',
  closeReason: null,
  closedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  cardNumber: '1234567890123456',
  cardExpiry: '2029-06-01',
  cardCvv: '123',
};

const transaction: Transaction = {
  transactionId: '00000000-0000-4000-8000-000000000003',
  accountId: account.accountId,
  type: 'CHARGE',
  merchantName: 'Whole Foods',
  amount: 85.50,
  idempotencyKey: '00000000-0000-4000-8000-000000000004',
  status: 'POSTED',
  statusUpdatedAt: new Date('2026-05-11T08:00:00Z'),
  notes: null,
  createdAt: new Date('2026-05-10T14:00:00Z'),
};

beforeEach(() => { process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com'; });
afterEach(() => { delete process.env['SES_FROM_EMAIL']; });

describe('buildChargePostedEmail', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildChargePostedEmail(transaction, account, 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject contains "Posted" and merchant name', () => {
    const email = buildChargePostedEmail(transaction, account, 'https://pixicred.com');
    expect(email.subject).toContain('Posted');
    expect(email.subject).toContain('Whole Foods');
  });

  it('body includes transaction amount', () => {
    const email = buildChargePostedEmail(transaction, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/85/);
  });

  it('body includes merchant name', () => {
    const email = buildChargePostedEmail(transaction, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toContain('Whole Foods');
  });

  it('body includes both transaction date and posted date', () => {
    const email = buildChargePostedEmail(transaction, account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/May 10/);
    expect(body).toMatch(/May 11/);
  });
});
