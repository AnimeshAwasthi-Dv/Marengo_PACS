import * as dcmjsImagingModule from 'dcmjs-imaging';
import * as dcmjsModule from 'dcmjs';
import wasmUrl from 'dcmjs-imaging/build/dcmjs-native-codecs.wasm?url';
import { pixelAccess, probeValue, regionStats, tagRows, type ProbeValue, type RegionShape, type RegionStats, type TagRow } from './quickviewPixels';

// Decodes DICOM off the main thread. Images stay cached here so window/level changes only re-render.
type DcmjsImaging = typeof import('dcmjs-imaging');
type DicomImageInstance = InstanceType<DcmjsImaging['DicomImage']>;
const dcmjsImaging = ((dcmjsImagingModule as unknown as { default?: DcmjsImaging }).default ?? dcmjsImagingModule) as DcmjsImaging;

export type WorkerRequest =
  | { type: 'load'; key: number; buffer: ArrayBuffer }
  | { type: 'render'; key: number; requestId: number; frame: number; windowWidth?: number; windowCenter?: number }
  | { type: 'release'; key: number }
  | { type: 'stats'; key: number; requestId: number; frame: number; shape: RegionShape }
  | { type: 'probe'; key: number; requestId: number; frame: number; x: number; y: number }
  | { type: 'tags'; key: number; requestId: number };

export type WorkerResponse =
  | { type: 'loaded'; key: number; width: number; height: number; frames: number }
  | { type: 'rendered'; key: number; requestId: number; width: number; height: number; pixels: ArrayBuffer; windowWidth?: number; windowCenter?: number }
  | { type: 'stats'; key: number; requestId: number; stats: RegionStats | null }
  | { type: 'probe'; key: number; requestId: number; probe: ProbeValue | null }
  | { type: 'tags'; key: number; requestId: number; tags: TagRow[] }
  | { type: 'error'; key: number; requestId?: number; message: string };

const scope = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const MAX_CACHED_IMAGES = 40;
const images = new Map<number, DicomImageInstance>();
let ready: Promise<void> | null = null;

// dcmjs-imaging loads its decoder with eval("fetch(...)"), which the app's CSP (no 'unsafe-eval') blocks.
// Inside this worker only, eval is replaced by a function that performs that one fetch and refuses
// anything else, so no code is ever compiled from strings.
(self as unknown as { eval: (code: string) => unknown }).eval = (code: string) => {
  if (/^fetch\(/.test(code.trim())) return fetch(wasmUrl);
  throw new Error('eval is not available in the QuickView decoder');
};

function initialize() {
  ready ??= dcmjsImaging.NativePixelDecoder.initializeAsync({ webAssemblyModulePathOrUrl: wasmUrl });
  return ready;
}

// Start downloading and compiling the decoder immediately, in parallel with the first image download.
void initialize().catch(() => { ready = null; });

function remember(key: number, image: DicomImageInstance) {
  images.delete(key);
  images.set(key, image);
  while (images.size > MAX_CACHED_IMAGES) images.delete(images.keys().next().value!);
}

function image(key: number) {
  const found = images.get(key);
  if (!found) throw new Error('Image is not loaded');
  return found;
}

async function handle(message: WorkerRequest) {
  await initialize();
  if (message.type === 'load') {
    const loaded = new dcmjsImaging.DicomImage(message.buffer);
    remember(message.key, loaded);
    scope.postMessage({ type: 'loaded', key: message.key, width: loaded.getWidth(), height: loaded.getHeight(), frames: loaded.getNumberOfFrames() });
  } else if (message.type === 'render') {
    const hasWindow = typeof message.windowWidth === 'number' && typeof message.windowCenter === 'number';
    const result = image(message.key).render({
      frame: message.frame,
      renderOverlays: false,
      windowLevel: hasWindow ? new dcmjsImaging.WindowLevel(Math.max(1, message.windowWidth!), message.windowCenter!) : undefined,
    });
    scope.postMessage({
      type: 'rendered', key: message.key, requestId: message.requestId, width: result.width, height: result.height, pixels: result.pixels,
      windowWidth: result.windowLevel?.getWindow(), windowCenter: result.windowLevel?.getLevel(),
    }, [result.pixels]);
  } else if (message.type === 'stats') {
    const access = pixelAccess(image(message.key) as unknown as Parameters<typeof pixelAccess>[0], message.frame);
    scope.postMessage({ type: 'stats', key: message.key, requestId: message.requestId, stats: access ? regionStats(access, message.shape) : null });
  } else if (message.type === 'probe') {
    const access = pixelAccess(image(message.key) as unknown as Parameters<typeof pixelAccess>[0], message.frame);
    scope.postMessage({ type: 'probe', key: message.key, requestId: message.requestId, probe: access ? probeValue(access, message.x, message.y) : null });
  } else if (message.type === 'tags') {
    const dcmjs = (dcmjsModule as unknown as { default?: typeof dcmjsModule }).default ?? dcmjsModule;
    scope.postMessage({ type: 'tags', key: message.key, requestId: message.requestId, tags: tagRows(image(message.key).getElements() as Record<string, unknown>, dcmjs.data.DicomMetaDictionary.nameMap) });
  } else {
    images.delete(message.key);
  }
}

scope.onmessage = event => {
  const message = event.data;
  handle(message).catch(error => scope.postMessage({
    type: 'error', key: message.key, requestId: 'requestId' in message ? message.requestId : undefined,
    message: error instanceof Error ? error.message : 'Unable to decode this image',
  }));
};
