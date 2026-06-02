import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/auditLog';
import { useSessionString, useSessionBool, useSessionNullable } from '@/hooks/useSessionState';

interface ExpertLike { id: string; name: string }
interface LineChannel {
  id: string;
  channel_id: string;
  channel_access_token: string;
  channel_name: string | null;
  line_oa_id: string | null;
  qr_code_url: string | null;
  is_active: boolean;
}

export function useLineChannelEditor() {
  const [lineExpertId, setLineExpertId] = useSessionNullable('company_line_expert_id');
  const [lineExpertName, setLineExpertName] = useSessionString('cl_name');
  const [lineChannel, setLineChannel] = useState<LineChannel | null>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineChannelId, setLineChannelId] = useSessionString('cl_channelId');
  const [lineToken, setLineToken] = useSessionString('cl_token');
  const [lineChannelName, setLineChannelName] = useSessionString('cl_channelName');
  const [lineOaId, setLineOaId] = useSessionString('cl_oaId');
  const [lineQrCodeUrl, setLineQrCodeUrl] = useSessionString('cl_qrCode');
  const [lineActive, setLineActive] = useSessionBool('cl_active', true);
  const [savingLine, setSavingLine] = useState(false);
  const [lineBindingsCount, setLineBindingsCount] = useState(0);

  const clearLineForm = () => {
    setLineChannel(null);
    setLineChannelId('');
    setLineToken('');
    setLineChannelName('');
    setLineOaId('');
    setLineQrCodeUrl('');
    setLineActive(true);
    setLineBindingsCount(0);
    ['cl_channelId','cl_token','cl_channelName','cl_oaId','cl_qrCode','cl_active'].forEach(k => sessionStorage.removeItem(k));
  };

  // Restore dialog title once experts are loaded
  const restoreTitle = (experts: any[]) => {
    if (lineExpertId && experts.length > 0 && !lineExpertName) {
      const exp = experts.find(e => e.id === lineExpertId);
      if (exp) setLineExpertName(exp.name);
    }
  };

  const openLineSettings = (expert: ExpertLike) => {
    clearLineForm();
    setLineExpertId(expert.id);
    setLineExpertName(expert.name);
    setLineLoading(true);
    (async () => {
      const { data: ch } = await supabase
        .from('expert_line_channels')
        .select('*')
        .eq('expert_id', expert.id)
        .single();
      if (ch) {
        setLineChannel(ch as LineChannel);
        setLineChannelId(ch.channel_id);
        setLineToken(ch.channel_access_token);
        setLineChannelName(ch.channel_name || '');
        setLineOaId(ch.line_oa_id || '');
        setLineQrCodeUrl(ch.qr_code_url || '');
        setLineActive(ch.is_active);
      }
      const { count } = await supabase
        .from('member_line_bindings_analyst')
        .select('id', { count: 'exact', head: true })
        .eq('expert_id', expert.id)
        .eq('is_active', true);
      setLineBindingsCount(count || 0);
      setLineLoading(false);
    })();
  };

  const closeLineSettings = () => {
    setLineExpertId(null);
    setLineExpertName('');
    setLineChannel(null);
    clearLineForm();
  };

  const handleSaveLine = async () => {
    if (!lineExpertId || !lineChannelId || !lineToken) {
      toast.error('請填寫 Channel ID 和 Access Token');
      return;
    }
    setSavingLine(true);
    if (lineChannel) {
      const { error } = await supabase
        .from('expert_line_channels')
        .update({
          channel_id: lineChannelId,
          channel_access_token: lineToken,
          channel_name: lineChannelName || null,
          line_oa_id: lineOaId || null,
          qr_code_url: lineQrCodeUrl || null,
          is_active: lineActive,
        })
        .eq('id', lineChannel.id);
      if (error) { toast.error('更新失敗'); setSavingLine(false); return; }
      await logAdminAction({
        action: 'analyst.line_channel_update',
        targetType: 'expert_line_channels',
        targetId: lineChannel.id,
        detail: {
          before: { channel_id: lineChannel.channel_id, is_active: lineChannel.is_active, channel_name: lineChannel.channel_name },
          after: { channel_id: lineChannelId, is_active: lineActive, channel_name: lineChannelName || null },
          context: { expert_id: lineExpertId, expert_name: lineExpertName },
        },
      });
      toast.success('LINE 設定已更新');
    } else {
      const { data: inserted, error } = await supabase
        .from('expert_line_channels')
        .insert({
          expert_id: lineExpertId,
          channel_id: lineChannelId,
          channel_access_token: lineToken,
          channel_name: lineChannelName || null,
          line_oa_id: lineOaId || null,
          qr_code_url: lineQrCodeUrl || null,
          is_active: lineActive,
        })
        .select('id')
        .single();
      if (error) { toast.error('建立失敗'); setSavingLine(false); return; }
      await logAdminAction({
        action: 'analyst.line_channel_create',
        targetType: 'expert_line_channels',
        targetId: inserted?.id ?? null,
        detail: {
          after: { channel_id: lineChannelId, is_active: lineActive, channel_name: lineChannelName || null },
          context: { expert_id: lineExpertId, expert_name: lineExpertName },
        },
      });
      toast.success('LINE 設定已儲存');
    }
    setSavingLine(false);
    closeLineSettings();
  };

  return {
    lineExpertId, lineExpertName,
    lineChannel, lineLoading, savingLine, lineBindingsCount,
    lineChannelId, setLineChannelId,
    lineToken, setLineToken,
    lineChannelName, setLineChannelName,
    lineOaId, setLineOaId,
    lineQrCodeUrl, setLineQrCodeUrl,
    lineActive, setLineActive,
    openLineSettings, closeLineSettings, handleSaveLine,
    restoreTitle,
  };
}
