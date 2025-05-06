// src/lib/database.ts
import type { ProductDetail, InventoryItem, DisplayProduct, CountingHistoryEntry } from '@/types/product';
import type { DBSchema, IDBPDatabase, StoreNames, StoreValue } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 2; // Incremented version to trigger upgrade
const PRODUCT_STORE = 'products';
const HISTORY_STORE = 'countingHistory'; // New store name

// --- Database Initialization ---
let dbInstance: IDBPDatabase<StockCounterDBSchema> | null = null;

// Define the database schema using TypeScript interfaces
interface StockCounterDBSchema extends DBSchema {
  [PRODUCT_STORE]: {
    key: string; // barcode
    value: ProductDetail;
    indexes: { 'by-barcode': string, 'by-provider': string };
  };
  [HISTORY_STORE]: {
    key: string; // timestamp or generated id
    value: CountingHistoryEntry;
    indexes: { 'by-timestamp': string, 'by-warehouseId': string }; // Indexes for filtering
  };
}

// Function to open the database
async function openDB(): Promise<IDBPDatabase<StockCounterDBSchema>> {
    if (typeof window === 'undefined') {
        throw new Error("IndexedDB cannot be accessed in this environment.");
    }
    if (dbInstance) {
        // Ensure the connection is still open before returning
        try {
           // Simple check to see if the connection is still usable
           await dbInstance.get(PRODUCT_STORE, ''); // Try a harmless read
           return dbInstance;
        } catch (error) {
             console.warn("IndexedDB connection seems closed or broken, reopening.", error);
             dbInstance = null; // Reset instance
        }
    }

    const { openDB: idbOpenDB } = await import('idb'); // Use renamed import

    return new Promise((resolve, reject) => {
        const request = idbOpenDB<StockCounterDBSchema>(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion, newVersion, transaction) {
                console.log(`Upgrading IndexedDB from version ${oldVersion} to ${newVersion}...`);

                // Create the product store if it doesn't exist (from previous versions)
                 if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
                    const productStore = db.createObjectStore(PRODUCT_STORE, { keyPath: 'barcode' });
                    productStore.createIndex('by-barcode', 'barcode', { unique: true });
                    productStore.createIndex('by-provider', 'provider');
                    console.log(`Object store "${PRODUCT_STORE}" created.`);
                }

                 // Create the history store if it doesn't exist (added in version 2)
                 if (oldVersion < 2 && !db.objectStoreNames.contains(HISTORY_STORE)) {
                    const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' }); // Use 'id' as key path
                    historyStore.createIndex('by-timestamp', 'timestamp');
                    historyStore.createIndex('by-warehouseId', 'warehouseId');
                    console.log(`Object store "${HISTORY_STORE}" created.`);
                }

                // Handle future upgrades here if needed based on oldVersion and newVersion
            },
            blocked() {
                console.error("IndexedDB upgrade blocked. Please close other tabs using this app.");
                // Avoid rejecting here, as the user might just need to close tabs.
                // Maybe notify the user?
                alert("La base de datos necesita actualizarse, por favor cierre otras pestañas de esta aplicación y recargue la página.");
                reject(new Error("IndexedDB upgrade blocked."));
            },
            blocking() {
                console.warn("IndexedDB is blocking an upgrade. Attempting to close the connection.");
                dbInstance?.close(); // Attempt to close the blocking connection
                 // Do not reject here, the upgrade should proceed once the block is released.
            },
            terminated() {
                console.error("IndexedDB connection terminated unexpectedly.");
                dbInstance = null; // Reset instance on termination
                 // Maybe notify user or attempt reconnect?
            }
        });

         request.then(db => {
            console.log("IndexedDB opened successfully.");
            dbInstance = db;
            resolve(db);
        }).catch(error => {
            console.error("Failed to open IndexedDB:", error);
            dbInstance = null; // Ensure instance is null on failure
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
  let tx;
  try {
    const db = await openDB();
    tx = db.transaction(PRODUCT_STORE, 'readwrite');
    // Use Promise.all to perform puts concurrently within the transaction
    await Promise.all(products.map(product => {
        if (product && typeof product.barcode === 'string') {
            return tx.store.put(product);
        } else {
            console.warn("Skipping invalid product data during bulk add:", product);
            return Promise.resolve(); // Resolve promise for invalid data
        }
    }));
    await tx.done;
    console.log(`Bulk added/updated ${products.length} products in IndexedDB.`);
  } catch (error) {
    console.error('Error bulk adding/updating products in IndexedDB:', error);
     if (tx && !tx.done) {
        // Attempt to abort the transaction if it hasn't finished
        try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
    }
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


// --- Operations for Counting History ---

// Save a counting session history entry
export async function saveCountingHistory(historyEntry: CountingHistoryEntry): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    await tx.store.add(historyEntry); // Use add as each entry should be unique
    await tx.done;
    console.log(`Counting history entry saved with ID: ${historyEntry.id}`);
  } catch (error) {
    console.error(`Error saving counting history entry ${historyEntry.id}:`, error);
    throw error;
  }
}

// Get all counting history entries, sorted by timestamp descending
export async function getCountingHistory(): Promise<CountingHistoryEntry[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    const index = tx.store.index('by-timestamp');
    const allHistory = await index.getAll();
    // Sort descending (newest first)
    allHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return allHistory;
  } catch (error) {
    console.error('Error getting counting history from IndexedDB:', error);
    throw error;
  }
}

// Clear the entire counting history store
export async function clearCountingHistory(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    await tx.store.clear();
    await tx.done;
    console.log(`Cleared all entries from IndexedDB store: ${HISTORY_STORE}`);
  } catch (error) {
    console.error('Error clearing counting history in IndexedDB:', error);
    throw error;
  }
}

// --- Combined Database Operations ---

// Clear all data (Products and History)
export async function clearAllDatabases(): Promise<void> {
    console.log("Clearing all IndexedDB data...");
    try {
        await clearProductDatabase();
        await clearCountingHistory();
        console.log("All IndexedDB data cleared successfully.");
    } catch (error) {
        console.error("Error clearing all databases:", error);
        throw error; // Re-throw the error
    }
}


// Dummy export for schema types (needed for DBSchema)
// export type { DBSchema, IDBPDatabase, StoreNames, StoreValue } from 'idb'; // No longer needed to export these directly
export type { StockCounterDBSchema };
export { openDB }; // Export openDB if needed elsewhere, e.g., for preloading
