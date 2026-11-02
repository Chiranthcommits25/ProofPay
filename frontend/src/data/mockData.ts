import type { CheckoutItem } from '../types';

/**
 * Product catalog for checkout. These are display entries only — no escrow
 * data, balances or order status live here. Every financial value comes from
 * ProofPayEscrow, and the seller wallet is supplied at checkout.
 */
export const DEMO_PRODUCTS: CheckoutItem[] = [
  {
    product: 'MacBook Pro 16" M4 Max',
    productDescription: 'Apple MacBook Pro 16-inch with M4 Max chip, 48GB RAM, 1TB SSD',
    seller: 'TechVault Electronics',
    amount: 3499,
    category: 'Electronics',
  },
  {
    product: 'Herman Miller Aeron Chair',
    productDescription: 'Ergonomic office chair, Size C, Graphite frame, fully loaded',
    seller: 'OfficePro Furnishings',
    amount: 1895,
    category: 'Furniture',
  },
  {
    product: 'Sony A7R V Mirrorless Camera',
    productDescription: 'Full-frame 61MP camera body with AI-based autofocus',
    seller: 'CameraWorld Pro',
    amount: 3898,
    category: 'Electronics',
  },
  {
    product: 'Industrial CNC Router',
    productDescription: '4x8ft 3-axis CNC router, 6kW spindle, vacuum table',
    seller: 'PrecisionMach Industrial',
    amount: 12500,
    category: 'Industrial Equipment',
  },
  {
    product: 'Bulk Office Supplies (500 units)',
    productDescription: 'Mixed office supplies: paper, toner cartridges, organizers',
    seller: 'B2B Supply Co.',
    amount: 4200,
    category: 'Bulk Procurement',
  },
  {
    product: 'Leica Q3 Digital Camera',
    productDescription: 'Full-frame 60MP compact camera with Summilux 28mm lens',
    seller: 'CameraWorld Pro',
    amount: 5995,
    category: 'Electronics',
  },
];
