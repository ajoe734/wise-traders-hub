import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const APP_VERSION = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function appVersionPlugin(): Plugin {
  return {
    name: "app-version-plugin",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: APP_VERSION, builtAt: new Date().toISOString() }),
      });
    },
    transformIndexHtml(html) {
      return html.replace(
        /<head>/,
        `<head>\n    <meta name="app-version" content="${APP_VERSION}" />`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    host: "::",
    port: 8080,
    ...(mode === "development" && {
      allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.io", ".loca.lt"],
    }),
  },
  plugins: [react(), appVersionPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Batch1-#4: prod-only — strip console.* (keep console.error for monitoring)
  // and debugger statements. Dev keeps everything for debugging.
  esbuild: {
    drop: mode === "production" ? ["debugger"] : [],
    pure: mode === "production" ? ["console.log", "console.info", "console.debug", "console.warn"] : [],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Batch1-#3: force-chunk lucide-react so per-route icon imports
          // don't end up duplicated in every page chunk.
          if (id.includes("lucide-react")) return "vendor-lucide";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          if (id.includes("@tanstack")) return "vendor-tanstack";
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "vendor-tiptap";
          if (id.includes("recharts") || id.includes("/d3-") || id.includes("victory-vendor"))
            return "vendor-recharts";
          // P5-B: split radix — landing only needs slot/tooltip/toast/primitive helpers
          if (id.includes("@radix-ui")) {
            if (
              id.includes("react-slot") ||
              id.includes("react-tooltip") ||
              id.includes("react-toast") ||
              id.includes("react-portal") ||
              id.includes("react-primitive") ||
              id.includes("react-presence") ||
              id.includes("react-compose-refs") ||
              id.includes("react-context") ||
              id.includes("react-use-") ||
              id.includes("react-id")
            ) {
              return "vendor-radix-core";
            }
            return "vendor-radix-extra";
          }
          if (
            id.includes("date-fns") ||
            id.includes("/zod/") ||
            id.includes("dompurify") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge") ||
            id.includes("class-variance-authority")
          ) {
            return "vendor-utils";
          }
        },
      },
    },
  },
}));
