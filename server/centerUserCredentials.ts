import { z } from 'zod';

export const centerUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  portalRole: z.enum(['FRONT_DESK', 'TECHNICIAN', 'MANAGER', 'IT_TEAM']),
  userId: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, 'Username must be 3-64 characters: letters, numbers, dots, underscores or hyphens.').optional().or(z.literal('')),
  password: z.string().min(12, 'Password must contain at least 12 characters.').refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.').optional().or(z.literal('')),
});

// Login accepts either username or email, case-insensitively: reserve both namespaces.
export function centerLoginConflictWhere(userId: string, email: string) {
  return { OR: [
    { userId: { equals: userId, mode: 'insensitive' as const } },
    { email: { equals: userId, mode: 'insensitive' as const } },
    { userId: { equals: email, mode: 'insensitive' as const } },
    { email: { equals: email, mode: 'insensitive' as const } },
  ] };
}
