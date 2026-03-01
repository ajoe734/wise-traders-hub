import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, Copy, Check, RefreshCw, Unlink, ExternalLink, QrCode } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

interface LineBindingCardProps {
  expertId: string;
  expertSlug: string;
  expertName?: string;
  expertAvatarUrl?: string;
  lineOaId?: string;
  lineChannelName?: string;
  qrCodeUrl?: string;
  isAdvisor?: boolean;
  compact?: boolean;
  isSubscribed?: boolean;
}

export const LineBindingCard = ({ expertId, expertSlug, expertName, expertAvatarUrl, lineOaId, lineChannelName, qrCodeUrl, isAdvisor = false, compact = false, isSubscribed = true }: LineBindingCardProps) => {
  const { user } = useAuth();
  const [binding, setBinding] = useState<any>(null);
  const [bindingCode, setBindingCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  // Fetch existing binding
  useEffect(() => {
    if (!user?.id || !expertId) return;

    const fetchBinding = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('member_line_bindings')
        .select('*')
        .eq('user_id', user.id)
        .eq('expert_id', expertId)
        .eq('is_active', true)
        .maybeSingle();

      setBinding(data);
      setLoading(false);
    };

    fetchBinding();

    // Subscribe to realtime changes for binding updates
    const channel = supabase
      .channel(`line-binding-${expertId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'member_line_bindings',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        fetchBinding();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, expertId]);

  const generateCode = async () => {
    if (!user?.id || !expertId) return;
    setGenerating(true);

    try {
      // Generate a 6-char alphanumeric code
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

      const { error } = await supabase
        .from('line_binding_codes')
        .insert({
          user_id: user.id,
          expert_id: expertId,
          code,
          expires_at: expiresAt,
        });

      if (error) throw error;

      setBindingCode(code);
      setCodeExpiresAt(expiresAt);
    } catch (err: any) {
      console.error('Generate code error:', err);
      toast({
        title: '生成驗證碼失敗',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = async () => {
    if (!bindingCode) return;
    await navigator.clipboard.writeText(bindingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: '已複製驗證碼' });
  };

  const handleUnbind = async () => {
    if (!binding) return;
    setUnbinding(true);
    try {
      await supabase
        .from('member_line_bindings')
        .update({ is_active: false })
        .eq('id', binding.id);

      setBinding(null);
      toast({ title: '已解除 LINE 綁定' });
    } catch (err: any) {
      toast({ title: '解除綁定失敗', variant: 'destructive' });
    } finally {
      setUnbinding(false);
    }
  };

  const accentColor = isAdvisor ? 'advisor' : 'mentor';

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="animate-pulse h-16 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  // Compact mode: show summary + "查看" button
  if (compact) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">LINE 綁定 — {expertName}</span>
            {binding && (
              <Badge variant="secondary" className="text-xs">
                <Check className="h-3 w-3 mr-1" />已綁定
              </Badge>
            )}
          </div>
          <Button variant={isAdvisor ? 'advisor' : 'mentor'} className="w-full" asChild>
            <Link to={`/line/${expertSlug}/account`}>
              查看
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Already bound
  if (binding) {
    return (
      <Card className="border-green-500/30 dark:border-green-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-3">
            {expertAvatarUrl && (
              <img src={expertAvatarUrl} alt={expertName} className="h-8 w-8 rounded-full object-cover" />
            )}
            <div className="min-w-0">
              <span className="block">{lineChannelName || expertName || 'LINE 綁定'}</span>
              {lineOaId && (
                <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground font-normal">
                  <span>加入好友：</span>
                  <span>{lineOaId}</span>
                  <span className="mx-0.5">或</span>
                  <a
                    href={qrCodeUrl || `https://line.me/R/ti/p/${lineOaId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="掃描 QR Code 加入官方帳號"
                  >
                    <QrCode className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                  </a>
                </div>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">狀態</span>
            <Badge variant="secondary">
              <Check className="h-3 w-3 mr-1" />
              已綁定
            </Badge>
          </div>
          {binding.display_name && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">LINE 暱稱</span>
              <span className="font-medium text-sm">{binding.display_name}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            您將透過 LINE 收到此分析師的即時訊號通知
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={handleUnbind}
            disabled={unbinding}
          >
            <Unlink className="h-4 w-4 mr-1" />
            {unbinding ? '處理中...' : '解除綁定'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not subscribed - show unsubscribed state
  if (!isSubscribed) {
    return (
      <Card className="border-muted-foreground/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            {expertAvatarUrl ? (
              <img src={expertAvatarUrl} alt={expertName} className="h-10 w-10 rounded-full object-cover flex-shrink-0 opacity-60" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <MessageCircle className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <span className="font-semibold truncate block">{lineChannelName || expertName}</span>
              <span className="text-xs text-muted-foreground">尚未訂閱</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="flex-shrink-0"
              asChild
            >
              <Link to={`/expert/${expertSlug}#plans`}>前往訂閱</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not bound - show binding flow
  return (
    <Card>
      <CardContent className="p-4">
        {!bindingCode ? (
          <div className="flex items-center gap-3">
            {expertAvatarUrl ? (
              <img src={expertAvatarUrl} alt={expertName} className="h-10 w-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <MessageCircle className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <span className="font-semibold truncate block">{lineChannelName || expertName}</span>
              {lineOaId && (
                <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                  <span>加入好友：</span>
                  <span>{lineOaId}</span>
                  <span className="mx-0.5">或</span>
                  <a
                    href={qrCodeUrl || `https://line.me/R/ti/p/${lineOaId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="掃描 QR Code 加入官方帳號"
                  >
                    <QrCode className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
                  </a>
                </div>
              )}
            </div>
            <Button
              variant={isAdvisor ? 'advisor' : 'mentor'}
              size="sm"
              className="flex-shrink-0"
              onClick={generateCode}
              disabled={generating}
            >
              {generating ? (
                <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />生成中...</>
              ) : (
                '取得驗證碼'
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center space-y-3">
              <p className="text-sm text-muted-foreground">請在 LINE 中傳送以下驗證碼</p>
              <div className="relative flex justify-center">
                <code className="text-3xl font-mono font-bold tracking-[0.3em] bg-muted px-4 py-3 rounded-lg">
                  {bindingCode}
                </code>
                <Button variant="ghost" size="icon" className="absolute right-0 top-1/2 -translate-y-1/2 -mr-10" onClick={copyCode}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                驗證碼將在 10 分鐘後過期
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setBindingCode(null); setCodeExpiresAt(null); }}
              >
                取消
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={generateCode}
                disabled={generating}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                重新取得
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
