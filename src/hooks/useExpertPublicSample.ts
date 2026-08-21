import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PublicSampleSection {
  key: string;
  label: string;
  text: string;
  truncated?: boolean;
}

export interface PublicSample {
  expertName: string;
  expertSlug: string;
  weekStart: string;
  sections: PublicSampleSection[];
  maskLevel: string;
  updatedAt: string;
}

/** 公開頁：讀取該老師唯一一筆已核准的週記範例（無則 null）。 */
export function useExpertPublicSample(slug?: string) {
  return useQuery<PublicSample | null>({
    queryKey: ['expert-public-sample', slug],
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_expert_public_sample', { _slug: slug! });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;
      const sections = Array.isArray(row.sections)
        ? (row.sections as unknown as PublicSampleSection[]).filter((s) => s && s.text)
        : [];
      if (sections.length === 0) return null;
      return {
        expertName: row.expert_name,
        expertSlug: row.expert_slug,
        weekStart: row.week_start_taipei,
        sections,
        maskLevel: row.mask_level,
        updatedAt: row.updated_at,
      };
    },
  });
}
