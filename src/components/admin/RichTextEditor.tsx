import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { cn } from '@/lib/utils';
import { Bold, Italic, List, ListOrdered, Quote, Heading3, Link as LinkIcon, Undo2, Redo2, Image as ImageIcon, Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AIAssistMenu, AIAssistMode } from './AIAssistMenu';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  onAIAssist?: (mode: AIAssistMode, currentHtml: string, instruction?: string) => Promise<string>;
  aiField?: 'reason_summary' | 'reason_detail' | 'risk_notes' | 'learning_points' | 'overall_summary';
  uploadFolder?: string;
  className?: string;
}

type UploadItem = {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'failed';
  error?: string;
};

export const RichTextEditor = ({ value, onChange, placeholder, minHeight = 100, onAIAssist, aiField, uploadFolder, className }: RichTextEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pushUpload = (name: string): string => {
    const id = newId();
    setUploads((u) => [...u, { id, name, status: 'uploading' }]);
    return id;
  };
  const updateUpload = (id: string, patch: Partial<UploadItem>) => {
    setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (patch.status === 'done') {
      setTimeout(() => setUploads((u) => u.filter((x) => x.id !== id)), 1500);
    }
  };
  const dismissUpload = (id: string) => setUploads((u) => u.filter((x) => x.id !== id));

  // 上傳單一 Blob/File，回傳公開 URL；失敗回 null。會自動寫進度面板。
  const uploadBlob = async (blob: Blob, filename?: string): Promise<string | null> => {
    const displayName = filename || `image-${Date.now()}.${(blob.type.split('/')[1] || 'png')}`;
    const id = pushUpload(displayName);
    if (!uploadFolder) {
      updateUpload(id, { status: 'failed', error: '尚未指定上傳資料夾' });
      toast.error('尚未指定上傳資料夾');
      return null;
    }
    if (!blob.type.startsWith('image/')) {
      updateUpload(id, { status: 'failed', error: '只能上傳圖片' });
      toast.error('只能上傳圖片');
      return null;
    }
    if (blob.size > 5 * 1024 * 1024) {
      updateUpload(id, { status: 'failed', error: '超過 5MB' });
      toast.error('圖片不能超過 5MB');
      return null;
    }
    const ext = (filename?.split('.').pop() || blob.type.split('/')[1] || 'png').toLowerCase();
    const path = `${uploadFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('signal-media').upload(path, blob, { upsert: false, contentType: blob.type });
    if (error) {
      updateUpload(id, { status: 'failed', error: error.message });
      toast.error(`上傳失敗：${error.message}`);
      return null;
    }
    const { data: pub } = supabase.storage.from('signal-media').getPublicUrl(path);
    updateUpload(id, { status: 'done' });
    return pub?.publicUrl || null;
  };

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

  // 把編輯器內所有 blob: image 換成公開 URL；用 transaction 直接改 attrs 以保留游標位置
  const replaceBlobImagesInDoc = useCallback(async (ed: any) => {
    if (!ed) return;
    // 收集 (由後往前處理，刪節點時前面位置不會位移)
    const collect = () => {
      const arr: Array<{ pos: number; src: string; size: number }> = [];
      ed.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('blob:')) {
          arr.push({ pos, src: node.attrs.src, size: node.nodeSize });
        }
      });
      return arr.reverse();
    };
    const tasks = collect();
    if (!tasks.length) return;
    setUploading(true);
    try {
      for (const t of tasks) {
        const publicUrl = await blobUrlToPublic(t.src);
        // 重新定位該節點：blob src 唯一
        let currentPos = -1;
        let currentSize = 0;
        let currentAttrs: any = null;
        ed.state.doc.descendants((node: any, pos: number) => {
          if (currentPos !== -1) return false;
          if (node.type.name === 'image' && node.attrs.src === t.src) {
            currentPos = pos;
            currentSize = node.nodeSize;
            currentAttrs = node.attrs;
            return false;
          }
        });
        if (currentPos === -1) continue;
        const tr = ed.state.tr;
        const sel = ed.state.selection;
        if (publicUrl) {
          tr.setNodeMarkup(currentPos, undefined, { ...currentAttrs, src: publicUrl });
        } else {
          tr.delete(currentPos, currentPos + currentSize);
        }
        tr.setMeta('addToHistory', false);
        ed.view.dispatch(tr);
        // 還原 selection（如果還合法）
        try {
          const { from, to } = sel;
          const docSize = ed.state.doc.content.size;
          if (from <= docSize && to <= docSize) {
            ed.commands.setTextSelection({ from: Math.min(from, docSize), to: Math.min(to, docSize) });
          }
        } catch {}
      }
    } finally {
      setUploading(false);
    }
  }, [uploadFolder]);

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
        const files = Array.from(cd.files || []).filter((f) => f.type.startsWith('image/'));
        if (files.length) {
          event.preventDefault();
          const insertPos = view.state.selection.from;
          (async () => {
            setUploading(true);
            try {
              let cursor = insertPos;
              for (const f of files) {
                const url = await uploadBlob(f, f.name);
                if (url && editor) {
                  const docSize = editor.state.doc.content.size;
                  const at = Math.min(cursor, docSize);
                  editor.chain().insertContentAt(at, { type: 'image', attrs: { src: url, alt: f.name } }).run();
                  cursor = editor.state.selection.from;
                }
              }
            } finally { setUploading(false); }
          })();
          return true;
        }
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
        // 拖放點對應的編輯器位置
        const coords = { left: (event as DragEvent).clientX, top: (event as DragEvent).clientY };
        const dropPos = view.posAtCoords(coords)?.pos ?? view.state.selection.from;
        (async () => {
          setUploading(true);
          try {
            let cursor = dropPos;
            for (const f of files) {
              const url = await uploadBlob(f, f.name);
              if (url && editor) {
                const docSize = editor.state.doc.content.size;
                const at = Math.min(cursor, docSize);
                editor.chain().insertContentAt(at, { type: 'image', attrs: { src: url, alt: f.name } }).run();
                cursor = editor.state.selection.from;
              }
            }
          } finally { setUploading(false); }
        })();
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

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
      const insertPos = editor.state.selection.from;
      const url = await uploadBlob(file, file.name);
      if (url) {
        const docSize = editor.state.doc.content.size;
        const at = Math.min(insertPos, docSize);
        editor.chain().focus().insertContentAt(at, { type: 'image', attrs: { src: url, alt: file.name } }).run();
      }
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

      {uploads.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border bg-muted/40 px-2 py-1.5 text-xs space-y-1"
        >
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              {u.status === 'uploading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
              {u.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
              {u.status === 'failed' && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
              <span className="truncate flex-1" title={u.name}>{u.name}</span>
              <span className={cn(
                'shrink-0',
                u.status === 'uploading' && 'text-muted-foreground',
                u.status === 'done' && 'text-emerald-600',
                u.status === 'failed' && 'text-destructive',
              )}>
                {u.status === 'uploading' && '上傳中…'}
                {u.status === 'done' && '完成'}
                {u.status === 'failed' && (u.error || '失敗')}
              </span>
              {u.status !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => dismissUpload(u.id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="關閉"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
};
