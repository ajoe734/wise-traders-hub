// One-off: reset 5 mentor passwords to a unified initial password.
// Run: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/reset-mentor-passwords.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const PASSWORD = 'Mentor2026!';
const TARGETS = [
  { id: '66905de9-0d81-4ad3-8311-04877ec672e0', email: 'sean.17371@gmail.com' },
  { id: '76cc078d-5ae7-48ee-8efd-79fd5b8fad2e', email: '888666crypto@gmail.com' },
  { id: '60287045-3363-4f11-aff5-e17f0b850691', email: 'q0985956958@gmail.com' },
  { id: 'd84454e0-06fc-4d71-8d91-8c7634e843f4', email: 'aa7545aa@gmail.com' },
  { id: 'd8fa2533-a929-4027-aede-bcc12df8c21e', email: '8999.penguin@gmail.com' },
];

const sb = createClient(url, key, { auth: { persistSession: false } });
for (const t of TARGETS) {
  const { error } = await sb.auth.admin.updateUserById(t.id, { password: PASSWORD });
  console.log(error ? `✗ ${t.email}: ${error.message}` : `✓ ${t.email} 密碼已重設`);
}
