import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { SEO } from '@/components/SEO';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getFirstTouch, ga4Lead } from '@/lib/analytics/marketing';
import { trackRaw } from '@/lib/analytics/events';

const schema = z.object({
  name: z.string().trim().min(1, '請填寫姓名').max(100),
  email: z.string().trim().email('Email 格式不正確').max(255),
  phone: z.string().trim().max(30).optional(),
});

/** 線下活動報名：/events/:slug。報名時寫入首次接觸 UTM 與進站時間。 */
export default function EventSignup() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const validSlug = /^[a-z0-9-]{1,80}$/.test(slug);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true);
    const t = getFirstTouch();
    const { error: err } = await supabase.from('event_registrations').insert({
      event_slug: slug,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone || null,
      user_id: user?.id ?? null,
      visitor_id: t.visitor_id,
      utm_source: t.utm_source, utm_medium: t.utm_medium, utm_campaign: t.utm_campaign, utm_content: t.utm_content,
      first_touch_at: t.first_touch_at,
    });
    setBusy(false);
    if (err) { setError('報名失敗，請稍後再試'); return; }
    ga4Lead(slug);
    trackRaw('event_registration', { event_slug: slug });
    setDone(true);
  };

  return (
    <PortalLayout>
      <SEO title="活動報名｜legendflow" description="legendflow 線下活動報名" />
      <div className="max-w-md mx-auto py-12 px-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">活動報名</CardTitle></CardHeader>
          <CardContent>
            {!validSlug ? (
              <p className="text-sm">找不到這個活動。</p>
            ) : done ? (
              <p className="text-sm">報名完成，我們會再與你聯繫。</p>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1"><Label htmlFor="ev-name">姓名</Label>
                  <Input id="ev-name" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ev-email">Email</Label>
                  <Input id="ev-email" type="email" value={form.email} maxLength={255} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="ev-phone">電話（選填）</Label>
                  <Input id="ev-phone" value={form.phone} maxLength={30} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={busy} className="w-full">{busy ? '送出中…' : '送出報名'}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  );
}
