import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildChargeCreatedEmail } from '../../src/emails/charge-created.template';
import type { Transaction, Account } from '../../src/types/index';

const account: Account = {
  accountId: '00000000-0000-4000-8000-000000000002',
  applicationId: '00000000-0000-4000-8000-000000000001',
  holderEmail: 'jane@example.com',
  creditLimit: 7500,
  currentBalance: 600,
  availableCredit: 6900,
  status: 'ACTIVE',
  paymentDueDate: '2026-06-25',
  closeReason: null,
  closedAt: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  cardNumber: '1234567890123456',
  cardExpiry: '2029-06-01',
  cardCvv: '123',
};

const processingTxn: Transaction = {
  transactionId: '00000000-0000-4000-8000-000000000003',
  accountId: account.accountId,
  type: 'CHARGE',
  merchantName: 'Amazon',
  amount: 100,
  idempotencyKey: '00000000-0000-4000-8000-000000000004',
  status: 'PROCESSING',
  statusUpdatedAt: new Date('2026-05-10T14:00:00Z'),
  notes: null,
  createdAt: new Date('2026-05-10T14:00:00Z'),
};

const deniedTxn: Transaction = { ...processingTxn, status: 'DENIED' };

beforeEach(() => { process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com'; });
afterEach(() => { delete process.env['SES_FROM_EMAIL']; });

describe('buildChargeCreatedEmail — PROCESSING', () => {
  it('sets to field to account holderEmail', () => {
    const email = buildChargeCreatedEmail(processingTxn, account, 'https://pixicred.com');
    expect(email.to).toBe('jane@example.com');
  });

  it('subject contains "Processing" and merchant name', () => {
    const email = buildChargeCreatedEmail(processingTxn, account, 'https://pixicred.com');
    expect(email.subject).toContain('Processing');
    expect(email.subject).toContain('Amazon');
  });

  it('body includes amount', () => {
    const email = buildChargeCreatedEmail(processingTxn, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/100/);
  });

  it('body includes available credit', () => {
    const email = buildChargeCreatedEmail(processingTxn, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/6[,.]?900/);
  });

  it('body does not contain "Denied" messaging for PROCESSING', () => {
    const email = buildChargeCreatedEmail(processingTxn, account, 'https://pixicred.com');
    expect(email.htmlBody).not.toContain('denied due to insufficient');
  });
});

describe('buildChargeCreatedEmail — DENIED', () => {
  it('subject contains "Denied" and merchant name', () => {
    const email = buildChargeCreatedEmail(deniedTxn, account, 'https://pixicred.com');
    expect(email.subject).toContain('Denied');
    expect(email.subject).toContain('Amazon');
  });

  it('body contains denied messaging', () => {
    const email = buildChargeCreatedEmail(deniedTxn, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/denied/i);
  });

  it('body includes amount', () => {
    const email = buildChargeCreatedEmail(deniedTxn, account, 'https://pixicred.com');
    expect(email.htmlBody + email.textBody).toMatch(/100/);
  });
});
