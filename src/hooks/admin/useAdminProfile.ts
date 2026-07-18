import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useExpertPerformance } from '@/hooks/usePerformance';
import { toast } from 'sonner';

export interface ExpertProfilePayload {
  name: string;
  bio: string;
  description: string;
  strategy_summary: string;
  strategy_name: string | null;
  risk_preference: string | null;
  operation_cycle: string | null;
  style_tags: string[];
  markets: string[];
  currency?: 'TWD' | 'USD';
  asset_class?: 'tw_stock' | 'us_stock' | 'crypto';
}

export interface CapitalStatus {
  available_cash: number;
  open_cost_value: number;
  realized_pnl_amount: number;
}

/**
 * 集中管理 admin/Profile 頁所需的 query / mutation：
 * - expert 主資料（含 staleTime 30s）
 * - 起始資金狀態 RPC
 * - 績效 KPI（穿透 useExpertPerformance）
 * - saveProfile / setStartingCapital / uploadAvatar 三個 mutation
 *
 * 元件層只負責表單狀態與呈現，所有 supabase 直查全收斂到此 hook。
 */
export function useAdminProfile(expertSlug: string | undefined, opts?: {
  isOwner: boolean;
  isCompanyAdmin: boolean;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const expertQueryKey = ['admin', 'profile', expertSlug] as const;

  const { data: expert, isLoading } = useQuery({
    queryKey: expertQueryKey,
    enabled: !!expertSlug,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('experts')
        .select('*')
        .eq('slug', expertSlug!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const capitalStatusKey = ['admin', 'profile', 'capital-status', expert?.id] as const;
  const { data: capitalStatus } = useQuery({
    queryKey: capitalStatusKey,
    enabled: !!expert?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'get_expert_capital_status' as any,
        { _expert_id: expert!.id }
      );
      if (error) throw error;
      return data as CapitalStatus | null;
    },
  });

  const { data: perf } = useExpertPerformance(expert?.id);

  const saveProfile = useMutation({
    mutationFn: async (payload: ExpertProfilePayload) => {
      if (!expert) throw new Error('expert 未載入');
      const { error } = await supabase
        .from('experts')
        .update(payload as any)
        .eq('id', expert.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('已儲存');
      queryClient.invalidateQueries({ queryKey: expertQueryKey });
      // asset_class / currency 變更會影響 SignalCreateDialog、CapitalPanel、TradeCard、
      // 這些下游從 useAdminSignals / useExpertHoldingsBundle / useSignalEditorData 拿 expert，
      // 若不一併 invalidate，切到訊號頁仍會拿到 30s 內的舊快取（表面像「後台不支援美股」）。
      queryClient.invalidateQueries({ queryKey: ['admin-signals-bundle', expertSlug] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'signal-editor', expertSlug] });
      if (expert?.id) {
        queryClient.invalidateQueries({ queryKey: ['expert-holdings-bundle', expert.id] });
      }
    },
    onError: (e: any) => {
      toast.error('儲存失敗：' + (e?.message || '未知錯誤'));
    },
  });

  const setStartingCapital = useMutation({
    mutationFn: async (amount: number) => {
      if (!expert) throw new Error('expert 未載入');
      const { error } = await supabase
        .from('experts')
        .update({ starting_capital: amount } as any)
        .eq('id', expert.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('起始資金已設定');
      queryClient.invalidateQueries({ queryKey: expertQueryKey });
      if (expert?.id) {
        queryClient.invalidateQueries({
          queryKey: ['admin', 'profile', 'capital-status', expert.id],
        });
      }
    },
    onError: (e: any) => {
      toast.error('設定失敗：' + (e?.message || '未知錯誤'));
    },
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      if (!expert || !opts?.currentUserId) throw new Error('expert/user 未載入');
      if (!file.type.startsWith('image/')) throw new Error('請選擇圖片檔案');
      if (file.size > 5 * 1024 * 1024) throw new Error('檔案大小不可超過 5MB');

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      // 路徑第一層必須符合 Storage RLS：
      // - 本人編輯 → 自己 uid
      // - company_admin 代編輯他人 → 該 expert 的 user_id（admin policy 允許）
      const folderUid =
        !opts.isOwner && opts.isCompanyAdmin && (expert as any).user_id
          ? (expert as any).user_id
          : opts.currentUserId;
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${folderUid}/avatar-${Date.now()}-${rand}.${ext}`;

      // 唯一檔名 → 不需要 upsert，避免觸發 update 路徑的 RLS
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) throw new Error('上傳檔案失敗：' + uploadError.message);

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const newAvatarUrl = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from('experts')
        .update({ avatar_url: newAvatarUrl })
        .eq('id', expert.id);
      if (updateError) throw new Error('更新頭像失敗：' + updateError.message);

      // best-effort：刪除舊檔（失敗不影響流程）
      const oldUrl: string | undefined = (expert as any).avatar_url;
      if (oldUrl && oldUrl.includes('/avatars/')) {
        try {
          const oldPath = oldUrl.split('/avatars/')[1]?.split('?')[0];
          if (oldPath && oldPath !== path) {
            await supabase.storage.from('avatars').remove([oldPath]);
          }
        } catch {
          /* ignore */
        }
      }
      return newAvatarUrl;
    },
    onSuccess: () => {
      toast.success('頭像已更新');
      queryClient.invalidateQueries({ queryKey: expertQueryKey });
    },
    onError: (e: any) => {
      toast.error(e?.message || '頭像更新失敗');
    },
  });

  return {
    expert,
    isLoading,
    capitalStatus,
    perf,
    saveProfile,
    setStartingCapital,
    uploadAvatar,
  };
}
