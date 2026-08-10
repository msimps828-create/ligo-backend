import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();

  const hashedPassword = await bcrypt.hash('password123', 10);

  await prisma.user.createMany({
    data: [
      { email: 'admin@ligo.com', password: hashedPassword, name: 'Ligo Admin', phone: '+251900000001', role: 'ADMIN' },
      { email: 'rider@ligo.com', password: hashedPassword, name: 'Ligo Rider', phone: '+251900000002', role: 'RIDER' },
      { email: 'customer@ligo.com', password: hashedPassword, name: 'Abebe Kebede', phone: '+251900000003', role: 'CUSTOMER' },
    ],
  });

  await prisma.product.createMany({
    data: [
      { name: 'Special Burger', description: 'Double beef patty with cheese', price: 250.0 },
      { name: 'Club Sandwich', description: 'Triple decker chicken sandwich', price: 180.0 },
      { name: 'Fresh Juice', description: 'Mixed seasonal fruit juice', price: 90.0 },
    ],
  });

  console.log('Database seeded successfully!');
  console.log('Test credentials: admin@ligo.com / rider@ligo.com / customer@ligo.com');
  console.log('Password for all accounts: password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });