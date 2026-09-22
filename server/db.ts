import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

dotenv.config({
  path: process.env.LOAD_STORAGE_ENV === 'true' ? ['.env', '.env.storage', '.env.telegram.local'] : ['.env', '.env.telegram.local'],
  override: false,
})

export const prisma = new PrismaClient()
