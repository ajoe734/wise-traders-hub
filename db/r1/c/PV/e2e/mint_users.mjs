// PV-E2E — create the four synthetic identities through the REAL GoTrue HTTP
// API (no direct auth.users INSERT), then print `email uuid` per line.
// Usage: node mint_users.mjs <authBase> <anonKey>
const [, , BASE, KEY] = process.argv;
const USERS = [
  ['pve-alpha@pve.local', 'PveAlpha!2026'],
  ['pve-beta@pve.local', 'PveBeta!2026'],
  ['pve-admin@pve.local', 'PveAdmin!2026'],
  ['pve-member@pve.local', 'PveMember!2026'],
];

for (const [email, password] of USERS) {
  const r = await fetch(`${BASE}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY, authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  const id = j.id || j.user?.id;
  if (!r.ok || !id) { console.error(`FAIL ${email} ${r.status} ${JSON.stringify(j)}`); process.exit(1); }
  console.log(`${email} ${id}`);
}
