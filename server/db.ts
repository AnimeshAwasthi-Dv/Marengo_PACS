import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

dotenv.config({
  path: process.env.LOAD_STORAGE_ENV === 'true' ? ['.env', '.env.storage', '.env.telegram.local'] : ['.env', '.env.telegram.local'],
  override: false,
})

const readOnly = process.env.DATABASE_READ_ONLY === 'true'
const databaseUrl = process.env.DATABASE_URL
if (readOnly && databaseUrl) {
  const url = new URL(databaseUrl)
  url.searchParams.set('options', '-c default_transaction_read_only=on')
  process.env.DATABASE_URL = url.toString()
}
const client = new PrismaClient()
const readOperations = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])
export const prisma = (readOnly ? client.$extends({ query: { $allModels: { $allOperations({ operation, args, query }) {
  if (!readOperations.has(operation)) throw new Error('Production database is read-only')
  return query(args)
} } } }) : client) as typeof client
