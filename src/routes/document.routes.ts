import { Router } from 'express';
import { uploadDocument, searchRelevantChunks } from '../controllers/document.controller';

const router = Router();

// POST /api/documents/upload - Menerima teks dokumen panjang dan mengindeksnya
router.post('/upload', uploadDocument);

// POST /api/documents/search - Melakukan query pencarian semantik terisolasi
router.post('/search', searchRelevantChunks);

export default router;
