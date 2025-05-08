// src/lib/database.ts
import type { ProductDetail, InventoryItem, DisplayProduct, CountingHistoryEntry } from '@/types/product';
import type { DBSchema, IDBPDatabase, StoreNames, StoreValue, IDBPTransaction, OpenDBCallbacks } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 2; // Keep version consistent
const PRODUCT_STORE = 'products';
const HISTORY_STORE = 'countingHistory'; // Keep history store

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

// Callbacks for database upgrade, blocking, etc.
const dbCallbacks: OpenDBCallbacks<StockCounterDBSchema> = {
    upgrade(db, oldVersion, newVersion, transaction, event) {
        console.log(`Upgrading IndexedDB from version ${oldVersion} to ${newVersion}...`);

        // Create PRODUCT_STORE if it doesn't exist
        if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
            const productStore = db.createObjectStore(PRODUCT_STORE, { keyPath: 'barcode' });
            productStore.createIndex('by-barcode', 'barcode', { unique: true });
            productStore.createIndex('by-provider', 'provider');
            console.log(`Object store "${PRODUCT_STORE}" created.`);
        }

        // Create HISTORY_STORE if it doesn't exist (added in version 2)
        if (oldVersion < 2 && !db.objectStoreNames.contains(HISTORY_STORE)) {
            const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
            historyStore.createIndex('by-timestamp', 'timestamp');
            historyStore.createIndex('by-warehouseId', 'warehouseId');
            console.log(`Object store "${HISTORY_STORE}" created.`);
        }
        // Handle future upgrades here
    },
    blocked(currentVersion, blockedVersion, event) {
        console.error(`IndexedDB upgrade from version ${currentVersion} to ${blockedVersion} blocked. Please close other tabs using this app.`);
        alert("La base de datos necesita actualizarse, por favor cierre otras pestañas de esta aplicación y recargue la página.");
        // Consider a state management solution to notify the user globally
    },
    blocking(currentVersion, blockedVersion, event) {
        console.warn(`IndexedDB version ${blockedVersion} is blocking upgrade from ${currentVersion}. Attempting to close the blocking connection.`);
        // Try to close the blocking connection. This might be the current connection.
        (event.target as IDBPDatabase)?.close();
        dbInstance = null; // Reset instance since it's blocking
        openPromise = null;
    },
    terminated() {
        console.error("IndexedDB connection terminated unexpectedly.");
        dbInstance = null; // Reset instance
        openPromise = null;
        // Maybe notify user or attempt reconnect?
    }
};


// Optimized function to get the database instance
async function getDB(): Promise<IDBPDatabase<StockCounterDBSchema>> {
    if (dbInstance) {
        // Simple check if connection is still alive
        try {
            // Attempt a lightweight operation like getting store names
            dbInstance.objectStoreNames;
            return dbInstance;
        } catch (error) {
            console.warn("IndexedDB connection seems closed or broken, reopening.", error);
            dbInstance = null;
            openPromise = null; // Force re-opening
        }
    }

    if (!openPromise) {
        if (typeof window === 'undefined') {
             return Promise.reject(new Error("IndexedDB cannot be accessed in this environment."));
        }
        console.log("Opening IndexedDB connection...");
        openPromise = import('idb').then(({ openDB: idbOpenDB }) => {
             return idbOpenDB<StockCounterDBSchema>(DB_NAME, DB_VERSION, dbCallbacks);
        }).then(db => {
            console.log("IndexedDB opened successfully.");
            dbInstance = db;
             // Add event listeners for automatic handling of close/error
             db.addEventListener('close', () => {
                console.warn('IndexedDB connection closed.');
                dbInstance = null;
                openPromise = null;
             });
             db.addEventListener('error', (event) => {
                console.error('IndexedDB error:', (event.target as any)?.error);
                // Depending on error, might need to reset dbInstance and openPromise
             });
            openPromise = null; // Clear promise once resolved
            return db;
        }).catch(error => {
            console.error("Failed to open IndexedDB:", error);
            dbInstance = null;
            openPromise = null; // Clear promise on failure
            throw error; // Re-throw the error
        });
    }

    return openPromise;
}


// --- CRUD Operations for ProductDetail (Optimized) ---

// Generic function to perform a readwrite transaction
async function performWriteTransaction<T>(
    storeName: StoreNames<StockCounterDBSchema>,
    operation: (store: IDBPTransaction<StockCounterDBSchema, [typeof storeName], "readwrite">['store']) => Promise<T>
): Promise<T> {
    let tx: IDBPTransaction<StockCounterDBSchema, [typeof storeName], "readwrite"> | undefined;
    try {
        const db = await getDB();
        tx = db.transaction(storeName, 'readwrite');
        const result = await operation(tx.store);
        await tx.done;
        return result;
    } catch (error) {
        console.error(`Error performing write operation on store ${storeName}:`, error);
        if (tx && !tx.done && tx.abort) {
            try { await tx.abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
        }
        throw error;
    }
}

// Optimized add/update function
export async function addOrUpdateProductToDB(product: ProductDetail): Promise<void> {
    const productToSave: ProductDetail = {
        ...product,
        // Ensure stock is a number, default to 0 if invalid or missing
        stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
        // Clean up description and provider
        description: product.description?.trim() || `Producto ${product.barcode}`,
        provider: product.provider?.trim() || "Desconocido",
    };
    console.log("Attempting to add/update product in DB:", productToSave);
    await performWriteTransaction(PRODUCT_STORE, store => store.put(productToSave));
    console.log(`Product ${productToSave.barcode} added/updated.`);
}

export async function getProductFromDB(barcode: string): Promise<ProductDetail | undefined> {
  try {
    const db = await getDB();
    return await db.get(PRODUCT_STORE, barcode);
  } catch (error) {
    console.error(`Error getting product ${barcode} from IndexedDB:`, error);
    throw error;
  }
}

export async function getAllProductsFromDB(): Promise<ProductDetail[]> {
  try {
    const db = await getDB();
    return await db.getAll(PRODUCT_STORE);
  } catch (error) {
    console.error('Error getting all products from IndexedDB:', error);
    throw error;
  }
}

// Optimized delete function
export async function deleteProductFromDB(barcode: string): Promise<void> {
    if (!barcode) {
        console.error("Attempted to delete product with empty barcode.");
        return;
    }
    console.log(`Attempting to delete product ${barcode} from DB.`);
    await performWriteTransaction(PRODUCT_STORE, store => store.delete(barcode));
    console.log(`Product ${barcode} deleted.`);
}


// Bulk add/update products (Optimized with single transaction)
export async function addProductsToDB(products: ProductDetail[]): Promise<void> {
  if (!products || products.length === 0) {
    console.warn('addProductsToDB called with empty list.');
    return;
  }
  await performWriteTransaction(PRODUCT_STORE, async (store) => {
    await Promise.all(products.map(product => {
        if (product && typeof product.barcode === 'string') {
            // Ensure stock is a number, default to 0 if invalid/missing
             const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
             const productToPut: ProductDetail = {
                ...product,
                stock: stock, // Use validated/defaulted stock
             };
             return store.put(productToPut);
        } else {
            console.warn("Skipping invalid product data during bulk add:", product);
            return Promise.resolve();
        }
    }));
  });
   console.log(`Bulk added/updated ${products.length} products.`);
}

// Clear the entire product store
export async function clearProductDatabase(): Promise<void> {
   await performWriteTransaction(PRODUCT_STORE, store => store.clear());
   console.log(`Cleared all products from store: ${PRODUCT_STORE}`);
}


// --- Operations for Counting History (Optimized) ---

export async function saveCountingHistory(historyEntry: CountingHistoryEntry): Promise<void> {
   if (!historyEntry.id || !historyEntry.timestamp || !historyEntry.warehouseId || !historyEntry.warehouseName || !Array.isArray(historyEntry.products)) {
       throw new Error("Invalid history entry data. Required fields are missing.");
   }
   await performWriteTransaction(HISTORY_STORE, store => store.add(historyEntry));
   console.log(`Counting history entry saved with ID: ${historyEntry.id}`);
}

export async function getCountingHistory(): Promise<CountingHistoryEntry[]> {
  try {
    const db = await getDB();
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

export async function clearCountingHistory(): Promise<void> {
    await performWriteTransaction(HISTORY_STORE, store => store.clear());
    console.log(`Cleared all entries from store: ${HISTORY_STORE}`);
}

// --- Combined Database Operations ---

// Clear all data (Products and History) - Uses separate transactions for clarity
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
// Export getDB only if direct access is truly needed outside this module
// export { getDB };
