import { SEO } from '@/components/SEO';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { RichTextEditor } from '@/components/admin/RichTextEditor';
import { ArticleView } from '@/components/article/ArticleView';
import { supabase } from '@/integrations/supabase/client';
import { useFormDraft } from '@/hooks/useFormDraft';
import { sanitizeRichHtml } from '@/lib/sanitizeHtml';
import { nextUnifiedPublishAt, nextPublishMomentLabel } from '@/lib/publishingWindow';
import { articleSaveErrorMessage, fmtTaipeiDateTime } from '@/lib/articleTime';
import {
  LAYOUT_LABEL, orientationOf, buildTrialHtml, firstImageSrc, parseArticleBlocks,
  pendingImageCount, recommendLayouts, type ArticleLayout, type ImageOrientation,
} from '@/lib/articleLayout';
import { ARTICLE_STARTERS } from '@/pages/_articleEditor/starters';
import { ArticleAiTools } from '@/pages/_articleEditor/ArticleAiTools';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Draft = { title: string; lede: string; body: string; layout: ArticleLayout | ''; mode: 'immediate' | 'scheduled'; trial: boolean };
const EMPTY: Draft = { title: '', lede: '', body: '', layout: '', mode: 'scheduled', trial: false };

const ArticleEditor = () => {
  const { expertSlug, id } = useParams<{ expertSlug: string; id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(EMPTY);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [publishAt, setPublishAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [repush, setRepush] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [imgMeta, setImgMeta] = useState<Record<string, { o: ImageOrientation; w: number }>>({});
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const { data: expert } = useQuery({
    queryKey: ['article-editor-expert', expertSlug],
    enabled: !!expertSlug,
    queryFn: async () => (await supabase.from('experts').select('id, asset_class').eq('slug', expertSlug!).maybeSingle()).data,
  });

  const { data: loaded, isLoading } = useQuery({
    queryKey: ['article-editor', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('expert_articles').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!loaded) return;
    setD({ title: loaded.title, lede: loaded.lede, body: loaded.body_html, layout: loaded.layout as ArticleLayout, mode: loaded.publish_mode as Draft['mode'], trial: loaded.trial_enabled });
    setStatus(loaded.status as 'draft' | 'published');
    setPublishAt(loaded.publish_at);
  }, [loaded]);

  const { discard } = useFormDraft(`article-draft-${expertSlug}-new`, d as any, (saved: any) => setD({ ...EMPTY, ...saved }), { enabled: !id });

  const blocks = useMemo(() => parseArticleBlocks(d.body), [d.body]);
  const orientations = useMemo(() => blocks.filter((b) => b.type === 'img').map((b) => imgMeta[b.src!]?.o ?? 'landscape'), [blocks, imgMeta]);
  const recs = useMemo(() => recommendLayouts(blocks, orientations), [blocks, orientations]);
  const layout: ArticleLayout = d.layout || recs[0].layout;
  const blurry = blocks.filter((b) => b.type === 'img' && imgMeta[b.src!] && imgMeta[b.src!].w < 600).length;
  const pending = pendingImageCount(d.body);
  const isLive = status === 'published' && !!publishAt && new Date(publishAt).getTime() <= Date.now();
  const scheduledAt = nextUnifiedPublishAt(expert?.asset_class);

  const save = async (publish: boolean) => {
    if (!expert) return;
    if (!d.title.trim()) return toast.error('請先填文章標題');
    if (publish && blocks.length === 0) return toast.error('內文是空的');
    if (pending > 0) return toast.error(`還有 ${pending} 張圖片尚未上傳完成，請等上傳完成或重試`);
    setSaving(true);
    const body = sanitizeRichHtml(d.body);
    let nextPublishAt = publishAt;
    if (publish && !isLive) nextPublishAt = (d.mode === 'immediate' ? new Date() : scheduledAt).toISOString();
    const row = {
      expert_id: expert.id,
      title: d.title.trim(),
      lede: d.lede.trim(),
      body_html: body,
      layout,
      publish_mode: d.mode,
      status: publish || status === 'published' ? 'published' : 'draft',
      publish_at: publish || status === 'published' ? nextPublishAt : null,
      trial_enabled: d.trial,
      trial_html: d.trial ? buildTrialHtml(body, 3) : '',
      cover_url: firstImageSrc(body),
      ...(isLive && repush ? { push_revision: (loaded?.push_revision ?? 0) + 1 } : {}),
    };
    const res = id
      ? await supabase.from('expert_articles').update(row).eq('id', id).select('id').single()
      : await supabase.from('expert_articles').insert(row).select('id').single();
    setSaving(false);
    if (res.error) return toast.error(articleSaveErrorMessage(res.error.message));
    if (!id) discard();
    // 已到公開時間就立即通知；排程的由系統到點通知。重複呼叫由後端去重。
    const savedId = (res.data as any)?.id as string | undefined;
    const due = publish && nextPublishAt && new Date(nextPublishAt).getTime() <= Date.now();
    if (savedId && due && (!isLive || repush)) {
      supabase.functions.invoke('article-push', { body: { article_id: savedId } }).then(({ error }) => {
        if (error) toast.error('通知送出失敗，可在文章列表按「重試」');
        else qc.invalidateQueries({ queryKey: ['admin-articles', expertSlug] });
      });
    }
    qc.invalidateQueries({ queryKey: ['admin-articles', expertSlug] });
    qc.invalidateQueries({ queryKey: ['article-editor', id] });
    toast.success(publish ? (d.mode === 'immediate' || isLive ? '已公開' : `已排定 ${fmtTaipeiDateTime(nextPublishAt!)} 公開`) : '已儲存');
    navigate(`/admin/${expertSlug}/articles`);
  };

  const applyStarter = (html: string) => {
    if (d.body.trim() && !window.confirm('套用範本會取代目前內文，確定嗎？')) return;
    set({ body: html });
  };

  if (id && isLoading) return <AdminLayout><div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />載入中...</div></AdminLayout>;

  return (
    <AdminLayout>
      <SEO title="寫教學文章 | legendflow" description="部落格形式的教學文章編輯器。" path={`/admin/${expertSlug || ''}/articles`} noindex />
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{id ? '編輯教學文章' : '寫教學文章'}</h1>

        <Card><CardContent className="space-y-3 p-4">
          <Input aria-label="文章標題" placeholder="文章標題（例如：為什麼停損比選股更重要）" value={d.title} onChange={(e) => set({ title: e.target.value })} className="text-lg font-bold" />
          <Textarea aria-label="開場導言" placeholder="開場導言（一兩句話，會用大字顯示在標題下方，可留空）" value={d.lede} onChange={(e) => set({ lede: e.target.value })} rows={2} />
          {!id && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">起手範本：</span>
              {ARTICLE_STARTERS.map((s) => <Button key={s.key} type="button" size="sm" variant="outline" onClick={() => applyStarter(s.html)}>{s.label}</Button>)}
            </div>
          )}
          <RichTextEditor articleMode value={d.body} onChange={(v) => set({ body: v })} uploadFolder={expert?.id} minHeight={320}
            placeholder="直接開始寫。按上方「大標」「小標」「重點句」就能排版，圖片可直接貼上或拖曳進來。" />
          <p className="text-xs text-muted-foreground">提醒：請使用自己的圖片，引用他人圖表或新聞請在圖說註明來源。連續兩張圖會自動並排。</p>
          <ArticleAiTools expertId={expert?.id} body={d.body} blocks={blocks} onBodyChange={(v) => set({ body: v })} />
        </CardContent></Card>

        <Card><CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold">選版型 <span className="text-xs font-normal text-muted-foreground">系統已幫你選好最適合的，點其他可換</span></div>
            <div className="flex gap-1">
              {(['desktop', 'mobile'] as const).map((v) => <Button key={v} size="sm" variant={previewDevice === v ? 'default' : 'outline'} onClick={() => setPreviewDevice(v)}>{v === 'desktop' ? '電腦' : '手機'}</Button>)}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {recs.map((r, i) => (
              <button key={r.layout} type="button" onClick={() => set({ layout: r.layout })} aria-pressed={layout === r.layout}
                className={cn('rounded-lg border p-3 text-left transition', layout === r.layout ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                <div className="text-sm font-bold">{LAYOUT_LABEL[r.layout]}{i === 0 && <span className="ml-1 text-xs text-primary">推薦</span>}</div>
                <div className="mt-1 text-xs text-muted-foreground">{r.reason}</div>
              </button>
            ))}
          </div>
          {blurry > 0 && <div className="text-xs text-destructive">有 {blurry} 張圖片寬度不到 600，可能看起來模糊，建議換清楚一點的圖（不影響發布）。</div>}
          <div className="overflow-hidden rounded-xl border bg-background">
            <div className={cn('mx-auto p-5', previewDevice === 'mobile' ? 'max-w-[390px]' : 'max-w-full')}>
              <ArticleView layout={layout} title={d.title} lede={d.lede} blocks={blocks} meta="預覽" />
              {/* 隱形量測：取得每張圖方向與寬度供推薦與模糊提醒 */}
              <div className="hidden">
                {blocks.filter((b) => b.type === 'img').map((b) => (
                  <img key={b.src} src={b.src} alt="" onLoad={(e) => {
                    const im = e.currentTarget; const src = b.src!;
                    setImgMeta((m) => m[src] ? m : { ...m, [src]: { o: orientationOf(im.naturalWidth, im.naturalHeight), w: im.naturalWidth } });
                  }} />
                ))}
              </div>
            </div>
          </div>
        </CardContent></Card>

        <Card><CardContent className="space-y-4 p-4">
          {!isLive ? (
            <RadioGroup value={d.mode} onValueChange={(v) => set({ mode: v as Draft['mode'] })} className="space-y-2">
              <div className="flex items-center gap-2"><RadioGroupItem id="m-s" value="scheduled" /><Label htmlFor="m-s">照統一時間公開（{nextPublishMomentLabel(expert?.asset_class)}，這次是 {fmtTaipeiDateTime(scheduledAt)}）</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem id="m-i" value="immediate" /><Label htmlFor="m-i">立即公開</Label></div>
            </RadioGroup>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">已於 {fmtTaipeiDateTime(publishAt!)} 公開。修改後會員會看到「最後修改時間」，預設不會再通知。</div>
              <div className="flex items-center gap-2">
                <Switch id="repush" checked={repush} onCheckedChange={setRepush} />
                <Label htmlFor="repush">這次修改要重新通知訂閱者（LINE／站內各一次）</Label>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch id="trial" checked={d.trial} onCheckedChange={(v) => set({ trial: v })} />
            <Label htmlFor="trial">開放試讀（未訂閱者可在你的介紹頁看到前三行）</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            {status === 'draft' && <Button variant="outline" disabled={saving} onClick={() => save(false)}>存草稿</Button>}
            <Button disabled={saving} onClick={() => save(true)}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {isLive ? '更新文章' : status === 'published' ? '更新並維持排程' : d.mode === 'immediate' ? '立即公開' : '排定公開'}
            </Button>
          </div>
        </CardContent></Card>
      </div>
    </AdminLayout>
  );
};

export default ArticleEditor;
