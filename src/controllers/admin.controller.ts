import { Request, Response } from 'express';
import { qdrantClient, pgPool } from '../config/db';

/**
 * GET /api/admin/metrics
 * Mengambil metrik sistem: Agregasi jumlah dokumen dan chunk per tenant (dari PostgreSQL)
 * serta verifikasi langsung jumlah poin vektor yang tersimpan di Qdrant.
 */
export const getSystemMetrics = async (req: Request, res: Response): Promise<void> => {
  try {
    const collectionName = (req.query.collectionName as string) || 'documents';

    // 1. Ambil agregasi dokumen dan chunk dari PostgreSQL dengan GROUP BY
    const pgQuery = `
      SELECT o.id AS organization_id, o.name AS organization_name,
             COUNT(d.id) AS total_documents,
             COALESCE(SUM(d.total_chunks), 0)::INTEGER AS total_chunks_sql
      FROM organizations o
      LEFT JOIN documents d ON o.id = d.organization_id
      GROUP BY o.id, o.name
      ORDER BY o.name ASC
    `;
    const pgResult = await pgPool.query(pgQuery);

    const tenantsMetrics = [];

    // 2. Lakukan kueri silang ke Qdrant untuk memvalidasi sinkronisasi data
    for (const row of pgResult.rows) {
      let qdrantCount = 0;
      try {
        const countResult = await qdrantClient.count(collectionName, {
          filter: {
            must: [
              {
                key: 'organization_id',
                match: {
                  value: row.organization_id
                }
              }
            ]
          },
          exact: true
        });
        qdrantCount = countResult.count;
      } catch (qdrantError) {
        // Jika collection belum terbuat di Qdrant, biarkan count bernilai 0
        qdrantCount = 0;
      }

      tenantsMetrics.push({
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        totalDocuments: parseInt(row.total_documents, 10),
        totalChunksSql: row.total_chunks_sql,
        totalVectorPointsQdrant: qdrantCount,
        inSync: row.total_chunks_sql === qdrantCount // Verifikasi kecocokan PostgreSQL & Qdrant
      });
    }

    // Hitung total agregat sistem
    const systemSummary = tenantsMetrics.reduce(
      (acc, item) => {
        acc.totalDocuments += item.totalDocuments;
        acc.totalChunks += item.totalChunksSql;
        acc.totalVectors += item.totalVectorPointsQdrant;
        return acc;
      },
      { totalDocuments: 0, totalChunks: 0, totalVectors: 0 }
    );

    res.status(200).json({
      timestamp: new Date().toISOString(),
      summary: systemSummary,
      tenants: tenantsMetrics
    });
  } catch (error: any) {
    console.error('[AdminController] Gagal memuat metrik sistem:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal mengambil metrik telemetri sistem.',
      details: error.message
    });
  }
};

/**
 * PATCH /api/admin/api-keys/:id/toggle
 * Mengaktifkan atau menonaktifkan API Key untuk memblokir akses tenant yang melakukan abuse.
 */
export const toggleApiKeyStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    // Validasi parameter body
    if (typeof is_active !== 'boolean') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Parameter "is_active" wajib bernilai boolean (true/false).'
      });
      return;
    }

    console.log(`[AdminController] Mengubah status API Key ID: ${id} menjadi is_active: ${is_active}`);

    // Update kolom is_active di PostgreSQL
    const query = `
      UPDATE api_keys
      SET is_active = $1
      WHERE id = $2
      RETURNING id, key, organization_id, is_active, created_at
    `;
    
    const dbResult = await pgPool.query(query, [is_active, id]);

    if (dbResult.rows.length === 0) {
      res.status(404).json({
        error: 'Not Found',
        message: `API Key dengan ID "${id}" tidak ditemukan.`
      });
      return;
    }

    const updatedKey = dbResult.rows[0];

    res.status(200).json({
      message: `API Key berhasil ${is_active ? 'diaktifkan' : 'dinonaktifkan'}.`,
      data: {
        id: updatedKey.id,
        organizationId: updatedKey.organization_id,
        isActive: updatedKey.is_active,
        keyMasked: updatedKey.key.substring(0, 5) + '***' // Menyembunyikan token asli demi keamanan log
      }
    });
  } catch (error: any) {
    console.error('[AdminController] Gagal memperbarui status API Key:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal memperbarui status API Key di database.',
      details: error.message
    });
  }
};
