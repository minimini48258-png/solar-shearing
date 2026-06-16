import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // VITE_BASE_URL を設定するとサブパス（GitHub Pages等）に対応
  base: process.env.VITE_BASE_URL || '/',
})
