// src/schemas/auth.schema.ts
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters long'),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters long'),
  phone: z
    .string()
    .min(10, 'Phone number must be at least 10 digits')
    .optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});