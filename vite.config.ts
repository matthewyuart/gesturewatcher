import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Respect an externally assigned port (e.g. preview harnesses); 5173 default.
  server: { port: Number(process.env.PORT) || 5173 },
})
