// src/index.ts
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS Policy: Origin ${origin} not allowed.`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

// Initialize Socket.io with matching CORS rules
export const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
  },
});

// Expose Socket.io instance on express app context
app.set('io', io);

// Socket.io Connection & Room Logic
io.on('connection', (socket) => {
  console.log(`⚡ WebSocket connected: ${socket.id}`);

  // Join a room based on Order ID for targeted status updates
  socket.on('join_order_room', (orderId: string) => {
    socket.join(`order_${orderId}`);
    console.log(`Socket ${socket.id} joined room order_${orderId}`);
  });

  // Join a room based on User Role (e.g. RIDERS room for new pending orders)
  socket.on('join_role_room', (role: string) => {
    socket.join(`role_${role}`);
    console.log(`Socket ${socket.id} joined room role_${role}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 WebSocket disconnected: ${socket.id}`);
  });
});

// Endpoints & Routes
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', server: 'Ligo API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Global Server Error:', err.message);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// Listen using the HTTP server wrapper (NOT app.listen)
server.listen(PORT, () => {
  console.log(`🚀 Ligo API Server running on port ${PORT}`);
});