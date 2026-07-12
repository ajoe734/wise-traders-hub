import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface Props { expertId: string; expertName: string; canEdit: boolean; }

async function call(action: string, expertId: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('expert-ai-studio', {
    body: { action, expert_id: expertId, ...extra },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || 'failed');
  return data;
}

export default function PersonaTab({ expertId, expertName, canEdit }: Props) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['persona', expertId],
    queryFn: () => call('get_persona', expertId),
  });
  const p = data?.persona;
  const [prompt, setPrompt] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const [tone, setTone] = useState<string[]>([]);
  const [forbidden, setForbidden] = useState<string[]>([]);
  const [model, setModel] = useState('openai/gpt-5');
  const [toneInput, setToneInput] = useState('');
  const [forbidInput, setForbidInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPrompt(p?.system_prompt || '');
    setDisclaimer(p?.disclaimer || '');
    setTone(p?.tone || []);
    setForbidden(p?.forbidden_topics || []);
    setModel(p?.model || 'openai/gpt-5');
  }, [p]);

  const save = async () => {
    setSaving(true);
    try {
      await call('save_persona', expertId, {
        system_prompt: prompt, disclaimer, tone, forbidden_topics: forbidden, model,
      });
      toast.success('人設已儲存，下一次對話立即生效');
      refetch();
    } catch (e: any) {
      toast.error(e.message || '儲存失敗');
    } finally { setSaving(false); }
  };

  if (isLoading) return <div className="p-4 text-muted-foreground">載入中…</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">系統提示詞（Persona）</CardTitle>
          <CardDescription>
            這段文字會作為 AI 的最高指令注入到每次對話。留空則沿用預設模板（用你的簡介／策略摘要／風格標籤自動生成）。
            建議寫進：你的自我介紹、擅長什麼、擅長回答哪類問題、遇到什麼問題會轉介、你的口頭禪／慣用句。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`例：你是「${expertName}」，一位專注中小型成長股的實戰導師。我的招牌是「先看週線再看日線」…遇到當沖問題，一律引導對方去看《週記》裡的方法論。`}
            className="min-h-[200px] font-mono text-sm"
            disabled={!canEdit}
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground text-right">{prompt.length} / 4000</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">語氣關鍵字</CardTitle>
          <CardDescription>Enter 新增。例：沉穩、直白、少用術語、多用比喻</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={toneInput}
              onChange={(e) => setToneInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && toneInput.trim()) {
                  e.preventDefault();
                  setTone([...tone, toneInput.trim()]);
                  setToneInput('');
                }
              }}
              placeholder="輸入後按 Enter"
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tone.map((t, i) => (
              <Badge key={i} variant="secondary" className="gap-1">
                {t}
                {canEdit && (
                  <button onClick={() => setTone(tone.filter((_, x) => x !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">禁區主題</CardTitle>
          <CardDescription>AI 遇到這些主題會禮貌拒答。例：期貨、選擇權、加密貨幣、個人隱私</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={forbidInput}
              onChange={(e) => setForbidInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && forbidInput.trim()) {
                  e.preventDefault();
                  setForbidden([...forbidden, forbidInput.trim()]);
                  setForbidInput('');
                }
              }}
              placeholder="輸入後按 Enter"
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {forbidden.map((t, i) => (
              <Badge key={i} variant="destructive" className="gap-1">
                {t}
                {canEdit && (
                  <button onClick={() => setForbidden(forbidden.filter((_, x) => x !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">免責聲明</CardTitle>
          <CardDescription>AI 會在合適時機附上這段話，通常放在給投資判斷之後。</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={disclaimer}
            onChange={(e) => setDisclaimer(e.target.value)}
            placeholder="例：以上為我個人觀點，實際下單前請自行評估風險，本內容不構成任何投資建議。"
            className="min-h-[80px]"
            disabled={!canEdit}
            maxLength={500}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">模型</CardTitle>
          <CardDescription>預設 openai/gpt-5。若想省成本可換 openai/gpt-5-mini（僅接受 openai/ 開頭）。</CardDescription>
        </CardHeader>
        <CardContent>
          <Label className="text-xs">模型 ID</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} disabled={!canEdit} className="max-w-md" />
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            儲存人設
          </Button>
        </div>
      )}
    </div>
  );
}
