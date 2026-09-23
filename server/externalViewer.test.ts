import test from 'node:test';
import assert from 'node:assert/strict';
import { externalViewerSession } from './viewer/externalViewer';

test('external viewer is unavailable until configured and does not guess a study', () => {
  assert.equal(externalViewerSession({ studyInstanceUid: '1.2.3' }, '').enabled, false);
  assert.equal(externalViewerSession({}, 'https://viewer.example/view?uid={studyInstanceUid}').enabled, false);
  assert.equal(externalViewerSession({ studyInstanceUid: 'x&patient=other' }, 'https://viewer.example/{studyInstanceUid}').enabled, false);
});
test('external viewer URL carries encoded study context without portal credentials', () => {
  const session = externalViewerSession({ studyInstanceUid: '1.2.3', reportId: 'report/1?x=2' }, 'https://viewer.example/view?uid={studyInstanceUid}&report={reportId}');
  assert.equal(session.enabled, true);
  const url = new URL(session.viewerUrl!);
  assert.equal(url.searchParams.get('uid'), '1.2.3');
  assert.equal(url.searchParams.get('report'), 'report/1?x=2');
  assert.equal(externalViewerSession({ studyInstanceUid: '1.2.3' }, 'https://viewer.example/{studyInstanceUid}/{reportId}').enabled, false);
});
test('DICOM viewer service base URL is not treated as a direct StudyInstanceUID template', () => {
  const previousTemplate = process.env.EXTERNAL_VIEWER_URL_TEMPLATE;
  const previousViewerUrl = process.env.DICOM_VIEWER_API_URL;
  try {
    process.env.EXTERNAL_VIEWER_URL_TEMPLATE = '';
    process.env.DICOM_VIEWER_API_URL = 'http://13.206.223.5:3000';
    const session = externalViewerSession({ studyInstanceUid: '1.2.3' });
    assert.equal(session.enabled, false);
  } finally {
    process.env.EXTERNAL_VIEWER_URL_TEMPLATE = previousTemplate;
    process.env.DICOM_VIEWER_API_URL = previousViewerUrl;
  }
});
test('external viewer rejects unsafe or ambiguous URL configuration', () => {
  for (const template of ['javascript:{studyInstanceUid}', 'https://user:secret@viewer.example/{studyInstanceUid}', 'https://viewer.example/', 'https://viewer.example/{studyInstanceUid}/{unknown}']) {
    assert.throws(() => externalViewerSession({ studyInstanceUid: '1.2.3' }, template));
  }
});
