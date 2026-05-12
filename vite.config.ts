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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/lucide-react")) return "vendor-lucide";
          if (id.includes("node_modules/@supabase")) return "vendor-supabase";
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react-router") ||
            id.includes("node_modules/scheduler")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@tanstack")) return "vendor-tanstack";
        },
      },
    },
  },
}));
