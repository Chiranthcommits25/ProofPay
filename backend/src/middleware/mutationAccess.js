function isLoopback(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  const address = raw.replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1' || address === '0:0:0:0:0:0:0:1';
}

/**
 * Demo gate for shipment mutations, not real authentication: a configured
 * SHIPMENT_SIMULATOR_TOKEN must match `x-simulator-token`, otherwise mutations
 * are accepted only from loopback unless SHIPMENT_ALLOW_REMOTE_MUTATIONS=true.
 */
export function requireMutationAccess(config) {
  return function mutationAccess(req, res, next) {
    if (config.simulatorToken) {
      const provided = req.get('x-simulator-token') ?? '';

      if (provided !== config.simulatorToken) {
        return res.status(403).json({
          error: 'A valid simulator token is required for shipment mutations.',
          code: 'MUTATION_FORBIDDEN',
        });
      }

      return next();
    }

    if (config.allowRemoteMutations || isLoopback(req)) {
      return next();
    }

    return res.status(403).json({
      error:
        'Shipment mutations are restricted to localhost in this demo. Set SHIPMENT_SIMULATOR_TOKEN for authenticated remote mutations.',
      code: 'MUTATION_LOCAL_ONLY',
    });
  };
}
