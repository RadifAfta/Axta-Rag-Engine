import { QdrantClient } from '@qdrant/js-client-rest';
import { Ollama } from 'ollama';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL Client Pool
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Qdrant Vector DB Client
export const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY,
});

// Ollama Client
export const ollamaClient = new Ollama({
  host: process.env.OLLAMA_URL || 'http://localhost:11434',
});

// Configurations
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
};
