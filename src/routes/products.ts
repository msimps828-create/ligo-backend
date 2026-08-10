import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/products - Get all available products
router.get('/', async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { isAvailable: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/products/admin/all - Get all products (Admin)
router.get('/admin/all', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(products);
  } catch (error) {
    console.error('Error fetching all products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// POST /api/products - Create product (Admin)
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, price, imageUrl } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const numericPrice = typeof price === 'number' ? price : parseFloat(price);
    if (isNaN(numericPrice)) {
      return res.status(400).json({ error: 'Price must be a valid number' });
    }

    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: numericPrice,
        imageUrl,
      },
    });

    res.status(201).json(product);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id - Update product (Admin)
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, description, price, isAvailable, imageUrl } = req.body;

    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) {
      const numericPrice = typeof price === 'number' ? price : parseFloat(price);
      if (!isNaN(numericPrice)) updateData.price = numericPrice;
    }
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
    });

    res.json(product);
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id - Delete product (Admin)
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await prisma.product.delete({ where: { id } });
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

export default router;