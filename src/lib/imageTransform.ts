/**
 * Supabase Storage Image Transformation helper.
 *
 * 把 `/storage/v1/object/public/...` 換成 `/render/image/public/...` 並加上
 * `width / quality / resize=cover` 參數，由 Supabase 在 CDN 邊緣完成縮圖，
 * 避免前端把 1～3MB 原圖整張下載。
 *
 * 對非 Supabase Storage public URL（例如 placeholder、外部 CDN）原樣回傳。
 */
export function avatarUrl(url?: string | null, size = 160): string {
  if (!url) return '/placeholder.svg';
  if (!url.includes('/storage/v1/object/public/')) return url;
  const transformed = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const sep = transformed.includes('?') ? '&' : '?';
  return `${transformed}${sep}width=${size}&quality=75&resize=cover`;
}
