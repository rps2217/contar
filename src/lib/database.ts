// src/lib/database.ts
import type { ProductDetail, InventoryItem, DisplayProduct } from '@/types/product';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 1;
const PRODUCT_STORE = 'products'; // Single store for simplified ProductDetail

// --- Database Initialization ---
let dbInstance: IDBPDatabase<StockCounterDBSchema> | null = null;

// Define the database schema using TypeScript interfaces
interface StockCounterDBSchema extends DBSchema {
  [PRODUCT_STORE]: {
    key: string; // barcode
    value: ProductDetail;
    indexes: { 'by-barcode': string, 'by-provider': string }; // Index by barcode and provider
  };
}

// Function to open the database
async function openDB(): Promise<IDBPDatabase<StockCounterDBSchema>> {
    if (typeof window === 'undefined') {
        throw new Error("IndexedDB cannot be accessed in this environment.");
    }
    if (dbInstance) {
        return dbInstance;
    }

    const { openDB } = await import('idb'); // Dynamically import idb

    return new Promise((resolve, reject) => {
        const request = openDB<StockCounterDBSchema>(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion, newVersion, transaction) {
                console.log(`Upgrading IndexedDB from version ${oldVersion} to ${newVersion}...`);
                // Create the product store if it doesn't exist
                 if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
                    const store = db.createObjectStore(PRODUCT_STORE, { keyPath: 'barcode' });
                    store.createIndex('by-barcode', 'barcode', { unique: true });
                    store.createIndex('by-provider', 'provider'); // Add index for provider
                    console.log(`Object store "${PRODUCT_STORE}" created.`);
                }
                // Handle future upgrades here if needed
            },
            blocked() {
                console.error("IndexedDB upgrade blocked. Please close other tabs using this app.");
                reject(new Error("IndexedDB upgrade blocked."));
            },
            blocking() {
                console.warn("IndexedDB is blocking an upgrade. Closing connection.");
                dbInstance?.close(); // Attempt to close the blocking connection
            },
            terminated() {
                console.error("IndexedDB connection terminated unexpectedly.");
                dbInstance = null; // Reset instance on termination
            }
        });

         request.then(db => {
            console.log("IndexedDB opened successfully.");
            dbInstance = db;
            resolve(db);
        }).catch(error => {
            console.error("Failed to open IndexedDB:", error);
            reject(error);
        });
    });
}

// --- CRUD Operations for ProductDetail ---

// Add or update a product in the database
export async function addOrUpdateProductToDB(product: ProductDetail): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PRODUCT_STORE, 'readwrite');
    await tx.store.put(product); // 'put' handles both add and update
    await tx.done;
    console.log(`Product ${product.barcode} added/updated in IndexedDB.`);
  } catch (error) {
    console.error(`Error adding/updating product ${product.barcode} in IndexedDB:`, error);
    throw error; // Re-throw to allow caller to handle
  }
}

// Get a specific product from the database by barcode
export async function getProductFromDB(barcode: string): Promise<ProductDetail | undefined> {
  try {
    const db = await openDB();
    return await db.get(PRODUCT_STORE, barcode);
  } catch (error) {
    console.error(`Error getting product ${barcode} from IndexedDB:`, error);
    throw error; // Re-throw to allow caller to handle
  }
}

// Get all products from the database
export async function getAllProductsFromDB(): Promise<ProductDetail[]> {
  try {
    const db = await openDB();
    return await db.getAll(PRODUCT_STORE);
  } catch (error) {
    console.error('Error getting all products from IndexedDB:', error);
    throw error; // Re-throw to allow caller to handle
  }
}

// Delete a specific product from the database by barcode
export async function deleteProductFromDB(barcode: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PRODUCT_STORE, 'readwrite');
    await tx.store.delete(barcode);
    await tx.done;
    console.log(`Product ${barcode} deleted from IndexedDB.`);
  } catch (error) {
    console.error(`Error deleting product ${barcode} from IndexedDB:`, error);
    throw error; // Re-throw to allow caller to handle
  }
}

// Bulk add/update products
export async function addProductsToDB(products: ProductDetail[]): Promise<void> {
  if (!products || products.length === 0) {
    console.warn('addProductsToDB called with empty list.');
    return;
  }
  try {
    const db = await openDB();
    const tx = db.transaction(PRODUCT_STORE, 'readwrite');
    await Promise.all(products.map(product => tx.store.put(product)));
    await tx.done;
    console.log(`Bulk added/updated ${products.length} products in IndexedDB.`);
  } catch (error) {
    console.error('Error bulk adding/updating products in IndexedDB:', error);
    throw error;
  }
}


// Clear the entire product store
export async function clearProductDatabase(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(PRODUCT_STORE, 'readwrite');
    await tx.store.clear();
    await tx.done;
    console.log(`Cleared all products from IndexedDB store: ${PRODUCT_STORE}`);
  } catch (error) {
    console.error('Error clearing product database in IndexedDB:', error);
    throw error;
  }
}

// Dummy export for schema types (needed for DBSchema)
export type { DBSchema, IDBPDatabase, StoreNames, StoreValue } from 'idb';
export type { StockCounterDBSchema };
export { openDB }; // Export openDB if needed elsewhere, e.g., for preloading
