import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

router.get('/', async (_req: Request, res: Response) => {
  const products = await prisma.product.findMany({ where: { isAvailable: true } });
  res.json(products);
});

router.get('/admin/all', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  const products = await prisma.product.findMany();
  res.json(products);
});

router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { name, description, price, imageUrl } = req.body;
  const product = await prisma.product.create({
    data: { name, description, price: parseFloat(price), imageUrl }
  });
  res.status(201).json(product);
});

router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, price, isAvailable, imageUrl } = req.body;
  const product = await prisma.product.update({
    where: { id: id as string },
    data: { name, description, price: parseFloat(price), isAvailable, imageUrl }
  });
  res.json(product);
});

router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  await prisma.product.delete({ where: { id: id as string } });
  res.json({ message: 'Product deleted' });
});

export default router;