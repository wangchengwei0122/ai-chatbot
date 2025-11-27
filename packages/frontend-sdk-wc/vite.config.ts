import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',                // ⭐ 确保不降级 class、HTML element，自定义组件能工作
    minify: false,
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


