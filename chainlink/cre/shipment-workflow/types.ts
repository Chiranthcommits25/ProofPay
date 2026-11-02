export interface ShipmentEvent {
  status: string;
  timestamp: string;
  description: string;
}

export interface ShipmentRecord {
  trackingId: string;
  orderId: string;
  carrier: string;
  sellerAddress: string;
  description: string | null;
  status: 'CREATED' | 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'LOST' | 'RETURNED';
  simulated: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
  events: ShipmentEvent[];
}

export interface ShipmentListResponse {
  shipments: ShipmentRecord[];
  count: number;
  simulated: boolean;
}

export type SettlementAction = 'RELEASE' | 'REFUND' | 'NONE' | 'MANUAL_REVIEW';

export interface SettlementDecision {
  trackingId: string;
  orderId: string;
  action: SettlementAction;
  reason: string;
  shipmentStatus: ShipmentRecord['status'];
  orderIdBytes32: string;
}

export interface ProofPaySettlementReport {
  orderId: string; // bytes32 hex
  outcome: 'DELIVERED' | 'LOST';
  trackingIdHash: string;
  observedAt: string; // ISO timestamp
}
