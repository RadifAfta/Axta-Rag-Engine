import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRouter from './routes/health';
import documentRouter from './routes/document.routes';
import adminRouter from './routes/admin.routes';
import { config, pgPool } from './config/db';

dotenv.config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/health', healthRouter);
app.use('/api/documents', documentRouter);
app.use('/api/admin', adminRouter);

// Global Error Handler Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Exception:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.env === 'development' ? err.message : 'An unexpected error occurred.'
  });
});

const server = app.listen(config.port, () => {
  console.log(`=========================================`);
  console.log(` Axta RAG Engine is running on port ${config.port}`);
  console.log(` Environment: ${config.env}`);
  console.log(` Target Embedding Model: ${config.embeddingModel}`);
  console.log(`=========================================`);
});

// Graceful Shutdown
const shutdown = async () => {
  console.log('\nShutdown signal received. Closing active connections...');
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await pgPool.end();
      console.log('PostgreSQL connection pool closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error during database connection pool closing:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
