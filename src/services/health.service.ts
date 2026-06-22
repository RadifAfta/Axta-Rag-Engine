import { pgPool, qdrantClient, ollamaClient, config } from '../config/db';

export interface ServiceHealthStatus {
  status: 'UP' | 'DOWN';
  message?: string;
  details?: any;
}

export interface HealthCheckResult {
  status: 'OK' | 'DEGRADED' | 'DOWN';
  services: {
    postgres: ServiceHealthStatus;
    qdrant: ServiceHealthStatus;
    ollama: ServiceHealthStatus;
  };
  timestamp: string;
}

export class HealthService {
  public async checkAllServices(): Promise<HealthCheckResult> {
    const postgresHealth = await this.checkPostgres();
    const qdrantHealth = await this.checkQdrant();
    const ollamaHealth = await this.checkOllama();

    let overallStatus: 'OK' | 'DEGRADED' | 'DOWN' = 'OK';
    
    const statuses = [postgresHealth.status, qdrantHealth.status, ollamaHealth.status];
    const downCount = statuses.filter(s => s === 'DOWN').length;

    if (downCount === 3) {
      overallStatus = 'DOWN';
    } else if (downCount > 0) {
      overallStatus = 'DEGRADED';
    }

    return {
      status: overallStatus,
      services: {
        postgres: postgresHealth,
        qdrant: qdrantHealth,
        ollama: ollamaHealth,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<ServiceHealthStatus> {
    try {
      const client = await pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      return { status: 'UP', message: 'Successfully connected to PostgreSQL.' };
    } catch (error: any) {
      return { 
        status: 'DOWN', 
        message: 'Failed to connect to PostgreSQL.',
        details: error.message 
      };
    }
  }

  private async checkQdrant(): Promise<ServiceHealthStatus> {
    try {
      // Check connection by listing collections (a lightweight metadata query)
      const collections = await qdrantClient.getCollections();
      return { 
        status: 'UP', 
        message: 'Successfully connected to Qdrant.',
        details: { collectionsCount: collections.collections.length }
      };
    } catch (error: any) {
      return { 
        status: 'DOWN', 
        message: 'Failed to connect to Qdrant.',
        details: error.message 
      };
    }
  }

  private async checkOllama(): Promise<ServiceHealthStatus> {
    try {
      // Check connection and list available models
      const response = await ollamaClient.list();
      const models = response.models.map(m => m.name);
      const isModelAvailable = models.some(m => m.includes(config.embeddingModel));
      
      return { 
        status: 'UP', 
        message: 'Successfully connected to Ollama.',
        details: {
          availableModels: models,
          targetModel: config.embeddingModel,
          targetModelPulled: isModelAvailable
        }
      };
    } catch (error: any) {
      return { 
        status: 'DOWN', 
        message: 'Failed to connect to Ollama.',
        details: error.message 
      };
    }
  }
}
