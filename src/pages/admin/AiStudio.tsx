import { SEO } from '@/components/SEO';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sparkles, BookOpen, MessagesSquare, Database, CalendarCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import PersonaTab from '@/pages/_aiStudio/PersonaTab';
import KnowledgeTab from '@/pages/_aiStudio/KnowledgeTab';
import WeeklyTrainerTab from '@/pages/_aiStudio/WeeklyTrainerTab';
import FewshotTab from '@/pages/_aiStudio/FewshotTab';
import ReviewTab from '@/pages/_aiStudio/ReviewTab';
import IndexPanelTab from '@/pages/_aiStudio/IndexPanelTab';

export default function AdminAiStudio() {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user, hasRole } = useAuth();
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  const canEdit = isCompanyAdmin || isOwner;
  const [tab, setTab] = useState('persona');

  const { data: expert } = useQuery({
    queryKey: ['ai-studio-expert', expertSlug],
    enabled: !!expertSlug,
    queryFn: async () => {
      const { data, error } = await supabase.from('experts').select('id, name, slug').eq('slug', expertSlug!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <AdminLayout>
      <SEO title={`AI 訓練台 · ${expert?.name || ''}`} description="調整 AI 分身的口吻、知識庫與示範問答" />
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
        <header className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-mentor/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-mentor" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI 訓練台</h1>
            <p className="text-sm text-muted-foreground">
              校準你的 AI 分身：人設決定口吻、知識庫決定他知道什麼、示範問答決定他怎麼回。所有調整都會立即影響「問老師 AI」對話。
            </p>
          </div>
        </header>

        {!expert?.id ? (
          <div className="p-8 text-center text-muted-foreground">載入中…</div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid grid-cols-5 w-full max-w-2xl">
              <TabsTrigger value="persona"><Sparkles className="h-4 w-4 mr-1.5" />人設</TabsTrigger>
              <TabsTrigger value="knowledge"><BookOpen className="h-4 w-4 mr-1.5" />知識庫</TabsTrigger>
              <TabsTrigger value="fewshot"><MessagesSquare className="h-4 w-4 mr-1.5" />示範問答</TabsTrigger>
              <TabsTrigger value="weekly"><CalendarCheck className="h-4 w-4 mr-1.5" />週五訓練</TabsTrigger>
              <TabsTrigger value="index"><Database className="h-4 w-4 mr-1.5" />週記索引</TabsTrigger>
            </TabsList>

            <TabsContent value="persona" className="mt-4">
              <PersonaTab expertId={expert.id} expertName={expert.name} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="knowledge" className="mt-4">
              <KnowledgeTab expertId={expert.id} canEdit={canEdit} isCompanyAdmin={isCompanyAdmin} />
            </TabsContent>
            <TabsContent value="fewshot" className="mt-4">
              <FewshotTab expertId={expert.id} canEdit={canEdit} isCompanyAdmin={isCompanyAdmin} />
            </TabsContent>
            <TabsContent value="weekly" className="mt-4">
              <WeeklyTrainerTab expertId={expert.id} canEdit={canEdit} />
            </TabsContent>
            <TabsContent value="index" className="mt-4">
              <IndexPanelTab expertId={expert.id} expertName={expert.name} canEdit={canEdit} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AdminLayout>
  );
}
