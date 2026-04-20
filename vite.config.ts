import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const widget = process.env.WIDGET;
if (!widget) throw new Error('WIDGET env var is required');

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), viteSingleFile()],
  build: {
    rollupOptions: { input: `widgets/${widget}/index.html` },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
}));
