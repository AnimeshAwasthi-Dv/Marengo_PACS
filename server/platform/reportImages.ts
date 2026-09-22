import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

export function encodeBmp(pixels: Buffer, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 3) throw new Error('Invalid RGB image');
  const stride = Math.ceil(width * 3 / 4) * 4;
  const buffer = Buffer.alloc(54 + stride * height);
  buffer.write('BM'); buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14); buffer.writeInt32LE(width, 18); buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28); buffer.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (y * width + x) * 3;
    const destination = 54 + (height - 1 - y) * stride + x * 3;
    buffer[destination] = pixels[source + 2]; buffer[destination + 1] = pixels[source + 1]; buffer[destination + 2] = pixels[source];
  }
  return buffer;
}
async function writeBmp(input: string | Buffer, destination: string) {
  const { data, info } = await sharp(input).flatten({ background: '#fff' }).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  await writeFile(destination, encodeBmp(data, info.width, info.height));
}
export async function pngToBmp(source: string, destination: string) { await writeBmp(source, destination); }
export async function renderTextBmp(lines: string[], destination: string) {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const height = Math.max(1754, 190 + lines.length * 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="${height}"><rect width="100%" height="100%" fill="white"/><g font-family="DejaVu Sans" fill="black"><text x="72" y="80" font-size="28">Radiology Report</text>${lines.map((line, index) => `<text x="72" y="${150 + index * 28}" font-size="18">${escape(line)}</text>`).join('')}</g></svg>`;
  await writeBmp(Buffer.from(svg), destination);
}
