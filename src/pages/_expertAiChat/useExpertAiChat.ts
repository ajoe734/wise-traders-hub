import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { supabase } from '@/integrations/supabase/client';

interface HistoryMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
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
  const loadedFor = useRef<string | null>(null);

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
  });

  const chat = useChat({
    id: expertId ? `expert-ai-${expertId}` : undefined,
    messages: history,
    transport,
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
  };

  return { ...chat, loadingHistory, loadError, clearConversation };
}
