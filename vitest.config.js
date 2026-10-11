import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Test-only settings. Real values never appear in tests.
        bindings: {
          TEST_MIGRATIONS: migrations,
          ADMIN_EMAIL: 'owner@example.test',
          TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com',
          POLICY_AUD: 'test-audience-tag',
          SITE_PUBLIC: 'false',
          // Tests change the database between requests: never reuse a cached copy.
          PUBLIC_CACHE: 'off',
          // Tests never use local test mode, even though .dev.vars turns it on.
          LOCAL_DEV_ADMIN: 'false',
          TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
          TURNSTILE_SITE_KEY: 'test-site-key',
          IP_SALT: 'test-salt',
          EMAIL_FROM: 'requests@example.test',
          FORWARD_TO: 'owner@example.test',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
  },
});
