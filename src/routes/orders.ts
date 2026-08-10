import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// GET /api/orders - Fetch orders based on user role
router.get('/', authenticateToken, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    let whereClause: any = {};

    if (role === 'CUSTOMER') {
      whereClause = { userId };
    } else if (role === 'RIDER') {
      whereClause = {
        OR: [{ riderId: userId }, { status: 'PENDING' }],
      };
    }
    // ADMIN sees all orders (whereClause remains empty {})

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

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/:id - Fetch a single order by ID
router.get('/:id', authenticateToken, async (req: any, res: Response) => {
  try {
    const { id } = req.params;

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

    // Authorization check for customers
    if (req.user.role === 'CUSTOMER' && order.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// POST /api/orders - Create a new order
router.post('/', authenticateToken, async (req: any, res: Response) => {
  try {
    const { deliveryAddress, items } = req.body;

    if (!deliveryAddress || !items || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'deliveryAddress and a non-empty items array are required' });
    }

    let totalPrice = 0;
    const orderItemsToCreate = [];

    // Calculate total price and validate products
    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      });

      if (!product) {
        return res.status(400).json({ error: `Product ID ${item.productId} not found` });
      }

      if (!product.isAvailable) {
        return res.status(400).json({ error: `Product "${product.name}" is currently unavailable` });
      }

      const itemTotal = product.price * item.quantity;
      totalPrice += itemTotal;

      orderItemsToCreate.push({
        productId: product.id,
        quantity: item.quantity,
        price: product.price,
      });
    }

    // Save order and items to database
    const newOrder = await prisma.order.create({
      data: {
        userId: req.user.userId,
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

    res.status(201).json(newOrder);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// PATCH /api/orders/:id/status - Update status or assign rider
router.patch('/:id/status', authenticateToken, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { status, riderId } = req.body;

    const existingOrder = await prisma.order.findUnique({ where: { id } });
    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (riderId) updateData.riderId = riderId;

    // Auto-assign rider if a rider updates the order status
    if (req.user.role === 'RIDER' && !existingOrder.riderId) {
      updateData.riderId = req.user.userId;
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

    res.json(updatedOrder);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

export default router;