import { Router, Request, Response, NextFunction } from 'express';
import { getSystemMetrics, toggleApiKeyStatus } from '../controllers/admin.controller';

const router = Router();

// Token rahasia admin untuk tahap MVP.
// Pada tahap produksi, nilai ini harus disembunyikan di dalam file .env (e.g. process.env.ADMIN_TOKEN)
const ADMIN_SECRET_TOKEN = process.env.ADMIN_TOKEN || 'admin_secret_token_123';

/**
 * Middleware untuk mengamankan rute administratif khusus admin.
 * Memvalidasi keberadaan dan kecocokan header "X-Admin-Token".
 */
const adminAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const adminToken = req.headers['x-admin-token'];

  if (!adminToken || adminToken !== ADMIN_SECRET_TOKEN) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Akses administratif ditolak. Token "X-Admin-Token" tidak valid atau tidak disertakan.'
    });
    return;
  }

  next();
};

// GET /api/admin/metrics - Telemetri data per tenant PostgreSQL & Qdrant
router.get('/metrics', adminAuthMiddleware, getSystemMetrics);

// PATCH /api/admin/api-keys/:id/toggle - Menonaktifkan atau mengaktifkan API Key tenant (Emergency Brake)
router.patch('/api-keys/:id/toggle', adminAuthMiddleware, toggleApiKeyStatus);

export default router;
