import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildDisputeConfirmationEmail } from '../../src/emails/dispute-confirmation.template';
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
  transactionId: 'abcdef12-0000-4000-8000-000000000003',
  accountId: account.accountId,
  type: 'CHARGE',
  merchantName: 'Best Buy',
  amount: 299,
  idempotencyKey: '00000000-0000-4000-8000-000000000004',
  status: 'DISPUTED',
  statusUpdatedAt: new Date('2026-05-12T09:00:00Z'),
  notes: null,
  createdAt: new Date('2026-05-10T14:00:00Z'),
};

beforeEach(() => { process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com'; });
afterEach(() => { delete process.env['SES_FROM_EMAIL']; });

describe('buildDisputeConfirmationEmail', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildDisputeConfirmationEmail(transaction, account, 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject contains "Dispute Received" and merchant name', () => {
    const email = buildDisputeConfirmationEmail(transaction, account, 'https://pixicred.com');
    expect(email.subject).toContain('Dispute Received');
    expect(email.subject).toContain('Best Buy');
  });

  it('body includes amount', () => {
    const email = buildDisputeConfirmationEmail(transaction, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/299/);
  });

  it('body includes abbreviated transaction ID', () => {
    const email = buildDisputeConfirmationEmail(transaction, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toContain('abcdef12...');
  });

  it('body includes merchant name', () => {
    const email = buildDisputeConfirmationEmail(transaction, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toContain('Best Buy');
  });
});
