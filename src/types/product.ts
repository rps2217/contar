
export interface ProductDetail {
  barcode: string;
  description: string;
  provider: string;
}

export interface InventoryItem {
  barcode: string;
  warehouseId: string; // Identifier for the warehouse (e.g., "main", "storage", "pharmacy1")
  stock: number;       // Stock level in this specific warehouse
  count: number;       // Counted quantity in this specific warehouse during a session
  lastUpdated?: string; // Optional: Timestamp of the last update for this item in this warehouse
}

// Combined type often useful for display purposes, especially in the counting list
// It merges details with the inventory specifics for the current context (warehouse)
export interface DisplayProduct extends ProductDetail, Omit<InventoryItem, 'barcode' | 'warehouseId'> {
    warehouseId: string; // Keep warehouseId for context if needed, otherwise could be omitted if context is clear
}

// Keep original Product type for compatibility or specific use cases if needed,
// but prefer ProductDetail and InventoryItem for the multi-warehouse structure.
// If keeping, decide how 'stock' and 'count' are represented (e.g., total across warehouses?)
// For now, let's comment it out to enforce the new structure.
/*
export interface Product {
  barcode: string;
  description: string;
  provider: string;
  stock: number; // This would likely represent total stock or stock in a default warehouse
  count: number; // This would likely represent count in a specific session/warehouse
  lastUpdated?: string;
}
*/
