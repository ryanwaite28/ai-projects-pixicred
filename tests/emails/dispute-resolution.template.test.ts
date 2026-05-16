import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildDisputeResolutionEmail } from '../../src/emails/dispute-resolution.template';
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
  status: 'DISPUTE_ACCEPTED',
  statusUpdatedAt: new Date('2026-05-14T10:00:00Z'),
  notes: null,
  createdAt: new Date('2026-05-10T14:00:00Z'),
};

beforeEach(() => { process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com'; });
afterEach(() => { delete process.env['SES_FROM_EMAIL']; });

describe('buildDisputeResolutionEmail — DISPUTE_ACCEPTED', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_ACCEPTED', 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject contains "Accepted" and merchant name', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_ACCEPTED', 'https://pixicred.com');
    expect(email.subject).toContain('Accepted');
    expect(email.subject).toContain('Best Buy');
  });

  it('body contains accepted messaging', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_ACCEPTED', 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/accepted/i);
  });

  it('body includes amount', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_ACCEPTED', 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/299/);
  });

  it('body includes abbreviated transaction ID', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_ACCEPTED', 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toContain('abcdef12...');
  });
});

describe('buildDisputeResolutionEmail — DISPUTE_DENIED', () => {
  it('subject contains "Denied" and merchant name', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_DENIED', 'https://pixicred.com');
    expect(email.subject).toContain('Denied');
    expect(email.subject).toContain('Best Buy');
  });

  it('body contains denied messaging', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_DENIED', 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/denied/i);
  });

  it('body does not contain accepted messaging for DENIED outcome', () => {
    const email = buildDisputeResolutionEmail(transaction, account, 'DISPUTE_DENIED', 'https://pixicred.com');
    expect(email.htmlBody).not.toContain('credit will be applied');
  });
});
