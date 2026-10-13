import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { frameImage } from '@/lib/articleImageFrame';
import { tidyToHtml, type TidyIn, type TidyOut, ARTICLE_AI_LIMITS } from '../../../supabase/functions/_shared/articleAiCore';
import type { ArticleBlock } from '@/lib/articleLayout';
import { Loader2, Sparkles, Wand2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

export function aiErrorMessage(code?: string): string {
  switch (code) {
    case 'quota_exceeded': return '今天的 AI 使用次數已用完，明天再試';
    case 'ai_credits': return 'AI 額度不足，請聯絡平台管理員';
    case 'guard_rejected': return '整理結果改到了你的文字，系統已擋下，內文維持原樣';
    case 'not_own_image': return '只能處理你自己上傳的圖片';
    case 'too_long': return '文章太長，請分段整理';
    case 'empty': return '內文沒有文字可整理';
    default: return 'AI 暫時無法處理，原圖原文都沒有變動';
  }
}

async function invokeAi<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let code: string | undefined;
    try { code = (await (error as any).context?.json?.())?.error; } catch { /* ignore */ }
    throw new Error(code || 'ai_failed');
  }
  return data as T;
}

interface Props {
  expertId?: string;
  body: string;
  blocks: ArticleBlock[];
  onBodyChange: (html: string) => void;
}

type Compare = { oldSrc: string; newSrc: string; how: 'restyle' | 'frame' };

export function ArticleAiTools({ expertId, body, blocks, onBodyChange }: Props) {
  const images = blocks.filter((b) => b.type === 'img' && b.src);
  const [busySrc, setBusySrc] = useState<string | null>(null);
  const [dataMarked, setDataMarked] = useState<Record<string, boolean>>({});
  const [compare, setCompare] = useState<Compare | null>(null);
  const [tidying, setTidying] = useState(false);
  const [undoBody, setUndoBody] = useState<string | null>(null);

  const uploadFramed = async (src: string) => {
    const blob = await frameImage(src);
    const path = `${expertId}/frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const { error } = await supabase.storage.from('signal-media').upload(path, blob, { contentType: 'image/png', upsert: false });
    if (error) throw new Error('upload_failed');
    return supabase.storage.from('signal-media').getPublicUrl(path).data.publicUrl;
  };

  const restyle = async (src: string) => {
    if (!expertId) return;
    setBusySrc(src);
    try {
      const r = await invokeAi<{ route: 'frame' | 'restyle'; url?: string }>('article-ai-image', { expert_id: expertId, image_url: src, force_frame: !!dataMarked[src] });
      if (r.route === 'restyle' && r.url) setCompare({ oldSrc: src, newSrc: r.url, how: 'restyle' });
      else setCompare({ oldSrc: src, newSrc: await uploadFramed(src), how: 'frame' });
    } catch (e: any) {
      toast.error(aiErrorMessage(e?.message));
    } finally { setBusySrc(null); }
  };

  const accept = () => {
    if (!compare) return;
    onBodyChange(body.split(compare.oldSrc).join(compare.newSrc));
    setCompare(null);
    toast.success('已換成新圖');
  };

  const tidy = async () => {
    if (!expertId) return;
    const imgs: Array<{ src: string; alt?: string }> = [];
    const input: TidyIn[] = blocks.flatMap((b): TidyIn[] => {
      if (b.type === 'img') { imgs.push({ src: b.src!, alt: b.alt }); return [{ type: 'img', ref: imgs.length - 1 }]; }
      return b.text.trim() ? [{ type: 'text', text: b.text }] : [];
    });
    if (!input.some((b) => b.type === 'text')) return toast.error(aiErrorMessage('empty'));
    setTidying(true);
    try {
      const r = await invokeAi<{ blocks: TidyOut[] }>('article-ai-tidy', { expert_id: expertId, blocks: input });
      setUndoBody(body);
      onBodyChange(tidyToHtml(r.blocks, imgs));
      toast.success('已整理排版，字詞完全沒變；不滿意可按「復原」');
    } catch (e: any) {
      toast.error(aiErrorMessage(e?.message));
    } finally { setTidying(false); }
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={tidying || !expertId} onClick={tidy}>
          {tidying ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1 h-4 w-4" />}一鍵整理排版
        </Button>
        {undoBody !== null && (
          <Button type="button" size="sm" variant="ghost" onClick={() => { onBodyChange(undoBody); setUndoBody(null); }}>
            <Undo2 className="mr-1 h-4 w-4" />復原
          </Button>
        )}
        <span className="text-xs text-muted-foreground">只調整大小標與段落，不改任何字。每天 {ARTICLE_AI_LIMITS.tidy} 次。</span>
      </div>

      {images.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            圖片統一風格（每天 {ARTICLE_AI_LIMITS.image} 張）：一般插圖會用 AI 重畫成統一風格；K 線、對帳單、有數字或文字的截圖只會裁邊加相框，數字不會被改。
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((b) => (
              <div key={b.src} className="flex items-center gap-2 rounded-md border p-2">
                <img src={b.src} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Checkbox id={`d-${b.src}`} checked={!!dataMarked[b.src!]} onCheckedChange={(v) => setDataMarked((m) => ({ ...m, [b.src!]: !!v }))} />
                    <Label htmlFor={`d-${b.src}`} className="text-xs">這是數據截圖（只加相框）</Label>
                  </div>
                  <Button type="button" size="sm" variant="secondary" disabled={!!busySrc} onClick={() => restyle(b.src!)}>
                    {busySrc === b.src ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}統一風格
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!compare} onOpenChange={(o) => !o && setCompare(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{compare?.how === 'restyle' ? 'AI 重畫結果' : '裁邊加相框結果（數字未變動）'}</DialogTitle></DialogHeader>
          {compare && (
            <div className="grid gap-3 sm:grid-cols-2">
              <figure className="space-y-1"><img src={compare.oldSrc} alt="原圖" className="w-full rounded border" /><figcaption className="text-xs text-muted-foreground">原圖</figcaption></figure>
              <figure className="space-y-1"><img src={compare.newSrc} alt="新圖" className="w-full rounded border" /><figcaption className="text-xs text-muted-foreground">新圖</figcaption></figure>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompare(null)}>保留原圖</Button>
            <Button onClick={accept}>換成新圖</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
