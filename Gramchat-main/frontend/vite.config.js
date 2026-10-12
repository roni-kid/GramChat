/* global process */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const backend = process.env.BACKEND_URL || "http://localhost:5001";

// In dev the browser talks only to Vite; /api and /socket.io are proxied to the backend.
// That keeps everything same-origin (cookies just work) and means opening
// http://<your-pc-ip>:5173 from a phone needs no extra configuration.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      "/api": { target: backend, changeOrigin: false },
      "/socket.io": { target: backend, ws: true, changeOrigin: false },
    },
  },
});
