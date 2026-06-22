import crypto from 'crypto';
import { qdrantClient, ollamaClient, config } from '../config/db';

export interface ProcessDocumentInput {
  documentId: string;
  content: string;
  organizationId: string;
  collectionName?: string;
  metadata?: Record<string, any>;
}

export interface ProcessDocumentResult {
  documentId: string;
  organizationId: string;
  chunksCount: number;
  collectionName: string;
  insertedIds: string[];
}

export class DocumentService {
  /**
   * Memproses dokumen panjang: melakukan chunking, generate embeddings menggunakan Ollama secara batch,
   * dan menyimpannya ke Qdrant secara terisolasi berdasarkan organization_id.
   * 
   * @param input Parameter input dokumen
   * @returns Hasil pemrosesan dokumen termasuk ID chunk yang di-insert
   */
  public async processDocument(input: ProcessDocumentInput): Promise<ProcessDocumentResult> {
    const { documentId, content, organizationId, metadata = {} } = input;
    const collectionName = input.collectionName || 'documents';

    try {
      console.log(`[DocumentService] Memulai pemrosesan dokumen. ID: ${documentId}, Org: ${organizationId}`);

      // 1. Lakukan chunking teks dengan sliding window (500 kata, 50 kata overlap)
      const chunks = this.splitTextIntoChunks(content, 500, 50);
      
      if (chunks.length === 0) {
        console.warn(`[DocumentService] Dokumen ID: ${documentId} kosong. Tidak ada chunk yang diproses.`);
        return {
          documentId,
          organizationId,
          chunksCount: 0,
          collectionName,
          insertedIds: [],
        };
      }

      console.log(`[DocumentService] Dokumen berhasil di-chunk menjadi ${chunks.length} bagian.`);

      // 2. Generate embeddings menggunakan Ollama secara batch
      console.log(`[DocumentService] Menghasilkan embedding menggunakan model "${config.embeddingModel}"...`);
      const embedResponse = await ollamaClient.embed({
        model: config.embeddingModel,
        input: chunks,
      });

      const embeddings = embedResponse.embeddings;
      if (!embeddings || embeddings.length === 0) {
        throw new Error('Respon embedding dari Ollama kosong.');
      }

      const vectorSize = embeddings[0].length;
      console.log(`[DocumentService] Embedding berhasil digenerate. Dimensi vektor: ${vectorSize}`);

      // 3. Pastikan collection di Qdrant sudah ada (buat jika belum ada)
      await this.ensureCollectionExists(collectionName, vectorSize);

      // 4. Siapkan poin data untuk dimasukkan ke Qdrant
      const points = chunks.map((chunk, index) => {
        const pointId = crypto.randomUUID();
        return {
          id: pointId,
          vector: embeddings[index],
          payload: {
            document_id: documentId,
            text: chunk,
            organization_id: organizationId,
            chunk_index: index,
            total_chunks: chunks.length,
            created_at: new Date().toISOString(),
            ...metadata, // Menggabungkan metadata opsional dari client
          },
        };
      });

      // 5. Simpan poin data ke Qdrant
      console.log(`[DocumentService] Mengunggah ${points.length} poin vektor ke Qdrant...`);
      await qdrantClient.upsert(collectionName, {
        wait: true,
        points,
      });

      console.log(`[DocumentService] Sukses menyimpan dokumen ID: ${documentId} ke Qdrant.`);

      return {
        documentId,
        organizationId,
        chunksCount: chunks.length,
        collectionName,
        insertedIds: points.map(p => p.id),
      };
    } catch (error: any) {
      console.error(`[DocumentService] Gagal memproses dokumen ID: ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Algoritma Sliding Window Chunking berbasis jumlah kata.
   * Memotong teks panjang menjadi potongan (chunk) berukuran tertentu dengan overlap yang ditentukan.
   * 
   * @param text Teks dokumen asli
   * @param chunkSize Ukuran maksimal kata per chunk (default: 500)
   * @param overlap Jumlah kata overlap antara chunk yang berurutan (default: 50)
   * @returns Array berisi teks chunk
   */
  private splitTextIntoChunks(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
    if (!text || text.trim() === '') {
      return [];
    }

    // Memisahkan teks berdasarkan whitespace (spasi, newline, tab) menjadi array kata
    const words = text.trim().split(/\s+/);

    // Jika total kata lebih kecil atau sama dengan chunkSize, return teks utuh
    if (words.length <= chunkSize) {
      return [text.trim()];
    }

    const chunks: string[] = [];
    let startIndex = 0;
    const step = chunkSize - overlap;

    // Proteksi dari infinite loop jika overlap dikonfigurasi lebih besar atau sama dengan chunkSize
    if (step <= 0) {
      throw new Error('Ukuran overlap tidak boleh lebih besar atau sama dengan chunkSize.');
    }

    while (startIndex < words.length) {
      const chunkWords = words.slice(startIndex, startIndex + chunkSize);
      
      // Gabungkan kembali kata menjadi string
      chunks.push(chunkWords.join(' '));

      // Geser index awal untuk chunk berikutnya
      startIndex += step;
    }

    return chunks;
  }

  /**
   * Memastikan collection di Qdrant sudah terbentuk sebelum melakukan upsert.
   * Jika belum ada, collection baru akan dibuat secara otomatis dengan dimensi vektor yang terdeteksi.
   * 
   * @param collectionName Nama collection Qdrant
   * @param vectorSize Dimensi ukuran vektor embedding
   */
  private async ensureCollectionExists(collectionName: string, vectorSize: number): Promise<void> {
    try {
      const response = await qdrantClient.getCollections();
      const collectionExists = response.collections.some(c => c.name === collectionName);

      if (!collectionExists) {
        console.log(`[DocumentService] Collection "${collectionName}" tidak ditemukan. Membuat collection baru...`);
        await qdrantClient.createCollection(collectionName, {
          vectors: {
            size: vectorSize,
            distance: 'Cosine', // Menggunakan Cosine Distance sebagai metrik kemiripan teks
          },
        });
        console.log(`[DocumentService] Collection "${collectionName}" berhasil dibuat.`);
      }
    } catch (error: any) {
      console.error(`[DocumentService] Gagal memastikan keberadaan collection "${collectionName}":`, error);
      throw new Error(`Gagal menginisialisasi collection database vektor: ${error.message}`);
    }
  }
}
