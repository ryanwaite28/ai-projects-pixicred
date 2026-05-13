import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestPrisma, cleanTables } from './helpers';
import {
  createApplication,
  getApplicationById,
  getActiveApplicationOrAccountByEmail,
  updateApplicationStatus,
} from '../../src/db/queries/application.queries';

const prisma = createTestPrisma();

afterAll(() => prisma.$disconnect());
beforeEach(() => cleanTables(prisma));

const baseInput = {
  email: 'test@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  dateOfBirth: '1990-01-15',
  annualIncome: 60000,
  mockSsn: '12345',
};

describe('createApplication', () => {
  it('creates an application with PENDING status', async () => {
    const app = await createApplication(prisma, baseInput);
    expect(app.status).toBe('PENDING');
    expect(app.email).toBe(baseInput.email);
    expect(app.firstName).toBe(baseInput.firstName);
    expect(app.lastName).toBe(baseInput.lastName);
    expect(app.dateOfBirth).toBe(baseInput.dateOfBirth);
    expect(app.annualIncome).toBe(baseInput.annualIncome);
    expect(app.mockSsn).toBe(baseInput.mockSsn);
    expect(app.applicationId).toBeTruthy();
    expect(app.decidedAt).toBeNull();
    expect(app.creditLimit).toBeNull();
  });

  it('returns an object matching the Application shape', async () => {
    const app = await createApplication(prisma, baseInput);
    expect(typeof app.applicationId).toBe('string');
    expect(typeof app.email).toBe('string');
    expect(app.createdAt).toBeInstanceOf(Date);
  });
});

describe('getApplicationById', () => {
  it('returns the application when it exists', async () => {
    const created = await createApplication(prisma, baseInput);
    const found = await getApplicationById(prisma, created.applicationId);
    expect(found).not.toBeNull();
    expect(found!.applicationId).toBe(created.applicationId);
  });

  it('returns null for unknown id', async () => {
    const result = await getApplicationById(prisma, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

describe('getActiveApplicationOrAccountByEmail', () => {
  it('returns application record for PENDING application', async () => {
    await createApplication(prisma, baseInput);
    const result = await getActiveApplicationOrAccountByEmail(prisma, baseInput.email);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('application');
    expect(result!.status).toBe('PENDING');
  });

  it('returns null when no active application or account', async () => {
    const result = await getActiveApplicationOrAccountByEmail(prisma, 'nobody@example.com');
    expect(result).toBeNull();
  });

  it('returns null for DECLINED application', async () => {
    const app = await createApplication(prisma, baseInput);
    await updateApplicationStatus(prisma, app.applicationId, 'DECLINED');
    const result = await getActiveApplicationOrAccountByEmail(prisma, baseInput.email);
    expect(result).toBeNull();
  });

  it('returns application record for APPROVED application', async () => {
    const app = await createApplication(prisma, baseInput);
    await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 5000);
    const result = await getActiveApplicationOrAccountByEmail(prisma, baseInput.email);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('application');
    expect(result!.status).toBe('APPROVED');
  });
});

describe('updateApplicationStatus', () => {
  it('sets status to DECLINED and records decidedAt', async () => {
    const app = await createApplication(prisma, baseInput);
    const updated = await updateApplicationStatus(prisma, app.applicationId, 'DECLINED');
    expect(updated.status).toBe('DECLINED');
    expect(updated.decidedAt).toBeInstanceOf(Date);
    expect(updated.creditLimit).toBeNull();
  });

  it('sets status to APPROVED with creditLimit', async () => {
    const app = await createApplication(prisma, baseInput);
    const updated = await updateApplicationStatus(prisma, app.applicationId, 'APPROVED', 7500);
    expect(updated.status).toBe('APPROVED');
    expect(updated.creditLimit).toBe(7500);
    expect(updated.decidedAt).toBeInstanceOf(Date);
  });

  it('does not set creditLimit when not provided', async () => {
    const app = await createApplication(prisma, baseInput);
    const updated = await updateApplicationStatus(prisma, app.applicationId, 'DECLINED');
    expect(updated.creditLimit).toBeNull();
  });
});
