import { Request, Response } from 'express';
import { DocumentService } from '../services/document.service';
import { qdrantClient, ollamaClient, config } from '../config/db';
import { PDFParse } from 'pdf-parse';

const documentService = new DocumentService();

/**
 * Controller untuk menangani pengunggahan dokumen.
 * Menerima file biner (PDF/TXT) via Multer (multipart/form-data) ATAU string teks via JSON body (kemampuan fallback).
 * 
 * POST /api/documents/upload
 */
export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    let content = '';
    let docId = req.body.documentId;
    const collectionName = req.body.collectionName;
    const customMetadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

    // 1. Ambil ID organisasi (tenant) yang sudah divalidasi oleh authMiddleware
    const organizationId = req.orgId;

    if (!organizationId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Identitas tenant (organization_id) tidak teridentifikasi.'
      });
      return;
    }

    // 2. Cek apakah ada file yang diunggah via multipart/form-data (Multer)
    if (req.file) {
      const mimeType = req.file.mimetype;
      const originalName = req.file.originalname;
      docId = docId || originalName; // Gunakan nama file asli jika documentId tidak dikirim

      console.log(`[DocumentController] Memproses file upload: ${originalName} (${mimeType}), Ukuran: ${req.file.size} bytes.`);

      if (mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf')) {
        // Ekstrak teks dari PDF buffer menggunakan PDFParse v2
        let parser: PDFParse | null = null;
        try {
          parser = new PDFParse({ data: req.file.buffer });
          const parsedPdf = await parser.getText();
          content = parsedPdf.text;
          console.log(`[DocumentController] Sukses mengekstrak ${content.length} karakter dari PDF.`);
        } catch (pdfError: any) {
          console.error('[DocumentController] Error parsing PDF buffer:', pdfError);
          res.status(400).json({
            error: 'Bad Request',
            message: 'Gagal mengekstrak teks dari file PDF. Kemungkinan file rusak.',
            details: pdfError.message
          });
          return;
        } finally {
          // Sangat penting untuk memanggil destroy() guna mencegah kebocoran memori (memory leak)
          if (parser) {
            await parser.destroy();
          }
        }
      } else if (mimeType === 'text/plain' || originalName.toLowerCase().endsWith('.txt')) {
        // Baca file TXT langsung dari memory buffer
        content = req.file.buffer.toString('utf-8');
      } else {
        res.status(400).json({
          error: 'Unsupported Media Type',
          message: 'Format file tidak didukung. Sistem hanya menerima file berekstensi .pdf dan .txt.'
        });
        return;
      }
    } else {
      // 3. Fallback: Cek jika data dikirim sebagai JSON biasa (retro-compatibility)
      content = req.body.content;
      if (!content) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Permintaan tidak valid. Unggah file dokumen (.pdf/.txt) atau berikan parameter string "content" di JSON body.'
        });
        return;
      }
    }

    // Ekstraksi tambahan untuk metadata dokumen
    const metadata = {
      ...customMetadata,
      source_file: req.file ? req.file.originalname : 'raw_text_json',
      uploaded_at: new Date().toISOString()
    };

    console.log(`[DocumentController] Menjalankan ingestion untuk tenant: ${organizationId}, Doc: ${docId}`);

    // 4. Jalankan DocumentService untuk memotong teks, men-generate embedding, dan menyimpan ke database
    const result = await documentService.processDocument({
      documentId: docId,
      content,
      organizationId,
      collectionName,
      metadata
    });

    res.status(201).json({
      message: 'Dokumen berhasil diunggah, diekstrak, dan diindeks ke sistem.',
      data: result
    });
  } catch (error: any) {
    console.error('[DocumentController] Gagal memproses dokumen upload:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal mengunggah dan memproses dokumen.',
      details: error.message
    });
  }
};

/**
 * Controller untuk melakukan pencarian semantik (Vector Search).
 * Hanya menerima query dan mengambil identitas tenant dari token API Key.
 * 
 * POST /api/documents/search
 */
export const searchRelevantChunks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, collectionName, limit } = req.body;
    
    // Ambil ID organisasi (tenant) yang sudah divalidasi oleh authMiddleware
    const organizationId = req.orgId;

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

    console.log(`[DocumentController] Pencarian semantik oleh tenant "${organizationId}": "${query}"`);

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
