import { Request, Response } from 'express';
import { DocumentService } from '../services/document.service';
import { qdrantClient, ollamaClient, config, pgPool } from '../config/db';
import { PDFParse } from 'pdf-parse';
import crypto from 'crypto';

const documentService = new DocumentService();

/**
 * Controller untuk menangani pengunggahan dokumen.
 * Menyimpan status pemrosesan di database PostgreSQL dan melakukan chunking/embedding.
 * 
 * POST /api/documents/upload
 */
export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  // Generate ID dokumen berbasis UUID
  const documentId = crypto.randomUUID();
  const organizationId = req.orgId; // Diambil dari authMiddleware

  if (!organizationId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Identitas tenant (organization_id) tidak teridentifikasi.'
    });
    return;
  }

  let filename = 'raw_text_payload';
  let content = '';
  const collectionName = req.body.collectionName;
  const customMetadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

  try {
    // 1. Tentukan nama file asli
    if (req.file) {
      filename = req.file.originalname;
    } else if (req.body.documentName) {
      filename = req.body.documentName;
    }

    console.log(`[DocumentController] Mencatat dokumen baru ke PostgreSQL: ${filename} (${documentId}) dengan status 'processing'...`);

    // 2. Catat dokumen ke database relasional dengan status 'processing'
    const insertDocQuery = `
      INSERT INTO documents (id, organization_id, filename, total_chunks, status)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await pgPool.query(insertDocQuery, [documentId, organizationId, filename, 0, 'processing']);

    // 3. Cek pengunggahan berkas via Multer
    if (req.file) {
      const mimeType = req.file.mimetype;

      if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
        let parser: PDFParse | null = null;
        try {
          parser = new PDFParse({ data: req.file.buffer });
          const parsedPdf = await parser.getText();
          content = parsedPdf.text;
          console.log(`[DocumentController] Teks berhasil diekstrak dari PDF. Karakter: ${content.length}`);
        } catch (pdfError: any) {
          // Update status ke 'failed' jika ekstraksi PDF gagal
          await pgPool.query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [documentId]);
          res.status(400).json({
            error: 'Bad Request',
            message: 'Gagal mengekstrak teks dari file PDF.',
            details: pdfError.message
          });
          return;
        } finally {
          if (parser) {
            await parser.destroy();
          }
        }
      } else if (mimeType === 'text/plain' || filename.toLowerCase().endsWith('.txt')) {
        content = req.file.buffer.toString('utf-8');
      } else {
        await pgPool.query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [documentId]);
        res.status(400).json({
          error: 'Unsupported Media Type',
          message: 'Format file tidak didukung. Hanya menerima file .pdf dan .txt.'
        });
        return;
      }
    } else {
      // Fallback JSON Body
      content = req.body.content;
      if (!content) {
        await pgPool.query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [documentId]);
        res.status(400).json({
          error: 'Bad Request',
          message: 'Parameter "content" atau upload file wajib disertakan.'
        });
        return;
      }
    }

    // 4. Jalankan Ingestion Service (chunking, embedding, Qdrant)
    const metadata = {
      ...customMetadata,
      source_file: filename,
      uploaded_at: new Date().toISOString()
    };

    const ingestionResult = await documentService.processDocument({
      documentId: documentId,
      content,
      organizationId,
      collectionName,
      metadata
    });

    // 5. Update status dokumen di PostgreSQL menjadi 'completed' dan isi total_chunks
    const updateDocQuery = `
      UPDATE documents
      SET status = 'completed', total_chunks = $1
      WHERE id = $2
    `;
    await pgPool.query(updateDocQuery, [ingestionResult.chunksCount, documentId]);

    console.log(`[DocumentController] Dokumen ID: ${documentId} sukses diproses. Total chunks: ${ingestionResult.chunksCount}`);

    res.status(201).json({
      message: 'Dokumen berhasil diunggah, diekstrak, dan diindeks ke sistem.',
      data: {
        documentId: ingestionResult.documentId,
        organizationId: ingestionResult.organizationId,
        chunksCount: ingestionResult.chunksCount,
        collectionName: ingestionResult.collectionName,
        status: 'completed',
        insertedIds: ingestionResult.insertedIds
      }
    });

  } catch (error: any) {
    console.error(`[DocumentController] Error memproses upload dokumen (ID: ${documentId}):`, error);

    // Update status ke 'failed' jika terjadi error sistem saat pemrosesan RAG
    try {
      await pgPool.query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [documentId]);
    } catch (dbUpdateError) {
      console.error('[DocumentController] Gagal memperbarui status gagal ke DB:', dbUpdateError);
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal mengunggah dan memproses dokumen.',
      details: error.message
    });
  }
};

/**
 * Controller untuk melakukan pencarian semantik (Vector Search).
 * Menggunakan filter organization_id untuk isolasi tenant.
 * 
 * POST /api/documents/search
 */
export const searchRelevantChunks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, collectionName, limit } = req.body;
    const organizationId = req.orgId; // Diambil dari authMiddleware

    if (!organizationId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Identitas tenant (organization_id) tidak teridentifikasi.'
      });
      return;
    }

    if (!query) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Parameter kueri pencarian "query" wajib disertakan.'
      });
      return;
    }

    const targetCollection = collectionName || 'documents';
    const searchLimit = parseInt(limit || '5', 10);

    console.log(`[DocumentController] Pencarian semantik oleh tenant UUID "${organizationId}": "${query}"`);

    // 1. Konversi query menjadi vektor
    const embedResponse = await ollamaClient.embeddings({
      model: config.embeddingModel,
      prompt: query,
    });
    
    const queryVector = embedResponse.embedding;

    // 2. Query Qdrant dengan filter wajib pada payload organization_id untuk isolasi tenant
    const searchResult = await qdrantClient.search(targetCollection, {
      vector: queryVector,
      limit: searchLimit,
      filter: {
        must: [
          {
            key: 'organization_id',
            match: {
              value: organizationId,
            },
          },
        ],
      },
    });

    res.status(200).json({
      query,
      organizationId,
      collection: targetCollection,
      results: searchResult.map(point => ({
        id: point.id,
        score: point.score,
        payload: point.payload,
      })),
    });
  } catch (error: any) {
    if (error.status === 404 || (error.message && error.message.toLowerCase().includes('not found'))) {
      res.status(200).json({
        query: req.body.query,
        organizationId: req.orgId,
        collection: req.body.collectionName || 'documents',
        results: [],
        message: 'Collection belum diinisialisasi (belum ada dokumen yang diunggah).'
      });
      return;
    }

    console.error('[DocumentController] Gagal mencari chunk semantik:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal melakukan pencarian kueri.',
      details: error.message
    });
  }
};
