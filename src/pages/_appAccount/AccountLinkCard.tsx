import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link2, Copy, Check, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type GeneratedCode = { code: string; expires_at: string };

export function AccountLinkCard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'generate' | 'consume'>('generate');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedCode | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [consuming, setConsuming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remainSec, setRemainSec] = useState(0);
  const [merges, setMerges] = useState<any[]>([]);

  const identityLabel = user?.isLineUser ? 'LINE 帳號' : `Email：${user?.email ?? ''}`;

  useEffect(() => {
    if (!generated) { setRemainSec(0); return; }
    const t = setInterval(() => {
      const diff = Math.max(0, Math.floor((new Date(generated.expires_at).getTime() - Date.now()) / 1000));
      setRemainSec(diff);
      if (diff <= 0) setGenerated(null);
    }, 1000);
    return () => clearInterval(t);
  }, [generated]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('account_merges')
      .select('*')
      .or(`primary_user_id.eq.${user.id},secondary_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .then(({ data }) => setMerges(data ?? []));
  }, [user?.id]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('account-link-generate');
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setGenerated({ code: (data as any).code, expires_at: (data as any).expires_at });
    } catch (e: any) {
      toast.error(`產生綁定碼失敗：${e.message ?? e}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleConsume = async () => {
    const code = inputCode.trim().replace(/\D/g, '');
    if (code.length !== 6) { toast.error('請輸入 6 位數綁定碼'); return; }
    if (!confirm('綁定後，目前這個帳號的訂閱、持倉、通知等資料會全部搬到主帳號，此帳號會被停用。確定要繼續？')) return;
    setConsuming(true);
    try {
      const { data, error } = await supabase.functions.invoke('account-link-consume', { body: { code } });
      if (error) throw error;
      const payload = data as any;
      if (payload?.error) throw new Error(payload.error);
      toast.success('綁定成功！將自動登出，請改用主帳號登入');
      setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = '/auth';
      }, 1500);
    } catch (e: any) {
      const msg = e.message ?? String(e);
      const map: Record<string, string> = {
        INVALID_CODE: '綁定碼格式錯誤',
        CODE_NOT_FOUND: '找不到此綁定碼',
        CODE_ALREADY_USED: '此綁定碼已被使用',
        CODE_EXPIRED: '此綁定碼已過期，請請對方重新產生',
        SAME_ACCOUNT: '不能綁定自己',
        PRIMARY_ALREADY_MERGED: '主帳號本身已被合併，請聯絡客服',
        SECONDARY_ALREADY_MERGED: '目前這個帳號已被合併過',
      };
      toast.error(map[msg] ?? `綁定失敗：${msg}`);
    } finally {
      setConsuming(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Email ↔ LINE 帳號綁定
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            目前身份：{identityLabel}
          </p>
        </div>

        {merges.length > 0 && (
          <div className="text-xs bg-muted/50 rounded p-2 space-y-1">
            <div className="flex items-center gap-1 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" /> 已完成的綁定
            </div>
            {merges.map((m) => (
              <div key={m.id} className="text-muted-foreground">
                {new Date(m.created_at).toLocaleString('zh-TW')}　
                {m.primary_user_id === user?.id
                  ? `已合併 ${m.secondary_identity === 'line' ? 'LINE' : `Email(${m.secondary_email ?? ''})`}`
                  : `此帳號已合併至 ${m.primary_identity === 'line' ? 'LINE' : `Email(${m.primary_email ?? ''})`}`}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1 border-b">
          <button
            className={`px-3 py-2 text-sm ${tab === 'generate' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
            onClick={() => setTab('generate')}
          >
            我是主帳號（產生碼）
          </button>
          <button
            className={`px-3 py-2 text-sm ${tab === 'consume' ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
            onClick={() => setTab('consume')}
          >
            我是要合併過去（輸入碼）
          </button>
        </div>

        {tab === 'generate' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              以「目前這個帳號」為主帳號，另一邊（LINE 或 Email）登入後輸入以下 6 位碼即可合併。合併後訂閱、持倉、通知都會集中在此帳號。
            </p>
            {generated ? (
              <div className="rounded-lg border-2 border-dashed border-primary/50 p-4 text-center space-y-2">
                <div className="font-mono text-3xl tracking-[0.4em] font-bold">{generated.code}</div>
                <div className="text-xs text-muted-foreground">
                  剩餘 {Math.floor(remainSec / 60)}:{String(remainSec % 60).padStart(2, '0')}
                </div>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <><Check className="h-4 w-4 mr-1" />已複製</> : <><Copy className="h-4 w-4 mr-1" />複製</>}
                </Button>
              </div>
            ) : (
              <Button onClick={handleGenerate} disabled={generating}>
                {generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                產生綁定碼（10 分鐘有效）
              </Button>
            )}
          </div>
        )}

        {tab === 'consume' && (
          <div className="space-y-3">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              ⚠️ 執行後，「目前這個帳號」的所有訂閱、持倉、額度都會搬到主帳號，此帳號會被停用、無法再登入。
            </p>
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="輸入 6 位綁定碼"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="font-mono text-lg tracking-widest text-center"
            />
            <Button onClick={handleConsume} disabled={consuming || inputCode.length !== 6} variant="destructive">
              {consuming && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              合併到主帳號
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
