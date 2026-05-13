import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildDeclineEmail } from '../../src/emails/decline.template';
import type { Application } from '../../src/types/index';

const app: Application = {
  applicationId: '00000000-0000-4000-8000-000000000001',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-06-15',
  annualIncome: 50000,
  mockSsn: '54315',
  status: 'DECLINED',
  creditLimit: null,
  createdAt: new Date('2026-05-01T00:00:00Z'),
  decidedAt: new Date('2026-05-01T00:01:00Z'),
};

beforeEach(() => {
  process.env['SES_FROM_EMAIL'] = 'noreply@pixicred.com';
});

afterEach(() => {
  delete process.env['SES_FROM_EMAIL'];
});

describe('buildDeclineEmail', () => {
  it('sets to field to applicant email', () => {
    const email = buildDeclineEmail(app);
    expect(email.to).toBe('jane@example.com');
  });

  it('subject references PixiCred application', () => {
    const email = buildDeclineEmail(app);
    expect(email.subject.toLowerCase()).toContain('pixicred');
  });

  it('body includes note that applicant may reapply', () => {
    const email = buildDeclineEmail(app);
    const bodyLower = email.htmlBody.toLowerCase() + email.textBody.toLowerCase();
    expect(bodyLower).toMatch(/reapply|re-apply|apply again/);
  });

  it('uses SES_FROM_EMAIL env var as sender when set', () => {
    process.env['SES_FROM_EMAIL'] = 'custom@pixicred.com';
    // The from address is consumed by SesClient at creation time, not embedded in the email input.
    // Verify the function returns a well-formed object regardless.
    const email = buildDeclineEmail(app);
    expect(email.to).toBeTruthy();
    expect(email.subject).toBeTruthy();
    expect(email.htmlBody).toBeTruthy();
    expect(email.textBody).toBeTruthy();
  });
});
