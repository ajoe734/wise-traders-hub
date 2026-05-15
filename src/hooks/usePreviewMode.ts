import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'previewExpertSlug';

export function getPreviewSlug(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setPreviewSlug(slug: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (slug) sessionStorage.setItem(STORAGE_KEY, slug);
    else sessionStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('preview-mode-change'));
  } catch {
    // ignore
  }
}

/**
 * 預覽模式：分析師／公司管理員以「該 expert 已訂閱使用者」身分檢視 App。
 * 回傳 { isPreview, previewSlug, previewExpertId, previewExpertName, previewExpertRole, exitPreview }
 *
 * 安全：必須是該 expert owner 或 company_admin 才生效，否則 isPreview=false。
 * 僅 UI 解鎖，不寫 DB、不影響真實訂閱。
 */
export function usePreviewMode() {
  const { user, hasRole } = useAuth();
  const [previewSlug, setSlug] = useState<string | null>(() => getPreviewSlug());

  useEffect(() => {
    const handler = () => setSlug(getPreviewSlug());
    window.addEventListener('preview-mode-change', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('preview-mode-change', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const allowed = !!previewSlug && !!user && (
    user.expertSlug === previewSlug || hasRole('company_admin')
  );

  const { data: expert } = useQuery({
    queryKey: ['preview-expert', previewSlug],
    queryFn: async () => {
      if (!previewSlug) return null;
      const { data } = await supabase
        .from('experts')
        .select('id, name, role, slug')
        .eq('slug', previewSlug)
        .maybeSingle();
      return data;
    },
    enabled: !!previewSlug && allowed,
    staleTime: 5 * 60 * 1000,
  });

  const isPreview = allowed && !!expert;

  return {
    isPreview,
    previewSlug: isPreview ? previewSlug : null,
    previewExpertId: isPreview ? expert?.id ?? null : null,
    previewExpertName: isPreview ? expert?.name ?? null : null,
    previewExpertRole: isPreview ? (expert?.role as 'advisor' | 'mentor' | undefined) ?? null : null,
    exitPreview: () => setPreviewSlug(null),
  };
}
