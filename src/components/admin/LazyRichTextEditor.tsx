import { lazy, Suspense, type ComponentProps } from "react";
import { Loader2 } from "lucide-react";

/**
 * Lazy wrapper for RichTextEditor (tiptap, ~150 KB gz).
 *
 * Why: `SignalEditor.tsx` instantiates the editor in 5 places. Importing it
 * directly forces tiptap into the admin entry chunk even for pages that
 * never open the editor. This wrapper shares one dynamic chunk across all
 * call sites and provides its own Suspense boundary so the rest of the
 * editor form stays interactive while tiptap downloads.
 */
const Inner = lazy(() =>
  import("@/components/admin/RichTextEditor").then((m) => ({ default: m.RichTextEditor })),
);

type RichTextEditorProps = ComponentProps<typeof Inner>;

export function LazyRichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[140px] rounded-md border border-input bg-background">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Inner {...props} />
    </Suspense>
  );
}
