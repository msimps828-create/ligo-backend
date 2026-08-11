// src/routes/orders.ts

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../middleware/auth.js';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    role: 'CUSTOMER' | 'ADMIN' | 'RIDER';
  };
}

const router = Router();

// Strict state transition map
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

// GET /api/orders - Fetch orders based on user role
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    let whereClause: any = {};

    if (role === 'CUSTOMER') {
      whereClause = { userId };
    } else if (role === 'RIDER') {
      whereClause = {
        OR: [{ riderId: userId }, { status: 'PENDING' }],
      };
    } // ADMIN role gets whereClause = {} (sees all orders)

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/:id - Fetch single order
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (req.user?.role === 'CUSTOMER' && order.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (
      req.user?.role === 'RIDER' &&
      order.riderId &&
      order.riderId !== req.user.userId &&
      order.status !== 'PENDING'
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    return res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// POST /api/orders - Create new order (Wrapped in Transaction + Real-time Socket Emission)
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deliveryAddress, items } = req.body;

    if (!deliveryAddress || !items || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'deliveryAddress and a non-empty items array are required' });
    }

    const newOrder = await prisma.$transaction(async (tx) => {
      const productIds = items.map((i: { productId: string }) => i.productId);

      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));
      let totalPrice = 0;
      const orderItemsToCreate = [];

      for (const item of items) {
        const product = productMap.get(item.productId);

        if (!product) {
          throw new Error(`PRODUCT_NOT_FOUND:${item.productId}`);
        }

        if (!product.isAvailable) {
          throw new Error(`PRODUCT_UNAVAILABLE:${product.name}`);
        }

        const itemTotal = product.price * item.quantity;
        totalPrice += itemTotal;

        orderItemsToCreate.push({
          productId: product.id,
          quantity: item.quantity,
          price: product.price,
        });
      }

      return await tx.order.create({
        data: {
          userId: req.user!.userId,
          deliveryAddress,
          totalPrice,
          status: 'PENDING',
          items: {
            create: orderItemsToCreate,
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });
    });

    // --- SOCKET.IO EVENT EMISSION ---
    const io = req.app.get('io');
    if (io) {
      // Notify all available riders and admins that a new pending order was placed
      io.to('role_RIDER').to('role_ADMIN').emit('order:created', newOrder);
    }

    return res.status(201).json(newOrder);
  } catch (error: any) {
    if (error.message?.startsWith('PRODUCT_NOT_FOUND:')) {
      const productId = error.message.replace('PRODUCT_NOT_FOUND:', '');
      return res.status(400).json({ error: `Product ID ${productId} not found` });
    }
    if (error.message?.startsWith('PRODUCT_UNAVAILABLE:')) {
      const productName = error.message.replace('PRODUCT_UNAVAILABLE:', '');
      return res.status(400).json({ error: `Product "${productName}" is currently unavailable` });
    }

    console.error('Error creating order:', error);
    return res.status(500).json({ error: 'Failed to create order' });
  }
});

// PATCH /api/orders/:id/status - Update order status (Wrapped in Transaction + Real-time Socket Emission)
router.patch('/:id/status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, riderId } = req.body;
    const user = req.user!;

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const existingOrder = await tx.order.findUnique({ where: { id } });
      if (!existingOrder) {
        throw new Error('ORDER_NOT_FOUND');
      }

      const currentStatus = existingOrder.status;

      // 1. Status transition validation
      if (status) {
        const allowed = ALLOWED_TRANSITIONS[currentStatus];
        if (!allowed || !allowed.includes(status)) {
          throw new Error(`INVALID_TRANSITION:${currentStatus}:${status}`);
        }

        // Customer cancellation rules
        if (user.role === 'CUSTOMER') {
          if (existingOrder.userId !== user.userId) {
            throw new Error('FORBIDDEN_ACCESS');
          }
          if (status !== 'CANCELLED') {
            throw new Error('CUSTOMER_ONLY_CANCEL');
          }
        }

        // Rider rules
        if (user.role === 'RIDER') {
          if (status === 'ACCEPTED') {
            if (existingOrder.riderId && existingOrder.riderId !== user.userId) {
              throw new Error('ALREADY_CLAIMED');
            }
          } else {
            if (existingOrder.riderId !== user.userId) {
              throw new Error('NOT_ASSIGNED_RIDER');
            }
          }
        }
      }

      const updateData: any = {};
      if (status) updateData.status = status;

      // Auto-assign rider on claim
      if (user.role === 'RIDER' && status === 'ACCEPTED') {
        updateData.riderId = user.userId;
      } else if (user.role === 'ADMIN' && riderId !== undefined) {
        updateData.riderId = riderId;
      }

      return await tx.order.update({
        where: { id },
        data: updateData,
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
      });
    });

    // --- SOCKET.IO EVENT EMISSION ---
    const io = req.app.get('io');
    if (io) {
      // Broadcast updated status to order room (customer/rider following order) and admins
      io.to(`order_${id}`).to('role_ADMIN').emit('order:status_updated', updatedOrder);
    }

    return res.json(updatedOrder);
  } catch (error: any) {
    if (error.message === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (error.message?.startsWith('INVALID_TRANSITION:')) {
      const [, from, to] = error.message.split(':');
      return res.status(400).json({ error: `Invalid status transition from ${from} to ${to}` });
    }
    if (error.message === 'FORBIDDEN_ACCESS') {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (error.message === 'CUSTOMER_ONLY_CANCEL') {
      return res.status(403).json({ error: 'Customers can only cancel pending orders' });
    }
    if (error.message === 'ALREADY_CLAIMED') {
      return res.status(400).json({ error: 'Order is already claimed by another rider' });
    }
    if (error.message === 'NOT_ASSIGNED_RIDER') {
      return res.status(403).json({ error: 'You are not the assigned rider for this order' });
    }

    console.error('Error updating order status:', error);
    return res.status(500).json({ error: 'Failed to update order status' });
  }
});

export default router;