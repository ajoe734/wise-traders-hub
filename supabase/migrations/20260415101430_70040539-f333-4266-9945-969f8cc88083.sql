
ALTER TABLE profiles DISABLE TRIGGER trg_protect_profile_fields;
UPDATE profiles SET is_tester = true WHERE user_id = 'c97dcc85-1d89-4ecb-b890-0be26dd3df4f';
ALTER TABLE profiles ENABLE TRIGGER trg_protect_profile_fields;
