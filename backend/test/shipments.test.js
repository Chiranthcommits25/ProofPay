import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { ShipmentService } from '../src/services/shipmentService.js';
import { ShipmentStore } from '../src/services/shipmentStore.js';

const SELLER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const OTHER_SELLER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const BUYER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const RELEASED_ORDER = `0x${'22'.repeat(32)}`;
const UNKNOWN_ORDER = `0x${'33'.repeat(32)}`;
const FIXED_TIME = '2026-10-31T10:00:00.000Z';

function fundedOrder(index) {
  return `0x${index.toString(16).padStart(64, '0')}`;
}

function fakeChain() {
  const calls = [];

  return {
    calls,
    async verifyEscrow(orderId) {
      calls.push(orderId);

      if (orderId === UNKNOWN_ORDER) return null;

      return {
        orderId,
        buyer: BUYER,
        seller: SELLER,
        amount: 10n,
        createdAt: 1_700_000_000,
        settledAt: orderId === RELEASED_ORDER ? 1_700_000_100 : 0,
        status: orderId === RELEASED_ORDER ? 2 : 1,
      };
    },
  };
}

async function startTestApp({
  dataFile = null,
  simulatorToken = '',
  allowRemoteMutations = true,
} = {}) {
  const directory = dataFile ? null : await mkdtemp(join(tmpdir(), 'proofpay-shipments-'));
  const file = dataFile ?? join(directory, 'shipments.json');
  const store = new ShipmentStore(file);
  await store.load();

  const chainVerifier = fakeChain();
  const shipmentService = new ShipmentService({
    store,
    chainVerifier,
    clock: () => new Date(FIXED_TIME),
  });

  const app = createApp({
    config: { corsOrigin: '*', simulatorToken, allowRemoteMutations },
    shipmentService,
    store,
  });

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    chainVerifier,
    dataFile: file,
    directory,
    server,
    store,
  };
}

async function closeTestApp(context, { cleanup = true } = {}) {
  await new Promise((resolve, reject) => {
    context.server.close(error => (error ? reject(error) : resolve()));
  });

  if (cleanup && context.directory) {
    await rm(context.directory, { recursive: true, force: true });
  }
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { body, headers: response.headers, status: response.status };
}

function registerBody(overrides = {}) {
  return JSON.stringify({
    orderId: fundedOrder(0x11),
    trackingId: 'TRK-TEST-001',
    carrier: 'MockCourier',
    sellerAddress: SELLER,
    description: 'Test shipment',
    ...overrides,
  });
}

test('mock shipment API', async t => {
  const context = await startTestApp();
  t.after(() => closeTestApp(context));

  let deliveredTrackingId = null;

  await t.test('registers a shipment for a funded escrow', async () => {
    const response = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody(),
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.trackingId, 'TRK-TEST-001');
    assert.equal(response.body.orderId, fundedOrder(0x11));
    assert.equal(response.body.carrier, 'MockCourier');
    assert.equal(response.body.status, 'CREATED');
    assert.equal(response.body.simulated, true);
    assert.equal(response.body.source, 'mock-courier-simulator');
    assert.equal(response.body.events.length, 1);
    assert.equal(response.body.events[0].status, 'CREATED');
    assert.equal(response.body.events[0].timestamp, FIXED_TIME);
    assert.equal(response.body.createdAt, FIXED_TIME);
    assert.equal(response.body.updatedAt, FIXED_TIME);
    assert.match(response.headers.get('location'), /\/api\/shipments\/TRK-TEST-001$/);
    assert.match(response.headers.get('x-proofpay-data-source'), /mock-courier-simulator/);
    assert.equal(context.chainVerifier.calls.length, 1);
  });

  await t.test('retrieves a shipment by tracking ID', async () => {
    const response = await request(context.baseUrl, '/api/shipments/trk-test-001');

    assert.equal(response.status, 200);
    assert.equal(response.body.trackingId, 'TRK-TEST-001');
    assert.equal(response.body.events.length, 1);
  });

  await t.test('retrieves a shipment by order ID', async () => {
    const response = await request(
      context.baseUrl,
      `/api/shipments/order/${fundedOrder(0x11)}`
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.trackingId, 'TRK-TEST-001');
  });

  await t.test('advances CREATED -> SHIPPED -> IN_TRANSIT -> DELIVERED', async () => {
    for (const status of ['SHIPPED', 'IN_TRANSIT', 'DELIVERED']) {
      const response = await request(
        context.baseUrl,
        '/api/shipments/TRK-TEST-001/status',
        { method: 'PATCH', body: JSON.stringify({ status }) }
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.status, status);
    }

    const response = await request(context.baseUrl, '/api/shipments/TRK-TEST-001');
    deliveredTrackingId = response.body.trackingId;

    assert.equal(response.body.status, 'DELIVERED');
    assert.equal(response.body.events.length, 4);
    assert.deepEqual(
      response.body.events.map(event => event.status),
      ['CREATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED']
    );
    assert.ok(response.body.events.every(event => event.timestamp === FIXED_TIME));
  });

  await t.test('simulates a LOST shipment and rejects terminal updates', async () => {
    const trackingId = 'TRK-TEST-LOST';

    const created = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({ orderId: fundedOrder(0x44), trackingId }),
    });
    assert.equal(created.status, 201);

    for (const status of ['SHIPPED', 'IN_TRANSIT', 'LOST']) {
      const updated = await request(
        context.baseUrl,
        `/api/shipments/${trackingId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) }
      );
      assert.equal(updated.status, 200);
      assert.equal(updated.body.status, status);
    }

    const afterLost = await request(
      context.baseUrl,
      `/api/shipments/${trackingId}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: 'DELIVERED' }) }
    );
    assert.equal(afterLost.status, 409);
    assert.equal(afterLost.body.code, 'INVALID_STATUS_TRANSITION');
    assert.deepEqual(afterLost.body.details.allowed, []);
  });

  await t.test('allows DELIVERED -> RETURNED as the mock return path', async () => {
    const response = await request(
      context.baseUrl,
      `/api/shipments/${deliveredTrackingId}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: 'RETURNED' }) }
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'RETURNED');
    assert.equal(response.body.events.at(-1).status, 'RETURNED');
  });

  await t.test('rejects invalid transitions with allowed next states', async () => {
    const trackingId = 'TRK-TEST-INVALID';
    const created = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({ orderId: fundedOrder(0x55), trackingId }),
    });
    assert.equal(created.status, 201);

    const response = await request(
      context.baseUrl,
      `/api/shipments/${trackingId}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: 'DELIVERED' }) }
    );

    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'INVALID_STATUS_TRANSITION');
    assert.deepEqual(response.body.details.allowed, ['SHIPPED']);
  });

  await t.test('rejects duplicate tracking IDs and duplicate order shipments', async () => {
    const duplicateTracking = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({ orderId: fundedOrder(0x66) }),
    });
    assert.equal(duplicateTracking.status, 409);
    assert.equal(duplicateTracking.body.code, 'DUPLICATE_TRACKING_ID');

    const duplicateOrder = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({ orderId: fundedOrder(0x11), trackingId: 'TRK-TEST-002' }),
    });
    assert.equal(duplicateOrder.status, 409);
    assert.equal(duplicateOrder.body.code, 'SHIPMENT_ALREADY_EXISTS');
  });

  await t.test('rejects unknown tracking IDs and malformed identifiers', async () => {
    const unknown = await request(context.baseUrl, '/api/shipments/TRK-NOT-FOUND');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'SHIPMENT_NOT_FOUND');

    const malformedTracking = await request(context.baseUrl, '/api/shipments/abc');
    assert.equal(malformedTracking.status, 400);
    assert.equal(malformedTracking.body.code, 'INVALID_TRACKING_ID');

    const malformedOrder = await request(
      context.baseUrl,
      '/api/shipments/order/not-an-order'
    );
    assert.equal(malformedOrder.status, 400);
    assert.equal(malformedOrder.body.code, 'INVALID_ORDER_ID');
  });

  await t.test('rejects shipments for non-funded or unknown escrows', async () => {
    const released = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({
        orderId: RELEASED_ORDER,
        trackingId: 'TRK-TEST-RELEASED',
      }),
    });
    assert.equal(released.status, 409);
    assert.equal(released.body.code, 'ESCROW_NOT_FUNDED');

    const unknown = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({
        orderId: UNKNOWN_ORDER,
        trackingId: 'TRK-TEST-UNKNOWN',
      }),
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'ESCROW_NOT_FOUND');
  });

  await t.test('rejects a seller address that does not match the escrow', async () => {
    const response = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({
        orderId: fundedOrder(0x77),
        trackingId: 'TRK-TEST-SELLER',
        sellerAddress: OTHER_SELLER,
      }),
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'SELLER_MISMATCH');
  });

  await t.test('lists shipments with order and status filters', async () => {
    const all = await request(context.baseUrl, '/api/shipments');
    assert.equal(all.status, 200);
    assert.equal(all.body.simulated, true);
    assert.equal(all.body.count, all.body.shipments.length);
    assert.ok(all.body.count >= 3);

    const byStatus = await request(context.baseUrl, '/api/shipments?status=RETURNED');
    assert.equal(byStatus.status, 200);
    assert.ok(byStatus.body.shipments.every(shipment => shipment.status === 'RETURNED'));

    const byOrder = await request(
      context.baseUrl,
      `/api/shipments?orderId=${fundedOrder(0x11)}`
    );
    assert.equal(byOrder.status, 200);
    assert.equal(byOrder.body.count, 1);
    assert.equal(byOrder.body.shipments[0].trackingId, 'TRK-TEST-001');

    const invalidStatus = await request(context.baseUrl, '/api/shipments?status=NOPE');
    assert.equal(invalidStatus.status, 400);
    assert.equal(invalidStatus.body.code, 'INVALID_STATUS');
  });

  await t.test('rejects malformed JSON bodies', async () => {
    const response = await request(context.baseUrl, '/api/shipments', {
      method: 'POST',
      body: '{"orderId":',
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_JSON');
  });

  await t.test('returns a stable 404 for unknown routes', async () => {
    const response = await request(context.baseUrl, '/api/not-a-route');
    assert.equal(response.status, 404);
    assert.equal(response.body.code, 'ROUTE_NOT_FOUND');
  });

  await t.test('persists shipment history across a restart', async () => {
    const first = await startTestApp();
    const trackingId = 'TRK-PERSIST-001';

    const created = await request(first.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({ orderId: fundedOrder(0x88), trackingId }),
    });
    assert.equal(created.status, 201);

    const shipped = await request(first.baseUrl, `/api/shipments/${trackingId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SHIPPED' }),
    });
    assert.equal(shipped.status, 200);

    await closeTestApp(first, { cleanup: false });

    const second = await startTestApp({ dataFile: first.dataFile });
    t.after(async () => {
      await closeTestApp(second);
      await rm(first.directory, { recursive: true, force: true });
    });

    const reloaded = await request(second.baseUrl, `/api/shipments/${trackingId}`);
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.status, 'SHIPPED');
    assert.equal(reloaded.body.events.length, 2);

    const fileContents = JSON.parse(await readFile(first.dataFile, 'utf8'));
    assert.equal(fileContents.version, 1);
    assert.equal(fileContents.shipments.length, 1);
  });

  await t.test('restricts mutations with a simulator token', async () => {
    const secured = await startTestApp({ simulatorToken: 'demo-secret' });
    t.after(() => closeTestApp(secured));

    const withoutToken = await request(secured.baseUrl, '/api/shipments', {
      method: 'POST',
      body: registerBody({ orderId: fundedOrder(0x99), trackingId: 'TRK-SECURED' }),
    });
    assert.equal(withoutToken.status, 403);
    assert.equal(withoutToken.body.code, 'MUTATION_FORBIDDEN');

    const withToken = await request(secured.baseUrl, '/api/shipments', {
      method: 'POST',
      headers: { 'x-simulator-token': 'demo-secret' },
      body: registerBody({ orderId: fundedOrder(0x99), trackingId: 'TRK-SECURED' }),
    });
    assert.equal(withToken.status, 201);
  });
});
