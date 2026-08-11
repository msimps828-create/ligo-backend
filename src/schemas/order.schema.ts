// src/schemas/order.schema.ts
import { z } from 'zod';

export const createOrderSchema = z.object({
  deliveryAddress: z
    .string()
    .min(3, 'Delivery address must be at least 3 characters long'),
  items: z
    .array(
      z.object({
        productId: z.string().uuid('Invalid Product ID format'),
        quantity: z.number().int().positive('Quantity must be greater than 0'),
      })
    )
    .min(1, 'Order must contain at least one item'),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'], {
    message: 'Invalid order status value',
  }),
  riderId: z.string().uuid('Invalid Rider ID format').optional(),
});