import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Helper to ensure JWT_SECRET exists at runtime
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
  }
  return secret;
};

router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, phone, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const validRoles = ['CUSTOMER', 'ADMIN', 'RIDER'];
    const userRole = validRoles.includes(role) ? role : 'CUSTOMER';

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        phone,
        role: userRole,
      },
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      token,
      user: { id: user.id, name: user.name, role: user.role, email: user.email },
    });
  } catch (err) {
    console.error('Error in /register:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, email: user.email },
    });
  } catch (err) {
    console.error('Error in /login:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;