import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site from /<repo-name>/.
// The deploy workflow sets VITE_BASE from the repository name; locally the
// default below is used, so the dev server runs at http://localhost:5173/tadawul-pulse/
export default defineConfig({
  base: process.env.VITE_BASE ?? "/tadawul-pulse/",
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          recharts: ["recharts"],
          lwc: ["lightweight-charts"],
        },
      },
    },
  },
});
