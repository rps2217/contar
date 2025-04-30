
export interface Product {
  barcode: string;
  description: string;
  provider: string;
  stock: number;
  count: number;
  lastUpdated?: string; // Optional: Timestamp of the last update
}
