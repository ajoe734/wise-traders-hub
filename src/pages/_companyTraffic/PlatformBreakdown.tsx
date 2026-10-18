import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { aggregatePlatforms } from '@/lib/analytics/platformAttribution';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

async function readPages<T>(makeQuery: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await makeQuery(offset);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) return rows;
  }
}
export default function PlatformBreakdown({ from, to }: { from: string; to: string }) {
  const [campaign, setCampaign] = useState('brcto_journal');
  const [draft, setDraft] = useState(campaign);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['traffic-platforms', campaign, from, to],
    queryFn: async () => {
      const [visits, referrals, conversions, profiles] = await Promise.all([
        readPages(offset => supabase.from('traffic_visits').select('visitor_id,utm_campaign,utm_content,first_seen_at,first_landing_path').eq('utm_campaign', campaign).gte('first_seen_at', from).lt('first_seen_at', to).order('id').range(offset, offset + 499)),
        readPages(offset => supabase.from('referral_attributions').select('user_id,utm_campaign,utm_content,created_at,locked_until').lt('created_at', to).order('id').range(offset, offset + 499)),
        readPages(offset => supabase.from('conversions').select('id,utm_campaign,utm_content,gross_amount,occurred_at').eq('utm_campaign', campaign).gte('occurred_at', from).lt('occurred_at', to).order('id').range(offset, offset + 499)),
        readPages(offset => supabase.from('profiles').select('user_id,created_at').gte('created_at', from).lt('created_at', to).order('id').range(offset, offset + 499)),
      ]);
      return aggregatePlatforms(visits.filter(row => !/^\/(company|admin)(\/|$)/.test(row.first_landing_path ?? '')), referrals, conversions, profiles, campaign, from, to);
    },
  });
  return <section className="space-y-4 py-4" aria-label="自媒體分平台">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-bold">自媒體分平台</h2>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (draft.trim()) setCampaign(draft.trim()); }}>
        <Input aria-label="活動名稱" value={draft} onChange={event => setDraft(event.target.value)} className="w-48 max-w-full" />
        <Button type="submit" variant="outline">查詢</Button>
        <Button type="button" variant="outline" onClick={() => void refetch()}>重新整理</Button>
      </form>
    </div>
    {isLoading ? <p role="status">載入中…</p> : error ? <p role="alert" className="text-destructive">平台統計讀取失敗，請重新整理。</p> : <>
      <Table>
        <TableHeader><TableRow><TableHead>平台</TableHead><TableHead className="text-right">訪客</TableHead><TableHead className="text-right">註冊</TableHead><TableHead className="text-right">成交</TableHead><TableHead className="text-right">毛收（NT$）</TableHead></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).map(row => <TableRow key={row.platform}><TableCell className="font-medium">{row.platform}</TableCell><TableCell className="text-right">{row.visitors}</TableCell><TableCell className="text-right">{row.signups}</TableCell><TableCell className="text-right">{row.orders}</TableCell><TableCell className="text-right">{row.gross.toLocaleString()}</TableCell></TableRow>)}
          {!data?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">此活動於區間內尚無資料</TableCell></TableRow>}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">首次來源歸因；註冊依帳號建立日期，成交依付款紀錄。未付款匯款單不計成交；沒有平台標記列為「未標平台」。</p>
    </>}
  </section>;
}