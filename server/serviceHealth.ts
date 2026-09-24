import { prisma } from './db';
import { redisPing } from './redisCache';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { connect } from 'node:net';
type Observation = { id: string; service: string; center: string; status: string; detail: string; observedAt: string | null };
export async function collectServiceHealth(clientIds: string[] | null) {
  const scope = clientIds === null ? {} : { clientId: { in: clientIds } };
  const checks: { id: string; service: string; run: () => Promise<string> }[] = [
    { id: 'database', service: 'Database', run: async () => { await prisma.$queryRaw`SELECT 1`; return 'SELECT 1 succeeded'; } },
    { id: 'studies', service: 'Study list · /api/client/study-sync/available-studies', run: async () => `${await prisma.availableBridgeStudy.count({ where: scope })} scoped study records accessible` },
    { id: 'reports', service: 'Reports and sharing · /api/reports', run: async () => { await prisma.reportPublicShare.findFirst({ select: { id: true } }); return `${await prisma.reportReview.count({ where: scope })} scoped reports; share table accessible`; } },
    { id: 'followups', service: 'Follow-ups · /api/follow-ups', run: async () => `${await prisma.patientFollowUp.count({ where: scope })} scoped follow-ups accessible` },
    { id: 'calls', service: 'Call scheduling · /api/client/reports/:id/call-bookings', run: async () => `${await prisma.reportCallBooking.count({ where: scope })} scoped call requests accessible` },
    { id: 'audit', service: 'Audit logs · /api/admin/console/evidence', run: async () => { await prisma.auditLog.findFirst({ where: scope, select: { id: true } }); return 'Audit store accessible'; } },
    { id: 'notifications', service: 'WhatsApp / notification outbox', run: async () => {
      const events = await prisma.notificationOutbox.findMany({ where: clientIds === null ? {} : { OR: clientIds.map(id => ({ payload: { path: ['clientId'], equals: id } })) }, select: { status: true }, orderBy: { createdAt: 'desc' }, take: 100 });
      const failed = events.filter(event => ['FAILED', 'DEAD'].includes(event.status)).length;
      if (failed) throw new Error(`Health endpoint observation: ${failed} failed/dead messages in the latest 100. Check delivery configuration.`);
      return 'Outbox accessible; no failed messages in the latest 100';
    } },
  ];
  if (process.env.REDIS_URL || process.env.REDIS_HOST) checks.push({ id: 'redis', service: 'Redis cache', run: async () => { if (!await redisPing()) throw new Error('PING failed'); return 'PING succeeded'; } });
  const remote = [
    { id: 'viewer', service: 'DICOM viewer', base: process.env.DICOM_VIEWER_API_URL, health: process.env.DICOM_VIEWER_HEALTH_URL, key: process.env.DICOM_VIEWER_SERVICE_API_KEY },
    { id: 'renewist', service: 'Reporting pipeline', base: process.env.RENEWIST_OUTBOUND_API_BASE_URL, health: process.env.RENEWIST_HEALTH_URL, key: undefined },
  ];
  for (const endpoint of remote) if (endpoint.base) checks.push({ id: endpoint.id, service: endpoint.service, run: async () => {
    const target = endpoint.health || new URL(endpoint.id === 'viewer' ? '/healthz' : '/health', endpoint.base).toString();
    const response = await fetch(target, { headers: endpoint.key ? { Authorization: `Bearer ${endpoint.key}` } : {}, signal: AbortSignal.timeout(5000), redirect: 'error' });
    await response.body?.cancel();
    if (!endpoint.health && response.status === 404) return 'HTTP service reachable; health path unavailable. Configure its health URL for readiness checks';
    if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}; configure the service health URL if its path differs`);
    return `Health endpoint responded HTTP ${response.status}`;
  } });
  const credentials = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const s3 = new S3Client({ region: process.env.S3_REGION || 'us-east-1', ...(credentials ? { credentials: { accessKeyId: credentials, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '' } } : {}), ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}) });
  for (const [name, bucket] of Object.entries(process.env).filter(([key, value]) => /^S3_.*BUCKET$/.test(key) && value)) checks.push({ id: name, service: name.replace(/^S3_|_BUCKET$/g, '').replaceAll('_', ' ') + ' storage', run: async () => { await s3.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(5000) }); return 'Storage bucket reachable'; } });
  const observations = await Promise.all(checks.map(async check => {
    const started = Date.now();
    try { const detail = await check.run(); return { id: check.id, service: check.service, center: 'Platform / authorized scope', status: detail.includes('health path unavailable') ? 'Reachable' : 'Healthy', detail: `${detail} (${Date.now() - started} ms)`, observedAt: new Date().toISOString() }; }
    catch (error) { return { id: check.id, service: check.service, center: 'Platform / authorized scope', status: 'Needs attention', detail: error instanceof Error && /Health endpoint|PING/.test(error.message) ? error.message : 'Probe failed. Check service connectivity, configuration and schema.', observedAt: new Date().toISOString() }; }
  }));
  s3.destroy();
  const rows: Observation[] = [{ id: 'api', service: 'Portal API', center: 'Shared platform', status: 'Healthy', detail: 'Authenticated health request completed. Data probes below do not execute clinical actions.', observedAt: new Date().toISOString() }, ...observations];
  for (const endpoint of remote) if (!endpoint.base) rows.push({ id: endpoint.id, service: endpoint.service, center: 'Shared platform', status: 'Not configured', detail: 'Service URL is missing', observedAt: null });
  const catalog = await Promise.allSettled([
    prisma.service.findMany({ select: { id: true, name: true, enabled: true } }),
    prisma.client.findMany({ where: { kind: 'CENTER', ...(clientIds === null ? {} : { id: { in: clientIds } }) }, select: { id: true, name: true, studySyncEnabled: true, availableBridgeStudies: { select: { lastSyncedAt: true }, orderBy: { lastSyncedAt: 'desc' }, take: 1 } } }),
  ]);
  if (catalog[0].status === 'fulfilled') for (const service of catalog[0].value) rows.push({ id: service.id, service: service.name, center: 'Marengo service catalog', status: service.enabled ? 'Enabled' : 'Disabled', detail: 'Service configuration; pipeline connectivity is shown separately', observedAt: null });
  if (catalog[1].status === 'fulfilled') for (const center of catalog[1].value) rows.push({ id: center.id, service: 'Study synchronization', center: center.name, status: center.studySyncEnabled ? center.availableBridgeStudies.length ? 'Observed' : 'No activity' : 'Disabled', detail: 'Most recent study sync; not a bridge heartbeat', observedAt: center.availableBridgeStudies[0]?.lastSyncedAt.toISOString() ?? null });
  const endpoints = await prisma.pacsConfig.findMany({ where: scope, select: { id: true, clientPacsIp: true, clientPacsPort: true, receivingPort: true, ec2PublicIp: true, client: { select: { name: true } } } }).catch(() => null);
  if (endpoints === null) rows.push({ id: 'pacs-config', service: 'PACS endpoints', center: 'Authorized centers', status: 'Needs attention', detail: 'Unable to read endpoint configuration', observedAt: null });
  const unique = new Map<string, { host: string; port: number; center: string; label: string }>();
  for (const endpoint of endpoints ?? []) for (const target of [
    { host: endpoint.clientPacsIp, port: endpoint.clientPacsPort, label: 'PACS report return' },
    { host: endpoint.ec2PublicIp, port: endpoint.receivingPort, label: 'DICOM receive' },
  ]) unique.set(`${target.label}:${target.host}:${target.port}`, { ...target, center: endpoint.client.name });
  const targets = [...unique.values()];
  for (let offset = 0; offset < targets.length; offset += 8) rows.push(...await Promise.all(targets.slice(offset, offset + 8).map(async endpoint => {
    const reachable = endpoint.host && endpoint.host !== '0.0.0.0' && await new Promise<boolean>(resolve => {
      const socket = connect({ host: endpoint.host, port: endpoint.port });
      const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(2500, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false));
    });
    return { id: `${endpoint.label}:${endpoint.host}:${endpoint.port}`, service: endpoint.label, center: endpoint.center, status: reachable ? 'Reachable' : 'Needs attention', detail: `${endpoint.host}:${endpoint.port} · TCP ${reachable ? 'connected' : 'unreachable'}; no DICOM study was sent`, observedAt: new Date().toISOString() };
  })));
  return { rows, updatedAt: new Date().toISOString() };
}
