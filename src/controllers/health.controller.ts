import { Request, Response } from 'express';
import { HealthService } from '../services/health.service';

const healthService = new HealthService();

export const getHealth = async (req: Request, res: Response): Promise<void> => {
  try {
    const healthResult = await healthService.checkAllServices();
    
    if (healthResult.status === 'DOWN') {
      res.status(503).json(healthResult);
      return;
    }
    
    res.status(200).json(healthResult);
  } catch (error: any) {
    res.status(500).json({
      status: 'DOWN',
      message: 'Critical error while executing health checks.',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
