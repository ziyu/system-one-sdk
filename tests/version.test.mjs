import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInitialVersions } from '../scripts/version.mjs';

const workspace = version => [{ directory: 'new-package', manifest: { name: '@system-one-ai/new-package', version } }];

test('unreleased packages start at 0.0.0 unless already in the release batch', () => {
  validateInitialVersions(workspace('0.0.0'), { packages: [] }, []);
  validateInitialVersions(workspace('0.1.0'), { packages: [{ name: '@system-one-ai/new-package', version: '0.1.0' }] }, []);
  validateInitialVersions(workspace('0.6.0'), { packages: [] }, ['new-package-v0.5.0']);
  assert.throws(() => validateInitialVersions(workspace('0.6.0'), { packages: [] }, []), /start it at 0\.0\.0/);
  assert.throws(() => validateInitialVersions(workspace('0.1.0'), { packages: [{ name: '@system-one-ai/new-package', version: '0.7.0' }] }, []), /start it at 0\.0\.0/);
});
