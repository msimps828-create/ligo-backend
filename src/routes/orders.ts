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

// POST /api/orders - Create new order
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deliveryAddress, items } = req.body;

    if (!deliveryAddress || !items || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'deliveryAddress and a non-empty items array are required' });
    }

    let totalPrice = 0;
    const orderItemsToCreate = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });

      if (!product) {
        return res.status(400).json({ error: `Product ID ${item.productId} not found` });
      }

      if (!product.isAvailable) {
        return res
          .status(400)
          .json({ error: `Product "${product.name}" is currently unavailable` });
      }

      const itemTotal = product.price * item.quantity;
      totalPrice += itemTotal;

      orderItemsToCreate.push({
        productId: product.id,
        quantity: item.quantity,
        price: product.price,
      });
    }

    const newOrder = await prisma.order.create({
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
        items: true,
      },
    });

    return res.status(201).json(newOrder);
  } catch (error) {
    console.error('Error creating order:', error);
    return res.status(500).json({ error: 'Failed to create order' });
  }
});

// PATCH /api/orders/:id/status - Update order status & state transitions
router.patch('/:id/status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, riderId } = req.body;
    const user = req.user!;

    const existingOrder = await prisma.order.findUnique({ where: { id } });
    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const currentStatus = existingOrder.status;

    // 1. Status transition validation
    if (status) {
      const allowed = ALLOWED_TRANSITIONS[currentStatus];
      if (!allowed || !allowed.includes(status)) {
        return res.status(400).json({
          error: `Invalid status transition from ${currentStatus} to ${status}`,
        });
      }

      // Customer cancellation rules
      if (user.role === 'CUSTOMER') {
        if (existingOrder.userId !== user.userId) {
          return res.status(403).json({ error: 'Access denied' });
        }
        if (status !== 'CANCELLED') {
          return res.status(403).json({ error: 'Customers can only cancel pending orders' });
        }
      }

      // Rider rules
      if (user.role === 'RIDER') {
        if (status === 'ACCEPTED') {
          if (existingOrder.riderId && existingOrder.riderId !== user.userId) {
            return res.status(400).json({ error: 'Order is already claimed by another rider' });
          }
        } else {
          if (existingOrder.riderId !== user.userId) {
            return res.status(403).json({ error: 'You are not the assigned rider for this order' });
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

    const updatedOrder = await prisma.order.update({
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

    return res.json(updatedOrder);
  } catch (error) {
    console.error('Error updating order status:', error);
    return res.status(500).json({ error: 'Failed to update order status' });
  }
});

export default router;