import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2, Send, Trash2, Lock, Shield, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useExpertAiChat } from './useExpertAiChat';

interface Props {
  expertId: string;
  expertName: string;
  isSubscribed: boolean;
  onSubscribeClick?: () => void;
}

const SUGGESTIONS = [
  '你最近怎麼看 AI 相關族群？',
  '選股時你最看重什麼指標？',
  '風險控管上你有什麼原則？',
];

export function ExpertAiChatTab({ expertId, expertName, isSubscribed, onSubscribeClick }: Props) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    sendMessage,
    status,
    loadingHistory,
    loadError,
    clearConversation,
    error,
  } = useExpertAiChat(isSubscribed ? expertId : null);

  const isBusy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (!isBusy) textareaRef.current?.focus();
  }, [isBusy, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isBusy) return;
    setInput('');
    await sendMessage({ text: msg });
  };

  if (!isSubscribed) {
    return (
      <Card className="border-mentor/30 bg-mentor/5">
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-mentor/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-mentor" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">訂閱後可與 AI 分身對話</h3>
            <p className="text-sm text-muted-foreground mt-1">
              基於 {expertName} 老師的公開週記與策略，模擬其想法與口吻回答你的問題。
            </p>
          </div>
          <Button onClick={onSubscribeClick} className="bg-mentor hover:bg-mentor/90 text-white">
            立即訂閱
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-mentor" />
          <span className="text-sm font-medium">與 {expertName} 的 AI 分身對話</span>
          <Badge variant="outline" className="text-[10px]">AI 生成</Badge>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearConversation} className="text-muted-foreground">
            <Trash2 className="h-3.5 w-3.5 mr-1" /> 清空
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {loadingHistory && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {loadError && (
          <div className="text-sm text-destructive text-center py-4">{loadError}</div>
        )}
        {!loadingHistory && messages.length === 0 && (
          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground text-center">試試這些問題：</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-left text-sm p-3 rounded-lg border border-border hover:bg-mentor/5 hover:border-mentor/30 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const text = (m.parts || [])
            .map((p: any) => (p.type === 'text' ? p.text : ''))
            .join('');
          const isUser = m.role === 'user';
          return (
            <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  isUser
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-foreground'
                }`}
              >
                {isUser ? (
                  <div className="whitespace-pre-wrap">{text}</div>
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1">
                    <ReactMarkdown>{text || '...'}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {status === 'submitted' && (
          <div className="flex justify-start">
            <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 思考中…
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive text-center">
            {error.message || '對話發生錯誤，請稍後再試'}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`向 ${expertName} 提問…（Shift+Enter 換行）`}
            className="resize-none min-h-[44px] max-h-32"
            rows={1}
            disabled={isBusy}
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || isBusy}
            size="icon"
            className="shrink-0 bg-mentor hover:bg-mentor/90 text-white"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Shield className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            本對話由 AI 根據 {expertName} 公開週記生成，不代表老師本人即時觀點，不構成投資建議。
          </span>
        </div>
      </div>
    </div>
  );
}
