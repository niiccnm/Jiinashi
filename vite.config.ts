import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import electron from "vite-plugin-electron/simple";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "html-csp-injection",
      transformIndexHtml(html) {
        const devCSP =
          "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' media: blob: data: 'unsafe-inline'; connect-src 'self' ws:;";
        const prodCSP =
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' media: blob: data:; connect-src 'self';";
        const csp = process.env.NODE_ENV === "development" ? devCSP : prodCSP;
        return html.replace(
          "</head>",
          `<meta http-equiv="Content-Security-Policy" content="${csp}">\n  </head>`,
        );
      },
    },
    svelte(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["better-sqlite3", "sharp"],
            },
          },
        },
      },
      preload: {
        // Build both the main window preload and the stealth preload for the hidden window
        input: {
          preload: "electron/preload.ts",
          stealth_preload: "electron/downloader/parsers/stealth_preload.js",
        },
        vite: {
          build: {
            rollupOptions: {
              output: {
                inlineDynamicImports: false,
              },
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
