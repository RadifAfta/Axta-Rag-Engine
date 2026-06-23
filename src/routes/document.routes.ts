import { Router } from 'express';
import multer from 'multer';
import { uploadDocument, searchRelevantChunks } from '../controllers/document.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Konfigurasi Multer untuk memproses file upload di memori RAM (in-memory buffer)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // Batasi ukuran file maksimal 10MB
  }
});

// POST /api/documents/upload
// Diperkuat dengan authMiddleware dan multer middleware untuk menangani upload file tunggal dengan key "file"
router.post('/upload', authMiddleware, upload.single('file'), uploadDocument);

// POST /api/documents/search
// Diperkuat dengan authMiddleware untuk menjamin pencarian semantik terisolasi per tenant
router.post('/search', authMiddleware, searchRelevantChunks);

export default router;
