export const modalityCodes = ['XR', 'SPECIALXRAY', 'CT', 'MR', 'MG', 'PT', 'US'] as const;
export function modalityCode(value: string) {
 const code = value.trim().toUpperCase().replace(/[ _=-]/g, '');
 if (['XR','XRAY','CR','DX','DR'].includes(code)) return 'XR';
 if (code === 'MRI') return 'MR';
 if (['MG','MAMMO','MAMMOGRAPHY'].includes(code)) return 'MG';
 if (['PT','PET','PETCT','NM','NMR','NUCLEARMEDICINE'].includes(code)) return 'PT';
 if (['US','USG','ULTRASOUND'].includes(code)) return 'US';
 return code;
}
export function modalityLabel(value: string) {
 return value.split(',').map(part => {
  const code = modalityCode(part);
  return ({ XR:'X-Ray', MR:'MRI', MG:'Mammography', PT:'PET-CT', US:'USG', SPECIALXRAY:'Special X-Ray' } as Record<string,string>)[code] || part.trim();
 }).join(', ');
}
export function modalityMatchesCode(value: string, selected: string) {
 return value.split(',').some(part => modalityCode(part) === modalityCode(selected));
}

export const uploadModalityCodes = ['XRAY', 'SPECIALXRAY', 'CT', 'MRI', 'MG', 'PT', 'US'] as const;
export function uploadDicomModality(value: string) {
 const code = modalityCode(value);
 return code === 'XR' || code === 'SPECIALXRAY' ? 'DX' : code;
<<<<<<< HEAD
}
=======
}
>>>>>>> af9be0fa30c8cbd62724b1fe52224d5da5b8c3dd
