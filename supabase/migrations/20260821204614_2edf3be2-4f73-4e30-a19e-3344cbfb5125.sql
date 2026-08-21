CREATE OR REPLACE FUNCTION public.sample_normalize_text(_html text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  t text := coalesce(_html, '');
BEGIN
  t := regexp_replace(t, '<\s*br\s*/?\s*>', E'\n', 'gi');
  t := regexp_replace(t, '<\s*/\s*(p|div|li|ul|ol|h[1-6]|tr|table|blockquote|section|article)\s*>', E'\n', 'gi');
  t := regexp_replace(t, '<\s*(li|p|div|h[1-6]|tr|blockquote|section|article)(\s[^>]*)?>', E'\n', 'gi');
  t := regexp_replace(t, '<[^>]*>', '', 'g');
  t := replace(t, '&nbsp;', ' ');
  t := replace(t, '&amp;', '&');
  t := replace(t, '&lt;', '<');
  t := replace(t, '&gt;', '>');
  t := replace(t, '&quot;', '"');
  t := replace(t, '&#39;', '''');
  t := replace(t, '&apos;', '''');
  t := regexp_replace(t, '[ \t\r]+', ' ', 'g');
  t := regexp_replace(t, ' *\n *', E'\n', 'g');
  t := regexp_replace(t, '\n{3,}', E'\n\n', 'g');
  RETURN pg_catalog.btrim(t, E' \t\r\n');
END;
$$;

REVOKE ALL ON FUNCTION public.sample_normalize_text(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sample_normalize_text(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_normalize_text(text) TO service_role;