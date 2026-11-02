import { useCallback, useEffect, useRef, useState } from 'react';
import type { RegisterShipmentInput, Shipment, ShipmentStatus } from '../types';
import {
  ShipmentApiError,
  getShipmentByOrderId,
  listShipments,
  registerShipment,
  shipmentErrorMessage,
  updateShipmentStatus,
} from '../lib/shipments';

export type ShipmentRequestPhase = 'idle' | 'submitting' | 'success' | 'error';

export interface UseShipmentByOrderResult {
  shipment: Shipment | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refresh: () => Promise<void>;
}

/**
 * Reads the mock shipment linked to an escrow order. A 404 is treated as
 * "not registered yet", not as an API failure.
 */
export function useShipmentByOrder(orderId: string | null): UseShipmentByOrderResult {
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (!orderId) {
      setShipment(null);
      setLoading(false);
      setError(null);
      setNotFound(false);
      return;
    }

    setLoading(true);

    try {
      const next = await getShipmentByOrderId(orderId);
      if (requestIdRef.current !== requestId) return;
      setShipment(next);
      setNotFound(false);
      setError(null);
    } catch (caught) {
      if (requestIdRef.current !== requestId) return;

      setShipment(null);

      if (caught instanceof ShipmentApiError && caught.status === 404) {
        setNotFound(true);
        setError(null);
      } else {
        setNotFound(false);
        setError(shipmentErrorMessage(caught));
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { shipment, loading, error, notFound, refresh };
}

export interface UseShipmentRegistrationResult {
  phase: ShipmentRequestPhase;
  shipment: Shipment | null;
  error: string | null;
  register: (input: RegisterShipmentInput) => Promise<Shipment | null>;
  reset: () => void;
}

export function useShipmentRegistration(): UseShipmentRegistrationResult {
  const [phase, setPhase] = useState<ShipmentRequestPhase>('idle');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async (input: RegisterShipmentInput) => {
    setPhase('submitting');
    setError(null);

    try {
      const created = await registerShipment(input);
      setShipment(created);
      setPhase('success');
      return created;
    } catch (caught) {
      setShipment(null);
      setError(shipmentErrorMessage(caught));
      setPhase('error');
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setShipment(null);
    setError(null);
  }, []);

  return { phase, shipment, error, register, reset };
}

export interface UseShipmentSimulatorResult {
  shipments: Shipment[];
  loading: boolean;
  error: string | null;
  updating: string | null;
  actionError: string | null;
  refresh: () => Promise<void>;
  update: (
    trackingId: string,
    status: ShipmentStatus,
    description?: string
  ) => Promise<Shipment | null>;
  clearActionError: () => void;
}

/**
 * Lists mock shipments and applies simulator status transitions. The Express
 * API validates the transition; the UI only offers the expected next states.
 */
export function useShipmentSimulator(): UseShipmentSimulatorResult {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const result = await listShipments();
      if (requestIdRef.current !== requestId) return;
      setShipments(result.shipments);
      setError(null);
    } catch (caught) {
      if (requestIdRef.current !== requestId) return;
      setShipments([]);
      setError(shipmentErrorMessage(caught));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (trackingId: string, status: ShipmentStatus, description?: string) => {
      setUpdating(trackingId);
      setActionError(null);

      try {
        const updated = await updateShipmentStatus(trackingId, status, description);
        setShipments(current =>
          current.map(shipment =>
            shipment.trackingId === updated.trackingId ? updated : shipment
          )
        );
        return updated;
      } catch (caught) {
        setActionError(shipmentErrorMessage(caught));
        return null;
      } finally {
        setUpdating(null);
      }
    },
    []
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    shipments,
    loading,
    error,
    updating,
    actionError,
    refresh,
    update,
    clearActionError,
  };
}
