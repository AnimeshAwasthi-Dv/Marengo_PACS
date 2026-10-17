import yazl from 'yazl';
import type { AnalysisModality } from './studyAnalysis';

// XML 1.0 forbids these control characters in worksheet text.
// eslint-disable-next-line no-control-regex
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const parameters = ['Total Studies Reported', 'Total Portable X-Rays', 'Total Routine X-Rays', 'Total Off-Duty Hours Studies', 'Total On-Duty Hours Studies', 'Average TAT', 'TAT Achieved Within SLA', 'TAT Not Achieved', 'SLA Achievement %'];

export async function studyAnalysisWorkbook(input: {
  center: { name: string; code: string; location: string | null };
  range: { from: string; to: string };
  columns: { modality: AnalysisModality; values: (string | number)[] }[];
  thresholds: Record<AnalysisModality, number>;
  hasTechnicalExemptions: boolean;
}) {
  const { center, range, columns, thresholds } = input;
  const lastColumn = String.fromCharCode(66 + columns.length);
  const rows: (string | number)[][] = [
    [`${center.name} — Study Analysis`], [],
    ['Center', center.name], ['Center Code', center.code], ['Location', center.location ?? ''],
    ['Reporting Period (IST)', `${range.from} 00:00:00 to ${range.to} 23:59:59 IST`],
    ['On-Duty Hours', '09:00 to 18:00 IST (all days)'],
    ['TAT Breach Threshold', columns.map(c => `${c.modality}: >= ${thresholds[c.modality]} minutes`).join('; ')],
    ['Selection', 'Receipt window; finalized reports at download time'], [],
    ['Sr. No.', 'Parameter', ...columns.map(c => c.modality)],
    ...parameters.map((parameter, index) => [index + 1, parameter, ...columns.map(c => c.values[index])]),
    [], ['Notes', 'TAT is submission to approval. Duplicate accessions count once per center.'],
    ['', 'Only on-duty receipts from 2026-09-28 with measurable TAT can breach SLA.'],
    ['', 'Off-duty, exempt, and missing/invalid TAT cases count as Achieved, matching the source report.'],
    ...(input.hasTechnicalExemptions ? [['', 'Ahmedabad technical exemption: accession 3275071.']] : []),
  ];
  const rowXml = rows.map((row, index) => `<row r="${index + 1}" ht="${index === 0 ? 32 : index >= 21 ? 42 : 30}" customHeight="1">${row.map((value, col) => {
    const address = `${String.fromCharCode(65 + col)}${index + 1}`;
    const style = index === 0 || index === 10 ? 1 : index >= 2 && index <= 8 && col === 0 ? 2 : 0;
    // Inline strings are literal text, never spreadsheet formulas.
    return typeof value === 'number' ? `<c r="${address}" s="${style}"><v>${value}</v></c>` : `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const merges = ['A1:' + lastColumn + '1', ...Array.from({ length: 7 }, (_, index) => `B${index + 3}:${lastColumn}${index + 3}`), ...rows.slice(21).map((_, index) => `B${index + 22}:${lastColumn}${index + 22}`)];
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Study Analysis" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="11" topLeftCell="A12" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="27" customWidth="1"/><col min="2" max="2" width="40" customWidth="1"/><col min="3" max="${2 + columns.length}" width="22" customWidth="1"/></cols><sheetData>${rowXml}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`,
  };
  const zip = new yazl.ZipFile();
  const complete = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.on('error', reject);
  });
  for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`), name);
  zip.end();
  return complete;
}
