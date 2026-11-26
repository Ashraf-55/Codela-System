import { z } from 'zod';
import { PRODUCT_SLUGS } from '@codela/design';

export const password = z.string().min(10).max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and digits');

export const registerBusiness = z.object({
  businessName: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/, 'lowercase letters, digits, hyphens'),
  productSlug: z.enum(PRODUCT_SLUGS),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  locale: z.enum(['ar', 'en']).default('ar'),
  currency: z.string().length(3).toUpperCase().default('EGP'),
});
export const login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128), otp: z.string().trim().max(10).optional() });
export const customerCreate = z.object({
  ref: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(30).nullish(),
  email: z.string().trim().toLowerCase().email().nullish(),
  notes: z.string().max(2000).nullish(),
}).strip();
export const customerUpdate = customerCreate.partial().strip();
export const employeeCreate = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  role: z.string().regex(/^[a-z][a-z_]{1,29}$/).refine((r) => !['owner', 'driver'].includes(r), 'This role cannot be assigned here'),
});
