import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';

// Operational failures are independent of health-probe exclusions and clinical messaging.
// Persist first; the existing technical bot delivers and retries from these incidents.
export async function recordOperationalFailure(service: string, reference: string, detail: string, center = 'Portal', db: Prisma.TransactionClient = prisma) {
  const probeId = `operation:${service}:${reference}`;
  const id = randomUUID();
  const safeDetail = `Reference: ${reference}. ${detail}`.slice(0, 2000);
  await db.$executeRaw`INSERT INTO technical_incidents (id, "probeId", service, center, detail, "observedStatus", "lastObservedAt")
    VALUES (${id}, ${probeId}, ${service}, ${center}, ${safeDetail}, 'Needs attention', CURRENT_TIMESTAMP)
    ON CONFLICT ("probeId") WHERE status <> 'RESOLVED'
    DO UPDATE SET detail=EXCLUDED.detail, "lastObservedAt"=CURRENT_TIMESTAMP, "observedStatus"='Needs attention'`;
  await db.$executeRaw`INSERT INTO technical_alert_events (id, "incidentId", event, actor, detail)
    SELECT ${randomUUID()}, i.id, 'OPENED', 'workflow', ${safeDetail} FROM technical_incidents i
    WHERE i."probeId"=${probeId} AND i.status <> 'RESOLVED'
    AND NOT EXISTS (SELECT 1 FROM technical_alert_events e WHERE e."incidentId"=i.id AND e.event='OPENED')`;
}

export async function collectOperationalFailures(db: Prisma.TransactionClient) {
  const failures = await db.$queryRaw<Array<{ id: string; service: string; center: string; detail: string }>>`
    SELECT f.* FROM (
      SELECT id, 'Study processing' AS service, "clientId" AS center, 'Study processing failed; inspect its job history.' AS detail FROM processing_jobs WHERE status IN ('failed', 'outbound_submission_failed')
      UNION ALL SELECT id, 'Study archive', "clientId", 'Study archive upload failed; local archive must be retained.' FROM processing_jobs WHERE "archiveState"='UPLOAD_FAILED'
      UNION ALL SELECT id, 'PACS report delivery', 'Portal', 'PACS report delivery failed; inspect the return job.' FROM pacs_return_jobs WHERE status='FAILED' OR (status='PENDING' AND attempts>0)
      UNION ALL SELECT id, 'Notification delivery', 'Portal', 'Clinical notification delivery failed; inspect the outbox.' FROM notification_outbox WHERE status IN ('FAILED', 'DEAD') AND COALESCE(payload->>'error','') NOT ILIKE '%suppressed%' AND COALESCE(payload->>'error','') NOT ILIKE '%scope or group configuration changed%'
    ) f WHERE NOT EXISTS (SELECT 1 FROM technical_incidents i WHERE i."probeId"='operation:' || f.service || ':' || f.id)
    LIMIT 100`;
  for (const row of failures) await recordOperationalFailure(row.service, row.id, row.detail, row.center, db);
}
