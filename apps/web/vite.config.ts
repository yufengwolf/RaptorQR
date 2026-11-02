import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    preact({
      resolveModuleFormat: false,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/tests/**/*.test.ts'],
    setupFiles: ['src/tests/setup.ts'],
  },
  worker: {
    format: 'es',
  },
  server: {
    // 个人本地项目：允许手机/局域网通过 IP 访问开发服务器，关闭 host 校验
    allowedHosts: true,
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
