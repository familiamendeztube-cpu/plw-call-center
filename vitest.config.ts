import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.tsx'],
      // Testing Library only cleans up between tests when it finds a global afterEach.
      globals: true,
      // Blank Supabase settings make a stray call fail instead of reaching the live project.
      env: { VITE_PLW_AUTH_MODE: 'demo', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    },
  }),
);
