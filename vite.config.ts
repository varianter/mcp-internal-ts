import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), viteSingleFile()],
  build: {
    rollupOptions: { input: 'widgets/findGithubAppName/index.html' },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
}));
