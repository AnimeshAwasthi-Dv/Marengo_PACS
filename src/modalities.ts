export const modalityCodes = ['XR', 'CT', 'MR', 'MG', 'PT', 'US', 'SPECIALXRAY', 'NM'] as const;
export function modalityCode(value: string) {
 const code = value.trim().toUpperCase().replace(/[ _-]/g, '');
 if (['XR','XRAY','CR','DX','DR'].includes(code)) return 'XR';
 if (code === 'MRI') return 'MR';
 if (['MG','MAMMO','MAMMOGRAPHY'].includes(code)) return 'MG';
 if (['PT','PET','PETCT'].includes(code)) return 'PT';
 if (['US','USG','ULTRASOUND'].includes(code)) return 'US';
 if (code === 'NMR') return 'NM';
 return code;
}
export function modalityLabel(value: string) {
 return value.split(',').map(part => {
  const code = modalityCode(part);
  return ({ XR:'X-ray', MR:'MRI', MG:'Mammography', PT:'PET-CT', US:'USG', NM:'Nuclear medicine', SPECIALXRAY:'Special x-ray' } as Record<string,string>)[code] || part.trim();
 }).join(', ');
}
export function modalityMatchesCode(value: string, selected: string) {
 return value.split(',').some(part => modalityCode(part) === modalityCode(selected));
}
