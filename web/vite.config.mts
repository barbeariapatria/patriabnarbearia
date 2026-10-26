import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Compila a página inicial (React + Tailwind) como um "widget" embutido no painel em /public/bento
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: path.resolve(__dirname, "../public/bento"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "src/main.tsx"),
      name: "BarberBento",
      formats: ["iife"],
      fileName: () => "bento.js",
    },
    rollupOptions: { output: { assetFileNames: "bento.[ext]" } },
  },
});
