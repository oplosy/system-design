import { defineConfig } from 'vite';

// The command line (cli/main.ts and what it loads) as plain JavaScript in dist-cli/, for `npx` and the GitHub Action.
// Files stay one folder below the package root, so paths built from import.meta.url (templates/, dist/) still resolve.
export default defineConfig({
  build: {
    ssr: 'cli/main.ts',
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node24',
    rolldownOptions: { output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' } },
  },
});
