import assert from 'node:assert/strict';
import test from 'node:test';
import { scopedShareToken, scopedShareReportId, verifyShareScope } from './shareScope';

test('report-only and image shares have independently authenticated scopes', () => {
  for (const includeViewer of [true, false]) {
    const token = scopedShareToken('report-123', 'test-secret', includeViewer);
    assert.equal(scopedShareReportId(token), 'report-123');
    assert.deepEqual(verifyShareScope(token, 'report-123', 'test-secret'), { includeViewer });
    assert(!token.includes('test-secret'));
    assert.equal(verifyShareScope(token, 'report-456', 'test-secret'), null);
    assert.equal(verifyShareScope(token, 'report-123', 'rotated-secret'), null);
  }
});

test('changing scope or signature cannot elevate a report-only share', () => {
  const token = scopedShareToken('report-123', 'test-secret', false);
  assert.equal(verifyShareScope(token.replace('.report.', '.images.'), 'report-123', 'test-secret'), null);
  assert.equal(verifyShareScope(token + 'x', 'report-123', 'test-secret'), null);
  assert.equal(scopedShareReportId('legacy-opaque-token'), null);
  assert.equal(verifyShareScope('s1.invalid.admin.bad', 'report-123', 'test-secret'), null);
});
