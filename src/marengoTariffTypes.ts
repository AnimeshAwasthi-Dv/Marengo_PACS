export type MarengoTariffRate = {
  id: string;
  modality: 'X RAY' | 'CT' | 'MRI' | 'NMR';
  bodyPart: string;
  studies: string;
  chargeType: 'BASE' | 'ADDITIONAL_VIEW' | 'ADDITIONAL_STUDY' | 'PROTOCOL' | 'ADD_ON';
  unit: 'First view' | 'Additional view' | 'Study' | 'Side' | 'Additional study' | 'Protocol' | 'Additional item';
  amountMinor: number;
  note?: string;
};

export type MarengoTariff = {
  id: string;
  name: string;
  currency: 'INR';
  status: 'DRAFT';
  effectiveFrom: null;
  scope: 'MARENGO';
  pendingConfirmations: string[];
  rates: MarengoTariffRate[];
};
