import { Request, Response } from 'express';
import { DocumentService } from '../services/document.service';
import { qdrantClient, ollamaClient, config } from '../config/db';

const documentService = new DocumentService();

/**
 * Controller untuk menangani pengunggahan dokumen dan melakukan pemrosesan chunking/embedding.
 * 
 * POST /api/documents/upload
 */
export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { content, documentId, collectionName, metadata } = req.body;
    
    // Mendapatkan organization_id dari Header x-organization-id atau Body organization_id
    const organizationId = (req.headers['x-organization-id'] as string) || req.body.organization_id;

    // Validasi parameter wajib
    if (!content || !organizationId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Parameter "content" dan "organization_id" (diisi via header "x-organization-id" atau body JSON) wajib disertakan.'
      });
      return;
    }

    console.log(`[DocumentController] Request upload diterima. Org: ${organizationId}, Doc: ${documentId || 'auto-generate'}`);

    const result = await documentService.processDocument({
      documentId: documentId || undefined,
      content,
      organizationId,
      collectionName,
      metadata
    });

    res.status(201).json({
      message: 'Dokumen berhasil diproses dan disimpan.',
      data: result
    });
  } catch (error: any) {
    console.error('[DocumentController] Gagal memproses unggah dokumen:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal memproses dokumen di server.',
      details: error.message
    });
  }
};

/**
 * Controller untuk mencari potongan dokumen (chunks) yang relevan berdasarkan query teks.
 * Memanfaatkan Ollama untuk mengubah query menjadi vektor dan Qdrant untuk pencarian vektor dengan filter organisasi.
 * 
 * POST /api/documents/search
 */
export const searchRelevantChunks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, collectionName, limit } = req.body;
    
    // Mendapatkan organization_id dari Header x-organization-id atau Body organization_id
    const organizationId = (req.headers['x-organization-id'] as string) || req.body.organization_id;

    // Validasi parameter wajib
    if (!query || !organizationId) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Parameter "query" dan "organization_id" (diisi via header "x-organization-id" atau body JSON) wajib disertakan.'
      });
      return;
    }

    const targetCollection = collectionName || 'documents';
    const searchLimit = parseInt(limit || '5', 10);

    console.log(`[DocumentController] Melakukan pencarian query. Org: ${organizationId}, Query: "${query}"`);

    // 1. Ubah query pencarian menjadi vektor menggunakan Ollama
    const embedResponse = await ollamaClient.embeddings({
      model: config.embeddingModel,
      prompt: query,
    });
    
    const queryVector = embedResponse.embedding;

    // 2. Lakukan pencarian vektor (vector search) di Qdrant
    // Filter ketat disematkan untuk memastikan multi-tenancy (isolasi data organisasi)
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

    // 3. Kembalikan hasil pencarian yang relevan
    res.status(200).json({
      query,
      organizationId,
      collection: targetCollection,
      results: searchResult.map(point => ({
        id: point.id,
        score: point.score, // Similarity score (Cosine Similarity)
        payload: point.payload, // Metadata teks chunk asli, document_id, dll.
      })),
    });
  } catch (error: any) {
    // Penanganan anggun jika collection belum terbuat (belum ada dokumen yang pernah di-ingest)
    if (error.status === 404 || (error.message && error.message.toLowerCase().includes('not found'))) {
      console.warn(`[DocumentController] Collection belum siap. Mengembalikan hasil kosong.`);
      res.status(200).json({
        query: req.body.query,
        organizationId: (req.headers['x-organization-id'] as string) || req.body.organization_id,
        collection: req.body.collectionName || 'documents',
        results: [],
        message: 'Collection belum diinisialisasi (belum ada dokumen yang diunggah).'
      });
      return;
    }

    console.error('[DocumentController] Gagal mencari chunk yang relevan:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Gagal melakukan pencarian dokumen.',
      details: error.message
    });
  }
};
