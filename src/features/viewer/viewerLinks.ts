// The six viewer-session endpoints a study can be opened from (server/viewer/routes.ts). The standalone
// viewer page only ever fetches one of these, so a crafted link can't make it call anything else.
const VIEWER_SESSION_PATH = /^\/api\/(client\/study-sync\/available-studies|reports|radiologist\/reports|processing-jobs|patient-study-archives|public\/reports)\/[^/?#]+\/viewer-session$/;

export function isViewerSessionPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && VIEWER_SESSION_PATH.test(value);
}

/** Link for "Open viewer in a new tab": the standalone page applies the same per-study viewer choice. */
export function newTabViewerLink(endpoint: string) {
  return `/viewer?session=${encodeURIComponent(endpoint)}`;
}

export function isPublicViewerSession(endpoint: string) {
  return endpoint.startsWith('/api/public/');
}
