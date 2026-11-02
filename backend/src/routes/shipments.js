import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireMutationAccess } from '../middleware/mutationAccess.js';

export function createShipmentRouter({ shipmentService, config }) {
  const router = Router();
  const mutationAccess = requireMutationAccess(config);

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-ProofPay-Data-Source', 'mock-courier-simulator');
    next();
  });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(shipmentService.list(req.query));
    })
  );

  // Keep the more specific route before /:trackingId.
  router.get(
    '/order/:orderId',
    asyncHandler(async (req, res) => {
      res.json(shipmentService.getByOrderId(req.params.orderId));
    })
  );

  router.get(
    '/:trackingId',
    asyncHandler(async (req, res) => {
      res.json(shipmentService.getByTrackingId(req.params.trackingId));
    })
  );

  router.post(
    '/',
    mutationAccess,
    asyncHandler(async (req, res) => {
      const shipment = await shipmentService.register(req.body);
      res
        .status(201)
        .location(`/api/shipments/${shipment.trackingId}`)
        .json(shipment);
    })
  );

  router.patch(
    '/:trackingId/status',
    mutationAccess,
    asyncHandler(async (req, res) => {
      const shipment = await shipmentService.updateStatus(
        req.params.trackingId,
        req.body
      );
      res.json(shipment);
    })
  );

  return router;
}
