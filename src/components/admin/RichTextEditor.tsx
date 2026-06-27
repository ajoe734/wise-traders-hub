import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { cn } from '@/lib/utils';
import { Bold, Italic, List, ListOrdered, Quote, Heading3, Link as LinkIcon, Undo2, Redo2, Image as ImageIcon, Loader2, CheckCircle2, XCircle, X, RotateCcw, Ban } from 'lucide-react';
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

type UploadStatus = 'uploading' | 'done' | 'failed' | 'cancelled';
type UploadItem = {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string;
  blob?: Blob;
  insert?: (publicUrl: string) => void;
  controller?: AbortController;
};

export const RichTextEditor = ({ value, onChange, placeholder, minHeight = 100, onAIAssist, aiField, uploadFolder, className }: RichTextEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  // 用 ref 持有最新狀態，避免異步流程拿到舊的 closure
  const uploadsRef = useRef<UploadItem[]>([]);
  uploadsRef.current = uploads;

  const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const setItem = (id: string, patch: Partial<UploadItem>) => {
    setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const dismissUpload = (id: string) => {
    const item = uploadsRef.current.find((x) => x.id === id);
    if (item?.status === 'uploading') item.controller?.abort();
    setUploads((u) => u.filter((x) => x.id !== id));
  };
  const cancelUpload = (id: string) => {
    const item = uploadsRef.current.find((x) => x.id === id);
    if (!item || item.status !== 'uploading') return;
    item.controller?.abort();
    setItem(id, { status: 'cancelled', error: '已取消' });
  };

  // 執行單一上傳；不會插入失敗的圖片到編輯器，由 insert callback 決定如何安放成功的 URL
  const performUpload = useCallback(async (id: string) => {
    const current = uploadsRef.current.find((x) => x.id === id);
    if (!current || !current.blob) return;
    const blob = current.blob;
    const name = current.name;

    if (!uploadFolder) {
      setItem(id, { status: 'failed', error: '尚未指定上傳資料夾' });
      return;
    }
    if (!blob.type.startsWith('image/')) {
      setItem(id, { status: 'failed', error: '只能上傳圖片' });
      return;
    }
    if (blob.size > 5 * 1024 * 1024) {
      setItem(id, { status: 'failed', error: '超過 5MB' });
      return;
    }

    const ext = (name.split('.').pop() || blob.type.split('/')[1] || 'png').toLowerCase();
    const path = `${uploadFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    setUploading(true);
    try {
      const { error } = await supabase.storage.from('signal-media').upload(path, blob, { upsert: false, contentType: blob.type });
      // 上傳途中若已被取消，忽略結果
      const after = uploadsRef.current.find((x) => x.id === id);
      if (!after || after.status === 'cancelled') return;
      if (error) {
        setItem(id, { status: 'failed', error: error.message });
        return;
      }
      const { data: pub } = supabase.storage.from('signal-media').getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) {
        setItem(id, { status: 'failed', error: '取得公開網址失敗' });
        return;
      }
      try { current.insert?.(publicUrl); } catch (e: any) {
        setItem(id, { status: 'failed', error: e?.message || '插入失敗' });
        return;
      }
      setItem(id, { status: 'done' });
      setTimeout(() => setUploads((u) => u.filter((x) => x.id !== id)), 1500);
    } catch (e: any) {
      const after = uploadsRef.current.find((x) => x.id === id);
      if (after?.status === 'cancelled') return;
      setItem(id, { status: 'failed', error: e?.message || String(e) });
    } finally {
      setUploading(false);
    }
  }, [uploadFolder]);

  const retryUpload = useCallback((id: string) => {
    setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: 'uploading', error: undefined, controller: new AbortController() } : x)));
    // 等下一個 tick，讓 ref 同步後再跑
    setTimeout(() => performUpload(id), 0);
  }, [performUpload]);

  // 排入新上傳並立刻執行
  const enqueueUpload = useCallback((blob: Blob, filename: string | undefined, insert: (url: string) => void) => {
    const displayName = filename || `image-${Date.now()}.${(blob.type.split('/')[1] || 'png')}`;
    const id = newId();
    const item: UploadItem = {
      id, name: displayName, status: 'uploading', blob, insert,
      controller: new AbortController(),
    };
    setUploads((u) => [...u, item]);
    setTimeout(() => performUpload(id), 0);
    return id;
  }, [performUpload]);

  // 把編輯器內所有 blob: image 換成公開 URL（保留游標位置；失敗或取消時保留 blob 圖以便重試）
  const replaceBlobImagesInDoc = useCallback((ed: any) => {
    if (!ed) return;
    const arr: Array<{ src: string }> = [];
    ed.state.doc.descendants((node: any) => {
      if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('blob:')) {
        arr.push({ src: node.attrs.src });
      }
    });
    if (!arr.length) return;

    const makeInsert = (blobSrc: string) => (publicUrl: string) => {
      if (!ed) return;
      let foundPos = -1;
      let foundAttrs: any = null;
      ed.state.doc.descendants((node: any, pos: number) => {
        if (foundPos !== -1) return false;
        if (node.type.name === 'image' && node.attrs.src === blobSrc) {
          foundPos = pos; foundAttrs = node.attrs; return false;
        }
      });
      if (foundPos === -1) return;
      const sel = ed.state.selection;
      const tr = ed.state.tr.setNodeMarkup(foundPos, undefined, { ...foundAttrs, src: publicUrl });
      tr.setMeta('addToHistory', false);
      ed.view.dispatch(tr);
      try {
        const docSize = ed.state.doc.content.size;
        ed.commands.setTextSelection({ from: Math.min(sel.from, docSize), to: Math.min(sel.to, docSize) });
      } catch {}
    };

    (async () => {
      for (const t of arr) {
        try {
          const res = await fetch(t.src);
          const b = await res.blob();
          enqueueUpload(b, undefined, makeInsert(t.src));
        } catch (e: any) {
          toast.error(`無法讀取 blob 圖片：${e?.message || e}`);
        }
      }
    })();
  }, [enqueueUpload]);

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
          for (const f of files) {
            const pos = insertPos;
            enqueueUpload(f, f.name, (url) => {
              if (!editor) return;
              const docSize = editor.state.doc.content.size;
              const at = Math.min(pos, docSize);
              editor.chain().insertContentAt(at, { type: 'image', attrs: { src: url, alt: f.name } }).run();
            });
          }
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
        const coords = { left: (event as DragEvent).clientX, top: (event as DragEvent).clientY };
        const dropPos = view.posAtCoords(coords)?.pos ?? view.state.selection.from;
        for (const f of files) {
          const pos = dropPos;
          enqueueUpload(f, f.name, (url) => {
            if (!editor) return;
            const docSize = editor.state.doc.content.size;
            const at = Math.min(pos, docSize);
            editor.chain().insertContentAt(at, { type: 'image', attrs: { src: url, alt: f.name } }).run();
          });
        }
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

  const handleImageUpload = (file: File) => {
    const insertPos = editor.state.selection.from;
    enqueueUpload(file, file.name, (url) => {
      if (!editor) return;
      const docSize = editor.state.doc.content.size;
      const at = Math.min(insertPos, docSize);
      editor.chain().insertContentAt(at, { type: 'image', attrs: { src: url, alt: file.name } }).run();
    });
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
              {u.status === 'cancelled' && <Ban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <span className="truncate flex-1" title={u.name}>{u.name}</span>
              <span className={cn(
                'shrink-0',
                u.status === 'uploading' && 'text-muted-foreground',
                u.status === 'done' && 'text-emerald-600',
                u.status === 'failed' && 'text-destructive',
                u.status === 'cancelled' && 'text-muted-foreground',
              )}>
                {u.status === 'uploading' && '上傳中…'}
                {u.status === 'done' && '完成'}
                {u.status === 'failed' && (u.error || '失敗')}
                {u.status === 'cancelled' && '已取消'}
              </span>
              {u.status === 'uploading' && (
                <button
                  type="button"
                  onClick={() => cancelUpload(u.id)}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 px-1 py-0.5 rounded hover:bg-muted"
                  aria-label="取消上傳"
                  title="取消上傳"
                >
                  <Ban className="h-3 w-3" />
                  <span>取消</span>
                </button>
              )}
              {(u.status === 'failed' || u.status === 'cancelled') && u.blob && (
                <button
                  type="button"
                  onClick={() => retryUpload(u.id)}
                  className="text-foreground inline-flex items-center gap-0.5 px-1 py-0.5 rounded hover:bg-muted"
                  aria-label="重試上傳"
                  title="重試上傳"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>重試</span>
                </button>
              )}
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
