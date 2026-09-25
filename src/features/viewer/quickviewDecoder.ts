import type { WorkerRequest, WorkerResponse } from './quickview.worker';
import type { ProbeValue, RegionShape, RegionStats, TagRow } from './quickviewPixels';

export type LoadedImage = { width: number; height: number; frames: number };
export type RenderedImage = { width: number; height: number; pixels: ArrayBuffer; windowWidth?: number; windowCenter?: number };
type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void };

/** Promise-based wrapper around the QuickView decoding worker. One instance per open viewer. */
export class QuickViewDecoder {
  private readonly worker = new Worker(new URL('./quickview.worker.ts', import.meta.url), { type: 'module' });
  private readonly loads = new Map<number, Promise<LoadedImage>>();
  private readonly pendingLoads = new Map<number, Pending<LoadedImage>>();
  private readonly pendingRenders = new Map<number, Pending<RenderedImage>>();
  // Probe, ROI statistics and tag requests share one request-id space with renders.
  private readonly pendingQueries = new Map<number, Pending<unknown>>();
  private nextRequestId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
    this.worker.onerror = event => this.failAll(new Error(event.message || 'The image decoder stopped unexpectedly'));
  }

  /** Fetches (once) and decodes one image. Failed loads can be retried. */
  load(key: number, fetchBuffer: () => Promise<ArrayBuffer>) {
    let loading = this.loads.get(key);
    if (!loading) {
      loading = fetchBuffer().then(buffer => new Promise<LoadedImage>((resolve, reject) => {
        this.pendingLoads.set(key, { resolve, reject });
        this.post({ type: 'load', key, buffer }, [buffer]);
      }));
      loading.catch(() => this.loads.delete(key));
      this.loads.set(key, loading);
    }
    return loading;
  }

  render(key: number, frame: number, windowWidth?: number, windowCenter?: number) {
    const requestId = this.nextRequestId++;
    return new Promise<RenderedImage>((resolve, reject) => {
      this.pendingRenders.set(requestId, { resolve, reject });
      this.post({ type: 'render', key, requestId, frame, windowWidth, windowCenter });
    });
  }

  stats(key: number, frame: number, shape: RegionShape) {
    return this.query<RegionStats | null>({ type: 'stats', key, requestId: 0, frame, shape });
  }

  probe(key: number, frame: number, x: number, y: number) {
    return this.query<ProbeValue | null>({ type: 'probe', key, requestId: 0, frame, x, y });
  }

  tags(key: number) {
    return this.query<TagRow[]>({ type: 'tags', key, requestId: 0 });
  }

  private query<T>(message: Extract<WorkerRequest, { requestId: number }>) {
    const requestId = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pendingQueries.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      this.post({ ...message, requestId });
    });
  }

  dispose() {
    this.worker.terminate();
    this.failAll(new Error('Viewer closed'));
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  private receive(message: WorkerResponse) {
    if (message.type === 'loaded') {
      this.pendingLoads.get(message.key)?.resolve({ width: message.width, height: message.height, frames: message.frames });
      this.pendingLoads.delete(message.key);
    } else if (message.type === 'stats' || message.type === 'probe' || message.type === 'tags') {
      const value = message.type === 'stats' ? message.stats : message.type === 'probe' ? message.probe : message.tags;
      this.pendingQueries.get(message.requestId)?.resolve(value);
      this.pendingQueries.delete(message.requestId);
    } else if (message.type === 'rendered') {
      this.pendingRenders.get(message.requestId)?.resolve(message);
      this.pendingRenders.delete(message.requestId);
    } else {
      const error = new Error(message.message);
      if (message.requestId !== undefined) {
        this.pendingRenders.get(message.requestId)?.reject(error);
        this.pendingRenders.delete(message.requestId);
        this.pendingQueries.get(message.requestId)?.reject(error);
        this.pendingQueries.delete(message.requestId);
      } else {
        this.pendingLoads.get(message.key)?.reject(error);
        this.pendingLoads.delete(message.key);
      }
    }
  }

  private failAll(error: Error) {
    for (const pending of [...this.pendingLoads.values(), ...this.pendingRenders.values(), ...this.pendingQueries.values()]) pending.reject(error);
    this.pendingLoads.clear();
    this.pendingRenders.clear();
    this.pendingQueries.clear();
  }
}
