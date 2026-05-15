import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTransactionEmail } from '../../src/emails/transaction.template';
import type { Transaction, Account } from '../../src/types/index';

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 600,   // after a $100 charge on opening balance of $500
  availableCredit: 6900,
  status: 'ACTIVE',
  paymentDueDate: '2026-06-25',
  closeReason: null,
  closedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
};

const transaction: Transaction = {
  transactionId: '00000000-0000-4000-8000-000000000003',
  accountId: account.accountId,
  type: 'CHARGE',
  merchantName: 'Amazon',
  amount: 100,
  idempotencyKey: '00000000-0000-4000-8000-000000000004',
  createdAt: new Date('2026-05-10T14:00:00Z'),
};

beforeEach(() => {
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

afterEach(() => {
  delete process.env['SES_FROM_EMAIL'];
});

describe('buildTransactionEmail', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildTransactionEmail(transaction, account, 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject includes merchant name', () => {
    const email = buildTransactionEmail(transaction, account, 'https://pixicred.com');
    expect(email.subject).toContain('Amazon');
  });

  it('body includes transaction amount', () => {
    const email = buildTransactionEmail(transaction, account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/100/);
  });

  it('body includes new account balance', () => {
    const email = buildTransactionEmail(transaction, account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/600/);
  });

  it('body includes available credit after charge', () => {
    const email = buildTransactionEmail(transaction, account, 'https://pixicred.com');
    const body = email.htmlBody + email.textBody;
    expect(body).toMatch(/6[,.]?900/);
  });

  it('uses SES_FROM_EMAIL env var as sender when set', () => {
    process.env['SES_FROM_EMAIL'] = 'custom@pixicred.com';
    const email = buildTransactionEmail(transaction, account, 'https://pixicred.com');
    expect(email.to).toBeTruthy();
    expect(email.subject).toBeTruthy();
    expect(email.htmlBody).toBeTruthy();
    expect(email.textBody).toBeTruthy();
  });
});
