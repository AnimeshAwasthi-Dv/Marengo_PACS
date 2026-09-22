import test from 'node:test';
import assert from 'node:assert/strict';
import { marengoTariff } from './marengoTariff';

test('all 30 supplied tariff rows preserve exact INR amounts as integer paise', () => {
  assert.deepEqual(marengoTariff.rates.map(rate => rate.amountMinor / 100), [
    25, 20, 150, 55,
    225, 280, 315, 410, 355, 385, 600, 637, 900, 55,
    390, 380, 485, 525, 600, 675, 675, 225, 110, 1010, 900, 1500, 150, 65,
    505, 1390,
  ]);
  assert.equal(new Set(marengoTariff.rates.map(rate => rate.id)).size, 30);
  assert(marengoTariff.rates.every(rate => Number.isSafeInteger(rate.amountMinor) && rate.amountMinor > 0));
  assert.deepEqual(['X RAY', 'CT', 'MRI', 'NMR'].map(modality => marengoTariff.rates.filter(rate => rate.modality === modality).length), [4, 10, 14, 2]);
});

test('confirmed MRI Foot with Ankle uses its dedicated 600 rate, not MSK', () => {
  const foot = marengoTariff.rates.find(rate => rate.id === 'mri-foot-ankle')!;
  const msk = marengoTariff.rates.find(rate => rate.id === 'mri-msk')!;
  assert.equal(foot.amountMinor, 60000);
  assert.equal(msk.amountMinor, 52500);
  assert(!msk.studies.toLowerCase().includes('foot with ankle'));
  assert(!marengoTariff.pendingConfirmations.some(note => note.includes('Foot with Ankle')));
});

test('views, sides, studies and add-ons retain distinct billing units', () => {
  const byId = new Map(marengoTariff.rates.map(rate => [rate.id, rate]));
  assert.equal(byId.get('xr-first-view')!.unit, 'First view');
  assert.equal(byId.get('xr-additional-view')!.chargeType, 'ADDITIONAL_VIEW');
  assert.equal(byId.get('xr-mammography')!.unit, 'Side');
  assert.equal(byId.get('ct-additional-charges')!.chargeType, 'ADD_ON');
  assert.equal(byId.get('mri-additional-charges')!.amountMinor, 6500);
  assert.equal(byId.get('mri-brain-protocol')!.chargeType, 'PROTOCOL');
});

test('unconfirmed effective date cannot imply an active billing tariff', () => {
  assert.equal(marengoTariff.status, 'DRAFT');
  assert.equal(marengoTariff.scope, 'MARENGO');
  assert.equal(marengoTariff.currency, 'INR');
  assert.equal(marengoTariff.effectiveFrom, null);
  assert(marengoTariff.pendingConfirmations.length > 0);
});
