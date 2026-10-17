import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      "/admin": { target: "http://localhost:9000", changeOrigin: true },
      "/auth": { target: "http://localhost:9000", changeOrigin: true },
      "/store": { target: "http://localhost:9000", changeOrigin: true },
      "/uploads": { target: "http://localhost:9000", changeOrigin: true },
    },
  },
})
