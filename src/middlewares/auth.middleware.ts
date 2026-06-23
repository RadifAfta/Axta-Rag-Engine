import { Request, Response, NextFunction } from 'express';
import { pgPool } from '../config/db';

declare global {
  namespace Express {
    interface Request {
      orgId?: string;
    }
  }
}

/**
 * Middleware untuk mengamankan endpoint REST API.
 * Melakukan kueri ke database PostgreSQL untuk memverifikasi kecocokan API Key yang dikirimkan klien.
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const apiKey = req.headers['x-axta-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Akses ditolak. Header API Key "X-Axta-API-Key" tidak ditemukan.'
    });
    return;
  }

  try {
    // Lakukan pencarian API Key yang aktif ke PostgreSQL.
    // Kita men-JOIN tabel api_keys dan organizations untuk mendapatkan UUID organisasi.
    const query = `
      SELECT o.id AS organization_id
      FROM api_keys k
      INNER JOIN organizations o ON k.organization_id = o.id
      WHERE k.key = $1 AND k.is_active = true
      LIMIT 1
    `;
    
    const dbResult = await pgPool.query(query, [apiKey]);

    if (dbResult.rows.length === 0) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Akses ditolak. API Key yang Anda berikan tidak valid atau tidak aktif.'
      });
      return;
    }

    // Pasang UUID organization_id dari database ke request object
    const organizationId = dbResult.rows[0].organization_id;
    req.orgId = organizationId;

    console.log(`[AuthMiddleware] Autentikasi DB sukses. API Key terhubung ke tenant UUID: ${organizationId}`);
    next();
  } catch (error: any) {
    console.error('[AuthMiddleware] Kegagalan kueri database untuk API Key:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal melakukan verifikasi keamanan di server database.',
      details: error.message
    });
  }
};
