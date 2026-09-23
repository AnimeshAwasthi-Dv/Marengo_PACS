import assert from 'node:assert/strict';
import test from 'node:test';
import { holdSpecialXrayForManualSubmission, isSpecialXrayStudy } from '../src/specialXray';
import { inferBridgeServiceType } from './uploadPipeline';

const investigations = [
  ['12317', 'X-ray Barium Swallow'],
  ['12326', 'Xray Micturating Cystourethrogram (MCU)'],
  ['12328', 'X-ray Retrograde Genitourethrogram (RGU)'],
  ['27212', 'X-Ray Procedure Ascending Urethrogram ( A U G )'],
  ['27213', 'X-Ray Procedure Barium Enema'],
  ['27214', 'X-Ray Procedure Barium Meal Followup'],
  ['27215', 'X-Ray Procedure Barium Meal For Osd'],
  ['27216', 'X-Ray Procedure Contrast swallow'],
  ['27217', 'X-Ray Procedure Dye Study'],
  ['27218', 'X-Ray Procedure Fistulogram'],
  ['27219', 'X-Ray Procedure Fluoro Screening'],
  ['27220', 'X-Ray Procedure Fluroscopy Guidance'],
  ['27221', 'X-Ray Procedure I V U'],
  ['27222', 'X-Ray Procedure M C U'],
  ['27223', 'X-Ray Procedure Micturating urethrogram (M C U)'],
  ['27224', 'X-Ray Procedure Oral Water Soluble Contrast Study'],
];

test('all 16 supplied procedures and codes are Special X-rays and held even on an ordinary X-ray route', () => {
  for (const [code, name] of investigations) {
    for (const studyDescription of [name, name.toUpperCase(), `Investigation ${code}`]) {
      for (const modality of ['DX', 'CR', 'RF']) {
        const study = { modalities: [modality], studyDescription };
        assert.equal(isSpecialXrayStudy(study), true, studyDescription);
        assert.equal(inferBridgeServiceType(study), 'special-xray-contrast-media', studyDescription);
        assert.equal(holdSpecialXrayForManualSubmission(study, 'xray'), true, studyDescription);
      }
    }
  }
});

test('abbreviations tolerate spaces, punctuation, and surrounding description text', () => {
  for (const studyDescription of ['MCU', 'R G U', 'A.U.G.', 'IVU', 'pre-op fistulogram right', 'fluoroscopy guidance']) {
    assert.equal(isSpecialXrayStudy({ modalities: ['DX'], studyDescription }), true, studyDescription);
  }
});

test('ordinary X-rays and non-X-ray modalities keep their existing processing rules', () => {
  for (const studyDescription of ['Chest PA', 'Left knee AP lateral', 'Pelvis', 'clavicular fracture', '123170']) {
    const study = { modalities: ['DX'], studyDescription };
    assert.equal(inferBridgeServiceType(study), 'xray');
    assert.equal(holdSpecialXrayForManualSubmission(study, 'xray'), false);
  }
  for (const modality of ['CT', 'MR', 'US', 'MG', 'PT', 'NM']) {
    assert.equal(isSpecialXrayStudy({ modalities: [modality], studyDescription: 'Barium contrast study' }), false);
  }
  assert.equal(holdSpecialXrayForManualSubmission({ modalities: ['DX'], studyDescription: 'Study' }, 'special-xray-contrast-media'), true);
});
