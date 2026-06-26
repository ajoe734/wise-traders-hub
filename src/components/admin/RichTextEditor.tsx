import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Bold, Italic, List, ListOrdered, Quote, Heading3, Link as LinkIcon, Undo2, Redo2, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AIAssistMenu, AIAssistMode } from './AIAssistMenu';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  /** AI 助寫：給 mode + 目前 HTML，回傳新 HTML（已包好 <p>） */
  onAIAssist?: (mode: AIAssistMode, currentHtml: string, instruction?: string) => Promise<string>;
  /** 哪個欄位（給 AI prompt 判斷語氣用） */
  aiField?: 'reason_summary' | 'reason_detail' | 'risk_notes' | 'learning_points' | 'overall_summary';
  /** 上傳圖片的資料夾（通常傳 expert.id），未傳則停用上傳 */
  uploadFolder?: string;
  className?: string;
}

export const RichTextEditor = ({ value, onChange, placeholder, minHeight = 100, onAIAssist, aiField, uploadFolder, className }: RichTextEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // 上傳單一 Blob/File，回傳公開 URL；失敗回 null
  const uploadBlob = async (blob: Blob, filename?: string): Promise<string | null> => {
    if (!uploadFolder) {
      toast.error('尚未指定上傳資料夾');
      return null;
    }
    if (!blob.type.startsWith('image/')) {
      toast.error('只能上傳圖片');
      return null;
    }
    if (blob.size > 5 * 1024 * 1024) {
      toast.error('圖片不能超過 5MB');
      return null;
    }
    const ext = (filename?.split('.').pop() || blob.type.split('/')[1] || 'png').toLowerCase();
    const path = `${uploadFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('signal-media').upload(path, blob, { upsert: false, contentType: blob.type });
    if (error) {
      toast.error(`上傳失敗：${error.message}`);
      return null;
    }
    const { data: pub } = supabase.storage.from('signal-media').getPublicUrl(path);
    return pub?.publicUrl || null;
  };

  // 從 blob: URL 取回 Blob 並上傳
  const blobUrlToPublic = async (blobUrl: string): Promise<string | null> => {
    try {
      const res = await fetch(blobUrl);
      const b = await res.blob();
      return await uploadBlob(b);
    } catch (e: any) {
      toast.error(`無法讀取 blob 圖片：${e?.message || e}`);
      return null;
    }
  };

  // 掃描編輯器內所有 image node，把 blob: src 換成已上傳的公開 URL
  const replaceBlobImagesInDoc = async (ed: any) => {
    if (!ed) return;
    const tasks: Array<{ pos: number; src: string }> = [];
    ed.state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('blob:')) {
        tasks.push({ pos, src: node.attrs.src });
      }
    });
    if (!tasks.length) return;
    setUploading(true);
    try {
      for (const t of tasks) {
        const publicUrl = await blobUrlToPublic(t.src);
        if (publicUrl) {
          const node = ed.state.doc.nodeAt(t.pos);
          if (node) {
            ed.chain().setNodeSelection(t.pos).updateAttributes('image', { ...node.attrs, src: publicUrl }).run();
          }
        } else {
          // 上傳失敗就移掉 blob 節點，避免存到 DB 後壞圖
          ed.chain().setNodeSelection(t.pos).deleteSelection().run();
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] } }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Image.configure({ inline: false, HTMLAttributes: { class: 'rounded max-w-full h-auto my-2' } }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none focus:outline-none px-3 py-2 rounded-md border bg-background',
          'prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0',
        ),
        style: `min-height:${minHeight}px`,
      },
      handlePaste: (view, event) => {
        if (!uploadFolder) return false;
        const cd = event.clipboardData;
        if (!cd) return false;
        // 1) 直接貼圖（截圖、檔案）
        const files = Array.from(cd.files || []).filter((f) => f.type.startsWith('image/'));
        if (files.length) {
          event.preventDefault();
          (async () => {
            setUploading(true);
            try {
              for (const f of files) {
                const url = await uploadBlob(f, f.name);
                if (url) editor?.chain().focus().setImage({ src: url, alt: f.name }).run();
              }
            } finally { setUploading(false); }
          })();
          return true;
        }
        // 2) 貼 HTML 內含 blob:/data: img → 讓 tiptap 先插入，下個 tick 再回收
        const html = cd.getData('text/html');
        if (html && /<img[^>]+src=["'](blob:|data:image\/)/i.test(html)) {
          setTimeout(() => { if (editor) replaceBlobImagesInDoc(editor); }, 0);
        }
        return false;
      },
      handleDrop: (view, event) => {
        if (!uploadFolder) return false;
        const dt = (event as DragEvent).dataTransfer;
        const files = Array.from(dt?.files || []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        (async () => {
          setUploading(true);
          try {
            for (const f of files) {
              const url = await uploadBlob(f, f.name);
              if (url) editor?.chain().focus().setImage({ src: url, alt: f.name }).run();
            }
          } finally { setUploading(false); }
        })();
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // 外部 reset value 時同步（例如 clearForm / 載入草稿）
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

  // 載入既有草稿時，若內含 blob: 圖（例如跨 tab 還原），順手轉成公開 URL
  useEffect(() => {
    if (!editor) return;
    if (/<img[^>]+src=["']blob:/i.test(editor.getHTML())) {
      replaceBlobImagesInDoc(editor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  const handleAI = async (mode: AIAssistMode, instruction?: string) => {
    if (!onAIAssist) return;
    const html = await onAIAssist(mode, editor.getHTML(), instruction);
    if (html) editor.commands.setContent(html);
  };

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadBlob(file, file.name);
      if (url) editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    } finally {
      setUploading(false);
    }
  };


  const ToolbarBtn = ({ active, onClick, children, title }: any) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'bg-muted text-foreground',
      )}
    >
      {children}
    </button>
  );

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-0.5 flex-wrap border rounded-md bg-muted/30 px-1 py-1">
        <ToolbarBtn title="粗體" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="斜體" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="標題" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="無序清單" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="有序清單" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="引用" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          title="連結"
          active={editor.isActive('link')}
          onClick={() => {
            const prev = editor.getAttributes('link').href as string | undefined;
            const url = window.prompt('連結網址（留空=移除）', prev || 'https://');
            if (url === null) return;
            if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
            else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }}
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="復原" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="重做" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        {uploadFolder && (
          <>
            <ToolbarBtn title="插入圖片" onClick={() => fileInputRef.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            </ToolbarBtn>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageUpload(f);
                e.target.value = '';
              }}
            />
          </>
        )}
        {onAIAssist && (
          <div className="ml-auto">
            <AIAssistMenu onPick={handleAI} field={aiField} />
          </div>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};
