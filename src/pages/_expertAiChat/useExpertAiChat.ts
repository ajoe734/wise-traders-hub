import { useEffect, useRef, useState, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { supabase } from '@/integrations/supabase/client';

interface HistoryMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface ExpertAiQuota {
  limit: number;
  used: number;
  remaining: number;
  resets_at: string;
  unlimited?: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function historyToUIMessages(rows: HistoryMsg[]): UIMessage[] {
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      id: r.id,
      role: r.role,
      parts: [{ type: 'text' as const, text: r.content }],
    })) as UIMessage[];
}

export function useExpertAiChat(expertId: string | null | undefined) {
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quota, setQuota] = useState<ExpertAiQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const refreshQuota = useCallback(async () => {
    if (!expertId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const url = `${SUPABASE_URL}/functions/v1/expert-ai-conversation?expert_id=${expertId}`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
      });
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.quota) setQuota(json.quota);
    } catch { /* noop */ }
  }, [expertId]);

  useEffect(() => {
    if (!expertId) return;
    if (loadedFor.current === expertId) return;
    loadedFor.current = expertId;
    setLoadingHistory(true);
    setLoadError(null);

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const url = `${SUPABASE_URL}/functions/v1/expert-ai-conversation?expert_id=${expertId}`;
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`,
            apikey: SUPABASE_PUBLISHABLE_KEY,
          },
        });
        if (!resp.ok) throw new Error(`載入失敗 (${resp.status})`);
        const json = await resp.json();
        setHistory(historyToUIMessages(json.messages || []));
        if (json.quota) setQuota(json.quota);
      } catch (e: any) {
        setLoadError(e?.message || '載入對話失敗');
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [expertId]);

  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthToken(data.session?.access_token || null);
    });
  }, []);

  const transport = new DefaultChatTransport({
    api: `${SUPABASE_URL}/functions/v1/expert-ai-chat`,
    headers: () => ({
      Authorization: `Bearer ${authToken || SUPABASE_PUBLISHABLE_KEY}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    }),
    body: () => ({ expert_id: expertId }),
    // 攔截非 2xx 回應 → 解析錯誤 body、更新配額狀態
    fetch: async (input, init) => {
      const resp = await fetch(input as any, init);
      if (!resp.ok) {
        try {
          const cloned = resp.clone();
          const body = await cloned.json();
          if (body?.code === 'AI_CHAT_QUOTA_EXCEEDED') {
            if (body.quota) setQuota(body.quota);
            setQuotaError(body.message || '今日 AI 對話次數已達上限');
          }
        } catch { /* ignore */ }
      }
      return resp;
    },
  });

  const chat = useChat({
    id: expertId ? `expert-ai-${expertId}` : undefined,
    messages: history,
    transport,
    onFinish: () => {
      setQuotaError(null);
      refreshQuota();
    },
  });

  const clearConversation = async () => {
    if (!expertId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    await fetch(`${SUPABASE_URL}/functions/v1/expert-ai-conversation?expert_id=${expertId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token || SUPABASE_PUBLISHABLE_KEY}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    });
    setHistory([]);
    chat.setMessages([]);
    setQuotaError(null);
    refreshQuota();
  };

  return {
    ...chat,
    loadingHistory,
    loadError,
    clearConversation,
    quota,
    quotaError,
    refreshQuota,
  };
}
