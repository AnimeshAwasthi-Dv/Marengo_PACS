import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBreastXrayModalities } from '../src/mammography';
import { inferBridgeServiceType } from './uploadPipeline';

test('Breast body part classifies incoming X-rays as mammography regardless of description', () => {
  for (const modality of ['DX', 'CR', 'XR', 'XRAY', 'X-RAY', ' dx ']) {
    for (const bodyPartExamined of ['Breast', 'BREAST', ' breast ', 'BREAST\0']) {
      assert.deepEqual(classifyBreastXrayModalities([modality], bodyPartExamined), ['MG']);
      assert.equal(inferBridgeServiceType({ modalities: [modality], bodyPartExamined, studyDescription: 'X-ray Chest PA' }), 'mammography');
      assert.equal(inferBridgeServiceType({ modalities: [modality], bodyPartExamined, studyDescription: 'Dye Study' }), 'mammography');
    }
  }
});

test('other body parts and non-X-ray modalities retain their classification', () => {
  for (const bodyPartExamined of [undefined, null, '', 'Chest', 'Breastbone']) {
    assert.deepEqual(classifyBreastXrayModalities(['DX'], bodyPartExamined), ['DX']);
  }
  for (const modality of ['CT', 'MR', 'US', 'PT', 'NM', 'MG']) {
    assert.deepEqual(classifyBreastXrayModalities([modality], 'Breast'), [modality]);
  }
  assert.deepEqual(classifyBreastXrayModalities(['DX', 'CR', 'MG'], 'Breast'), ['MG']);
  assert.equal(inferBridgeServiceType({ modalities: ['CT'], bodyPartExamined: 'Breast' }), 'ct');
  assert.equal(inferBridgeServiceType({ modalities: ['DX'], bodyPartExamined: 'Chest' }), 'xray');
});
