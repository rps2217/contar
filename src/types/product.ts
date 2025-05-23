// src/types/product.ts
import type { Timestamp } from 'firebase/firestore';


/**
 * Represents the core details of a product, independent of warehouse or stock count.
 */
export interface ProductDetail {
  barcode: string;
  description: string;
  provider: string;
  stock?: number; // Optional: Base stock level (if managed centrally)
  expirationDate?: string | null; // Optional: ISO 8601 format YYYY-MM-DD or null
  // Potential future fields:
  // category?: string;
  // unit?: string; // e.g., 'pcs', 'kg', 'm'
}

/**
 * Represents the inventory status of a specific product within a specific warehouse.
 */
export interface InventoryItem {
  barcode: string;       // Links to ProductDetail
  warehouseId: string; // Identifier for the warehouse (e.g., "main", "storage", "pharmacy1")
  stock: number;       // Stock level in this specific warehouse (often from ProductDetail)
  count: number;       // Counted quantity in this specific warehouse during a session
  lastUpdated?: string; // Optional: ISO 8601 timestamp of the last update for this item in this warehouse
  firestoreLastUpdated?: Timestamp; // For Firestore server-side ordering
}

/**
 * Combined type often useful for display purposes, especially in the counting list.
 * It merges product details with the inventory specifics for the current context (warehouse).
 */
export interface DisplayProduct extends ProductDetail, Omit<InventoryItem, 'barcode' | 'warehouseId' | 'stock' | 'firestoreLastUpdated'> {
    warehouseId: string; // Keep warehouseId for context
    // stock and count are inherited from InventoryItem via Omit and included in ProductDetail potentially
    // expirationDate is inherited from ProductDetail
}

/**
 * Structure for storing a snapshot of a counting session in the history.
 */
export interface CountingHistoryEntry {
  id: string; // Unique identifier for the history entry (e.g., timestamp-based)
  userId: string; // Identifier for the user who created this entry
  timestamp: string; // ISO 8601 timestamp when the history was saved
  warehouseId: string;
  warehouseName: string; // Store the name for easier display
  products: DisplayProduct[]; // A snapshot of the counting list at the time of saving
  // firestoreTimestamp?: Timestamp; // For Firestore server-side ordering - Handled by firestore-service.ts
}


/**
 * Represents a warehouse.
 */
export interface Warehouse {
  id: string;
  name: string;
}

/**
 * Represents an item in the consolidated inventory view.
 */
export interface ConsolidatedProductViewItem {
  barcode: string;
  description: string;
  masterStock: number; // Stock from the master product catalog
  totalCountedQuantity: number;
  warehousesPresent: string[]; // Names of warehouses where the product was counted
  provider?: string; // Optional provider information from catalog
}


// Note: The original `Product` type has been removed to favor the more specific
// `ProductDetail` and `InventoryItem` types for better clarity in a multi-warehouse context.
// `DisplayProduct` serves as the combined view needed for UI components like the counting list.
