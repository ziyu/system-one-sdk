import { register } from 'node:module';

// Source integration tests exercise the checked-out implementations together.
// Installed consumer tests deliberately do not load this resolver.
register('./workspace-test-loader.mjs', import.meta.url);
