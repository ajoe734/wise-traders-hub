import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export type AIAssistMode = 'rewrite' | 'expand' | 'summarize' | 'bulletize' | 'custom';

interface Props {
  field?: string;
  onPick: (mode: AIAssistMode, instruction?: string) => Promise<void> | void;
}

export const AIAssistMenu = ({ onPick }: Props) => {
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [instruction, setInstruction] = useState('');

  const handle = async (mode: AIAssistMode, ins?: string) => {
    setBusy(true);
    try {
      await onPick(mode, ins);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary" disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => handle('rewrite')}>潤飾語氣</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle('expand')}>擴寫成段落</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle('summarize')}>壓成摘要</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle('bulletize')}>整理成清單</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCustomOpen(true)}>自訂指令…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>自訂 AI 指令</DialogTitle>
            <DialogDescription className="text-xs">
              範例：「把這段加上一個風險警告」、「改寫成新手能懂的口氣」、「縮成 100 字」
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder="想對這段文字做什麼？"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)}>取消</Button>
            <Button
              disabled={!instruction.trim() || busy}
              onClick={async () => {
                const ins = instruction.trim();
                setCustomOpen(false);
                setInstruction('');
                await handle('custom', ins);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : '套用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
