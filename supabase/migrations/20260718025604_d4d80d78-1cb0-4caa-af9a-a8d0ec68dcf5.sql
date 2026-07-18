
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS download_url text;

-- 回填：舊資料把 http(s):// 開頭的 link 搬到 download_url，link 改為對應內部路徑
UPDATE public.notifications
SET download_url = link,
    link = CASE WHEN type = 'journal_export' THEN '/company/journals-export' ELSE NULL END
WHERE link ~* '^https?://'
  AND download_url IS NULL;
