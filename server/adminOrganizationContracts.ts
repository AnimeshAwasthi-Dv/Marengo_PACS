import { z } from 'zod'

const trimmedName = z.string().trim().min(2).max(160)
const normalizedEmail = z.string().trim().toLowerCase().email().max(254)

export const groupAdminCreateSchema = z.object({
  name: trimmedName,
  email: normalizedEmail,
})

export const accountStatusSchema = z.object({
  active: z.boolean(),
})

export const passwordConfirmationSchema = z.object({
  password: z.string().min(1).max(1024),
})

export const adminRadiologistScopeSchema = z.enum(['MARENGO_GROUP', 'RENEWIST'])

export const adminRadiologistCreateSchema = z.object({
  scope: adminRadiologistScopeSchema,
  fullName: trimmedName,
  email: normalizedEmail,
  phone: z.string().trim().max(40).optional().default(''),
  qualification: z.string().trim().min(2).max(200),
  medicalRegistrationNumber: z.string().trim().min(2).max(120),
  organisationName: z.string().trim().max(200).optional().default(''),
  signatureImageUrl: z.string().trim().max(2048).optional().default(''),
  signatureImageData: z.string().max(3_000_000).optional().default(''),
  documentData: z.string().max(11_300_000).optional().default(''),
  documentName: z.string().trim().max(255).optional().default(''),
})

export type AdminRadiologistScope = z.infer<typeof adminRadiologistScopeSchema>

export function managedRadiologistScope(
  profile: { clientId?: string | null; providerCode?: string | null },
  marengoGroupId: string,
): AdminRadiologistScope | null {
  if (!profile.providerCode && profile.clientId === marengoGroupId) return 'MARENGO_GROUP'
  if (!profile.clientId && profile.providerCode === 'RENEWIST') return 'RENEWIST'
  return null
}
