import { Request, Response, NextFunction } from 'express';

// Deklarasi global untuk memperluas tipe Request bawaan Express.
// Ini memungkinkan kita menambahkan properti kustom 'orgId' tanpa error TypeScript compiler.
declare global {
  namespace Express {
    interface Request {
      orgId?: string;
    }
  }
}

// Simulasi database atau mapping API Key ke ID Organisasi (Tenant).
// Pada lingkungan produksi asli, ini biasanya berupa pencarian ke PostgreSQL/Redis.
const API_KEY_TO_TENANT: Record<string, string> = {
  'ak_alpha_123': 'tenant-alpha',
  'ak_beta_456': 'tenant-beta',
  'ak_gamma_789': 'tenant-gamma'
};

/**
 * Middleware untuk menjaga keamanan endpoint REST API.
 * Memeriksa header HTTP kustom "X-Axta-API-Key" dan memetakan kunci tersebut ke ID organisasi klien.
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Ambil API Key dari HTTP Header (case-insensitive key lookup pada Express)
  const apiKey = req.headers['x-axta-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Akses ditolak. Header API Key "X-Axta-API-Key" tidak ditemukan.'
    });
    return;
  }

  // Lakukan pencocokan kunci untuk mengidentifikasi tenant
  const organizationId = API_KEY_TO_TENANT[apiKey];

  if (!organizationId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Akses ditolak. API Key yang Anda berikan tidak valid.'
    });
    return;
  }

  // Menyisipkan organization_id yang teridentifikasi ke dalam Request object Express.
  // Properti ini nantinya akan langsung diakses oleh controller di bawahnya.
  req.orgId = organizationId;
  
  console.log(`[AuthMiddleware] Autentikasi sukses. API Key terhubung ke tenant: ${organizationId}`);
  
  next();
};
