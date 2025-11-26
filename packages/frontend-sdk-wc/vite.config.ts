import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'QccAiChatbot',
      formats: ['es', 'umd'],
      fileName: (format) =>
        format === 'es' ? 'qcc-ai-chatbot.js' : 'qcc-ai-chatbot.umd.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          const ext = assetInfo.name?.split('.').pop();
          if (ext === 'css') {
            return 'chatbot.css';
          }
          return assetInfo.name || 'assets/[name][extname]';
        },
      },
    },
  },
});


