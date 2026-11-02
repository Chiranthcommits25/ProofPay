import cors from 'cors';
import express from 'express';
import { ApiError } from './lib/errors.js';
import { ShipmentStorageError } from './services/shipmentStore.js';
import { createShipmentRouter } from './routes/shipments.js';

function corsOptions(origin) {
  if (!origin || origin === '*') return {};
  return {
    origin: origin
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  };
}

export function createApp({ config, shipmentService, store }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors(corsOptions(config.corsOrigin)));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'proofpay-backend',
      timestamp: new Date().toISOString(),
      shipments: {
        storage: 'json-file',
        dataFile: store.filePath,
        simulated: true,
      },
    });
  });

  app.get('/', (req, res) => {
    res.send('ProofPay API is running');
  });

  app.use('/api/shipments', createShipmentRouter({ shipmentService, config }));

  app.use((req, res) => {
    res.status(404).json({
      error: `Route not found: ${req.method} ${req.originalUrl}`,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof ApiError) {
      const body = { error: error.message, code: error.code };
      if (error.details !== undefined) body.details = error.details;
      return res.status(error.status).json(body);
    }

    if (error instanceof ShipmentStorageError) {
      console.error('[proofpay-backend] Shipment storage error:', error.message);
      return res.status(500).json({
        error: 'Shipment data could not be read or written.',
        code: 'STORAGE_ERROR',
      });
    }

    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'Request body is not valid JSON.',
        code: 'INVALID_JSON',
      });
    }

    if (error?.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'Request body is too large.',
        code: 'PAYLOAD_TOO_LARGE',
      });
    }

    console.error('[proofpay-backend] Unhandled error:', error);
    return res.status(500).json({
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  });

  return app;
}
