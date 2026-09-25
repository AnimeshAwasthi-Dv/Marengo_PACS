// Minimal typing for the parts of dcmjs QuickView uses (the package ships no TypeScript types).
declare module 'dcmjs' {
  export const data: { DicomMetaDictionary: { nameMap: Record<string, { tag?: string; vr?: string }> } };
}
