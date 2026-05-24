import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

// List all users — SUPER_ADMIN or ADMIN
router.get('/', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN), async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(users);
});

// Create user — SUPER_ADMIN only
router.post('/', requireRole(UserRole.SUPER_ADMIN), async (req: Request, res: Response) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password and name are required' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role: role || UserRole.ADMIN },
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
  });
  return res.status(201).json(user);
});

// Update user — SUPER_ADMIN only
router.put('/:id', requireRole(UserRole.SUPER_ADMIN), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { name, role, isActive, password } = req.body;

  if (isActive === false && id === req.user!.userId) {
    return res.status(400).json({ error: 'Vous ne pouvez pas bloquer votre propre compte' });
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (password) data.passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
  });
  return res.json(user);
});

// Delete user — SUPER_ADMIN only, cannot delete self
router.delete('/:id', requireRole(UserRole.SUPER_ADMIN), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (id === req.user!.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  await prisma.user.delete({ where: { id } });
  return res.json({ message: 'User deleted' });
});

export default router;
