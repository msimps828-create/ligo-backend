import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireAdmin, requireRider, AuthRequest } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { items, deliveryAddress } = req.body;
  const userId = req.user!.userId;

  try {
    let totalPrice = 0;
    const orderItemsData = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product) return res.status(404).json({ message: `Product ${item.productId} not found` });

      totalPrice += product.price * item.quantity;
      orderItemsData.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price
      });
    }

    const order = await prisma.order.create({
      data: {
        userId,
        deliveryAddress,
        totalPrice,
        items: { create: orderItemsData }
      },
      include: { items: true }
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create order' });
  }
});

router.get('/my-orders', authenticate, async (req: AuthRequest, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.userId },
    include: { items: { include: { product: true } }, rider: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(orders);
});

router.get('/rider/my-deliveries', authenticate, requireRider, async (req: AuthRequest, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { riderId: req.user!.userId },
    include: {
      user: { select: { name: true, phone: true } },
      items: { include: { product: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(orders);
});

router.patch('/:id/rider-status', authenticate, requireRider, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const order = await prisma.order.findUnique({ where: { id: id as string } });
  if (!order || order.riderId !== req.user!.userId) {
    return res.status(403).json({ message: 'Not authorized to update this order' });
  }

  const updatedOrder = await prisma.order.update({
    where: { id: id as string },
    data: { status }
  });

  res.json(updatedOrder);
});

router.get('/admin/all', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const orders = await prisma.order.findMany({
    include: {
      user: { select: { name: true, phone: true, email: true } },
      rider: { select: { id: true, name: true, phone: true } },
      items: { include: { product: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(orders);
});

router.patch('/:id/assign', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { riderId } = req.body;

  const rider = await prisma.user.findFirst({ where: { id: riderId, role: 'RIDER' } });
  if (!rider) return res.status(400).json({ message: 'Invalid rider ID' });

  const order = await prisma.order.update({
    where: { id: id as string },
    data: { riderId, status: 'ASSIGNED' },
    include: { rider: { select: { name: true, phone: true } } }
  });

  res.json(order);
});

export default router;