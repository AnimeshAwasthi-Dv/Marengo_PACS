import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export type StorageKind = 'original-studies' | 'cleaned-dicoms' | 'ct-studies' | 'mri-studies' | 'xray-studies' | 'mammography-studies' | 'ai-reports' | 'final-reports' | 'provider-reports' | 'clinical-indications'
export type StoredObject = { key: string; url: string; bucket: string; localPath?: string }

const bucketVariables: Record<StorageKind, string> = {
  'original-studies': 'S3_ORIGINAL_STUDIES_BUCKET', 'cleaned-dicoms': 'S3_CLEANED_DICOMS_BUCKET',
  'ct-studies': 'S3_CT_STUDIES_BUCKET', 'mri-studies': 'S3_MRI_STUDIES_BUCKET', 'xray-studies': 'S3_XRAY_STUDIES_BUCKET', 'mammography-studies': 'S3_MAMMOGRAPHY_STUDIES_BUCKET',
  'ai-reports': 'S3_AI_REPORTS_BUCKET', 'final-reports': 'S3_FINAL_REPORTS_BUCKET',
  'provider-reports': 'S3_PROVIDER_REPORTS_BUCKET', 'clinical-indications': 'S3_CLINICAL_INDICATIONS_BUCKET',
}

const prefixVariables: Partial<Record<StorageKind, string>> = {
  'ct-studies': 'S3_CT_STUDIES_PREFIX', 'mri-studies': 'S3_MRI_STUDIES_PREFIX',
  'xray-studies': 'S3_XRAY_STUDIES_PREFIX', 'mammography-studies': 'S3_MAMMOGRAPHY_STUDIES_PREFIX',
}

function getS3Config(kind: StorageKind) {
  const bucket = process.env[bucketVariables[kind]]
    || ((kind === 'ai-reports' || kind === 'final-reports' || kind === 'provider-reports') ? process.env.S3_REPORT_BUCKET : undefined)
    || ((kind === 'original-studies' || kind === 'cleaned-dicoms' || kind === 'provider-reports') ? process.env.S3_CT_STUDIES_BUCKET : undefined)
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
  if (!bucket || !accessKeyId || !secretAccessKey) return null
  return {
    bucket, region: process.env.S3_REGION || process.env.S3_REPORT_REGION || 'us-east-1', endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true', prefix: (prefixVariables[kind] && process.env[prefixVariables[kind]!] || process.env.S3_PREFIX || process.env.S3_REPORT_PREFIX || '').replace(/^\/+|\/+$/g, ''),
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || process.env.S3_REPORT_PUBLIC_BASE_URL, public: process.env.S3_URL_MODE === 'public', credentials: { accessKeyId, secretAccessKey },
  }
}

function unique(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
}

function getS3Prefix(kind: StorageKind) {
  return (prefixVariables[kind] && process.env[prefixVariables[kind]!] || process.env.S3_PREFIX || process.env.S3_REPORT_PREFIX || '').replace(/^\/+|\/+$/g, '')
}

function getStudyBuckets(kinds: StorageKind[]) {
  return unique([
    process.env.S3_VIEWER_STUDY_BUCKETS,
    process.env.S3_STUDY_BUCKETS,
  ].flatMap(value => value?.split(',') ?? []).concat(
    kinds.map(kind => process.env[bucketVariables[kind]]),
    process.env.S3_ORIGINAL_STUDIES_BUCKET,
    process.env.S3_CT_STUDIES_BUCKET,
    process.env.S3_MRI_STUDIES_BUCKET,
    process.env.S3_XRAY_STUDIES_BUCKET,
    process.env.S3_MAMMOGRAPHY_STUDIES_BUCKET,
  ))
}

function getS3ClientConfig() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) return null
  return {
    region: process.env.S3_REGION || process.env.S3_REPORT_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId, secretAccessKey },
  }
}

export async function storeObject(input: { kind: StorageKind; keyParts: string[]; body: PutObjectCommand['input']['Body']; contentType: string; localPath?: string }): Promise<StoredObject | null> {
  const config = getS3Config(input.kind)
  if (!config) return null
  const key = [config.prefix, ...input.keyParts].filter(Boolean).join('/')
  const client = new S3Client({ region: config.region, endpoint: config.endpoint, forcePathStyle: config.forcePathStyle, credentials: config.credentials })
  await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: input.body, ContentType: input.contentType }))
  const base = config.publicBaseUrl?.replace(/\/+$/g, '')
  const url = config.public && base ? `${base}/${key}` : `s3://${config.bucket}/${key}`
  return { key, url, bucket: config.bucket, localPath: input.localPath }
}

export async function findStoredStudyObject(input: { kinds: StorageKind[]; keys: string[] }): Promise<StoredObject | null> {
  const config = getS3ClientConfig()
  if (!config) return null
  const buckets = getStudyBuckets(input.kinds)
  if (!buckets.length) return null
  const prefixes = unique(['', process.env.S3_VIEWER_STUDY_PREFIX, process.env.S3_STUDY_PREFIX, ...input.kinds.map(getS3Prefix)])
  const keys = unique(input.keys).flatMap((key) => {
    const cleanKey = key.replace(/^\/+/, '')
    return prefixes.map(prefix => prefix ? `${prefix}/${cleanKey.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '')}` : cleanKey)
  })
  const client = new S3Client(config)
  for (const bucket of buckets) {
    for (const key of unique(keys)) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        const base = (process.env.S3_PUBLIC_BASE_URL || process.env.S3_REPORT_PUBLIC_BASE_URL)?.replace(/\/+$/g, '')
        const url = process.env.S3_URL_MODE === 'public' && base ? `${base}/${key}` : `s3://${bucket}/${key}`
        return { bucket, key, url }
      } catch (error) {
        const status = typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 'number'
          ? (error as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode
          : undefined
        if (status && status !== 403 && status !== 404) throw error
      }
    }
  }
  return null
}

export async function readStoredObject(input: Pick<StoredObject, 'bucket' | 'key'>): Promise<Buffer | null> {
  const config = getS3ClientConfig()
  if (!config || !input.bucket || !input.key) return null
  const client = new S3Client(config)
  const response = await client.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }))
  const body = response.Body
  if (!body) return null
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray())
  }
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function uploadReportHtmlToS3(input: { reportId: string; version: 'ai-initial' | 'final'; html: string }): Promise<StoredObject | null> {
  return storeObject({ kind: input.version === 'final' ? 'final-reports' : 'ai-reports', keyParts: ['reports', input.reportId, `${input.version}.html`], body: input.html, contentType: 'text/html; charset=utf-8' })
}
