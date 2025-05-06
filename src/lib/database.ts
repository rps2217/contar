// src/lib/database.ts
import type { ProductDetail, InventoryItem, DisplayProduct, CountingHistoryEntry } from '@/types/product';
import type { DBSchema, IDBPDatabase, StoreNames, StoreValue, IDBPTransaction } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 2; // Incremented version to trigger upgrade
const PRODUCT_STORE = 'products';
const HISTORY_STORE = 'countingHistory'; // New store name

// --- Database Initialization ---
let dbInstance: IDBPDatabase<StockCounterDBSchema> | null = null;
let openPromise: Promise<IDBPDatabase<StockCounterDBSchema>> | null = null;


// Define the database schema using TypeScript interfaces
interface StockCounterDBSchema extends DBSchema {
  [PRODUCT_STORE]: {
    key: string; // barcode
    value: ProductDetail;
    indexes: { 'by-barcode': string, 'by-provider': string };
  };
  [HISTORY_STORE]: {
    key: string; // id (e.g., timestamp-based string)
    value: CountingHistoryEntry;
    indexes: { 'by-timestamp': string, 'by-warehouseId': string }; // Indexes for filtering
  };
}

// Function to open the database, ensuring only one open request happens at a time
async function openDB(): Promise<IDBPDatabase<StockCounterDBSchema>> {
    if (typeof window === 'undefined') {
        throw new Error("IndexedDB cannot be accessed in this environment.");
    }

    // If an instance exists and seems usable, return it
    if (dbInstance) {
        try {
            await dbInstance.get(PRODUCT_STORE, ''); // Simple check
            return dbInstance;
        } catch (error) {
            console.warn("IndexedDB connection seems closed or broken, attempting to reopen.", error);
            dbInstance = null;
            openPromise = null; // Reset promise if connection broke
        }
    }

    // If an open operation is already in progress, wait for it
    if (openPromise) {
        return openPromise;
    }

    // Start a new open operation
    openPromise = new Promise(async (resolve, reject) => {
        try {
             const { openDB: idbOpenDB } = await import('idb'); // Use renamed import

             const request = idbOpenDB<StockCounterDBSchema>(DB_NAME, DB_VERSION, {
                 upgrade(db, oldVersion, newVersion, transaction, event) {
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
                 blocked(currentVersion, blockedVersion, event) {
                     console.error(`IndexedDB upgrade from version ${currentVersion} to ${blockedVersion} blocked. Please close other tabs using this app.`);
                     alert("La base de datos necesita actualizarse, por favor cierre otras pestañas de esta aplicación y recargue la página.");
                     // Don't reject here, maybe the user needs to close tabs.
                     // Consider adding a state to the app indicating the blocked state.
                 },
                 blocking(currentVersion, blockedVersion, event) {
                     console.warn(`IndexedDB version ${blockedVersion} is blocking upgrade from ${currentVersion}. Attempting to close the blocking connection.`);
                     dbInstance?.close(); // Attempt to close the blocking connection
                 },
                 terminated() {
                     console.error("IndexedDB connection terminated unexpectedly.");
                     dbInstance = null; // Reset instance on termination
                     openPromise = null; // Allow retrying to open
                     // Maybe notify user or attempt reconnect?
                     reject(new Error("IndexedDB connection terminated.")); // Reject the promise on termination
                 }
             });

             request.then(db => {
                console.log("IndexedDB opened successfully.");
                dbInstance = db;
                // Add an event listener for the 'close' event to reset the instance
                db.addEventListener('close', () => {
                    console.warn('IndexedDB connection closed.');
                    dbInstance = null;
                    openPromise = null;
                });
                 db.addEventListener('error', (event) => {
                     console.error('IndexedDB error:', (event.target as any)?.error);
                     // Potentially reset instance or reject promises depending on error
                 });
                resolve(db);
            }).catch(error => {
                console.error("Failed to open IndexedDB:", error);
                dbInstance = null; // Ensure instance is null on failure
                openPromise = null; // Reset promise on failure
                reject(error);
            });

        } catch (error) {
             console.error("Error during IndexedDB open setup:", error);
             openPromise = null;
             reject(error);
        }

    });

    return openPromise;
}


// --- CRUD Operations for ProductDetail ---

// Add or update a product in the database
export async function addOrUpdateProductToDB(product: ProductDetail): Promise<void> {
  let tx: IDBPTransaction<StockCounterDBSchema, [typeof PRODUCT_STORE], "readwrite"> | undefined;
  try {
    const db = await openDB();
    tx = db.transaction(PRODUCT_STORE, 'readwrite');
    await tx.store.put(product); // 'put' handles both add and update
    await tx.done;
    console.log(`Product ${product.barcode} added/updated in IndexedDB.`);
  } catch (error) {
    console.error(`Error adding/updating product ${product.barcode} in IndexedDB:`, error);
     if (tx && !tx.done && tx.abort) {
      try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
    }
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
  let tx: IDBPTransaction<StockCounterDBSchema, [typeof PRODUCT_STORE], "readwrite"> | undefined;
  try {
    const db = await openDB();
    tx = db.transaction(PRODUCT_STORE, 'readwrite');
    await tx.store.delete(barcode);
    await tx.done;
    console.log(`Product ${barcode} deleted from IndexedDB.`);
  } catch (error) {
    console.error(`Error deleting product ${barcode} from IndexedDB:`, error);
    if (tx && !tx.done && tx.abort) {
      try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
    }
    throw error; // Re-throw to allow caller to handle
  }
}

// Bulk add/update products
export async function addProductsToDB(products: ProductDetail[]): Promise<void> {
  if (!products || products.length === 0) {
    console.warn('addProductsToDB called with empty list.');
    return;
  }
  let tx: IDBPTransaction<StockCounterDBSchema, [typeof PRODUCT_STORE], "readwrite"> | undefined;
  try {
    const db = await openDB();
    tx = db.transaction(PRODUCT_STORE, 'readwrite');
    // Use Promise.all to perform puts concurrently within the transaction
    await Promise.all(products.map(product => {
        if (product && typeof product.barcode === 'string') {
            // Ensure stockPerWarehouse exists and is an object
            const productToPut: ProductDetail = {
               ...product,
               stockPerWarehouse: product.stockPerWarehouse || {}, // Default to empty object if missing
            };
            return tx!.store.put(productToPut);
        } else {
            console.warn("Skipping invalid product data during bulk add:", product);
            return Promise.resolve(); // Resolve promise for invalid data
        }
    }));
    await tx.done;
    console.log(`Bulk added/updated ${products.length} products in IndexedDB.`);
  } catch (error) {
    console.error('Error bulk adding/updating products in IndexedDB:', error);
     if (tx && !tx.done && tx.abort) {
        try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
    }
    throw error;
  }
}


// Clear the entire product store
export async function clearProductDatabase(): Promise<void> {
   let tx: IDBPTransaction<StockCounterDBSchema, [typeof PRODUCT_STORE], "readwrite"> | undefined;
  try {
    const db = await openDB();
    tx = db.transaction(PRODUCT_STORE, 'readwrite');
    await tx.store.clear();
    await tx.done;
    console.log(`Cleared all products from IndexedDB store: ${PRODUCT_STORE}`);
  } catch (error) {
    console.error('Error clearing product database in IndexedDB:', error);
    if (tx && !tx.done && tx.abort) {
      try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
    }
    throw error;
  }
}


// --- Operations for Counting History ---

// Save a counting session history entry
export async function saveCountingHistory(historyEntry: CountingHistoryEntry): Promise<void> {
  let tx: IDBPTransaction<StockCounterDBSchema, [typeof HISTORY_STORE], "readwrite"> | undefined;
  try {
    // Ensure required fields are present
    if (!historyEntry.id || !historyEntry.timestamp || !historyEntry.warehouseId || !historyEntry.warehouseName || !Array.isArray(historyEntry.products)) {
        throw new Error("Invalid history entry data. Required fields are missing.");
    }
    const db = await openDB();
    tx = db.transaction(HISTORY_STORE, 'readwrite');
    await tx.store.add(historyEntry); // Use add as each entry should be unique
    await tx.done;
    console.log(`Counting history entry saved with ID: ${historyEntry.id}`);
  } catch (error) {
    console.error(`Error saving counting history entry ${historyEntry?.id}:`, error);
     if (tx && !tx.done && tx.abort) {
        try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
    }
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
   let tx: IDBPTransaction<StockCounterDBSchema, [typeof HISTORY_STORE], "readwrite"> | undefined;
  try {
    const db = await openDB();
    tx = db.transaction(HISTORY_STORE, 'readwrite');
    await tx.store.clear();
    await tx.done;
    console.log(`Cleared all entries from IndexedDB store: ${HISTORY_STORE}`);
  } catch (error) {
    console.error('Error clearing counting history in IndexedDB:', error);
     if (tx && !tx.done && tx.abort) {
        try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
    }
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


// Export the schema type if needed elsewhere (though usually not necessary for consumers)
export type { StockCounterDBSchema };
// Export openDB only if direct access is truly needed outside this module
// export { openDB };
