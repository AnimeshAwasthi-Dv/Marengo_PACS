// Renders a downscaled JPEG preview of one DICOM image, off the API event loop.
// Plain ESM (not TypeScript) so it loads in a worker thread without depending on the tsx loader.
import { createRequire } from 'node:module'
import { parentPort } from 'node:worker_threads'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const { DicomImage, NativePixelDecoder } = require('dcmjs-imaging')
const ready = NativePixelDecoder.initializeAsync({ webAssemblyModulePathOrUrl: require.resolve('dcmjs-imaging/build/dcmjs-native-codecs.wasm') })

parentPort.on('message', async ({ id, buffer, maxSize }) => {
  try {
    await ready
    const rendered = new DicomImage(buffer).render({ frame: 0, renderOverlays: false })
    const jpeg = await sharp(Buffer.from(rendered.pixels), { raw: { width: rendered.width, height: rendered.height, channels: 4 } })
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
    parentPort.postMessage({ id, jpeg, width: rendered.width, height: rendered.height })
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
