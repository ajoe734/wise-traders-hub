
UPDATE auth.users
SET encrypted_password = crypt('Mentor2026!', gen_salt('bf')),
    updated_at = now()
WHERE id IN (
  '66905de9-0d81-4ad3-8311-04877ec672e0',
  '76cc078d-5ae7-48ee-8efd-79fd5b8fad2e',
  '60287045-3363-4f11-aff5-e17f0b850691',
  'd84454e0-06fc-4d71-8d91-8c7634e843f4',
  'd8fa2533-a929-4027-aede-bcc12df8c21e'
);
