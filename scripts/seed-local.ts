/**
 * Inserts a known application into the local database to bootstrap a demo session.
 * Run with: npx tsx scripts/seed-local.ts
 *
 * The script submits an application via the API (must be running at API_URL) and
 * waits for the credit-check worker to process it. After the account is created,
 * it prints the applicationId and accountId for use in manual testing.
 */

const API_URL = process.env['API_URL'] ?? 'http://localhost:3000';
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (json.error) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  const json = (await res.json()) as ApiResponse<T>;
  if (json.error) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data as T;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('Seeding local demo data...');

  const application = await post<{ applicationId: string }>('/applications', {
    email: 'demo@pixicred.local',
    firstName: 'Demo',
    lastName: 'User',
    dateOfBirth: '1990-01-15',
    annualIncome: 60000,
    mockSsn: '12345',
  });

  const { applicationId } = application;
  console.log(`Application submitted: ${applicationId}`);
  console.log('Waiting for credit check to complete...');

  let accountId: string | null = null;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const app = await get<{ status: string; accountId?: string }>(`/applications/${applicationId}`);

    if (app.status === 'APPROVED' && app.accountId) {
      accountId = app.accountId;
      break;
    }

    if (app.status === 'DECLINED') {
      console.error('Application declined — use a mockSsn that does not start and end with 5');
      process.exit(1);
    }

    process.stdout.write('.');
  }

  console.log();

  if (!accountId) {
    console.error('Timed out waiting for credit check. Ensure the local worker is running.');
    process.exit(1);
  }

  console.log('\n--- Seed complete ---');
  console.log(`Application ID : ${applicationId}`);
  console.log(`Account ID     : ${accountId}`);
  console.log('\nNext: register a portal account with:');
  console.log(`  POST ${API_URL}/auth/register`);
  console.log(`  { "email": "demo@pixicred.local", "accountId": "${accountId}", "password": "password123" }`);
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
