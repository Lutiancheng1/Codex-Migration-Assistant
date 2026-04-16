import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  }
});
