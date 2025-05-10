// src/lib/database.ts
import type { ProductDetail, CountingHistoryEntry } from '@/types/product';
import type { DBSchema, IDBPDatabase, StoreNames, IDBPTransaction, OpenDBCallbacks } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 3; // Incremented version for schema change
const PRODUCT_STORE = 'products';
const HISTORY_STORE = 'countingHistory'; 

// --- Database Initialization ---
let dbInstance: IDBPDatabase<StockCounterDBSchema> | null = null;
let openPromise: Promise<IDBPDatabase<StockCounterDBSchema>> | null = null;


// Define the database schema using TypeScript interfaces
interface StockCounterDBSchema extends DBSchema {
  [PRODUCT_STORE]: {
    key: string; // barcode
    value: ProductDetail; // Includes expirationDate
    indexes: { 'by-barcode': string, 'by-provider': string, 'by-expirationDate'?: string }; // Added expirationDate index
  };
  [HISTORY_STORE]: {
    key: string; // id (e.g., timestamp-based string)
    value: CountingHistoryEntry;
    indexes: { 'by-timestamp': string, 'by-warehouseId': string, 'by-userId'?: string };
  };
}

// Callbacks for database upgrade, blocking, etc.
const dbCallbacks: OpenDBCallbacks<StockCounterDBSchema> = {
    upgrade(db, oldVersion, newVersion, transaction, event) {
        console.log(`Upgrading IndexedDB from version ${oldVersion} to ${newVersion}...`);

        if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
            const productStore = db.createObjectStore(PRODUCT_STORE, { keyPath: 'barcode' });
            productStore.createIndex('by-barcode', 'barcode', { unique: true });
            productStore.createIndex('by-provider', 'provider');
            productStore.createIndex('by-expirationDate', 'expirationDate'); // Add index for expirationDate
            console.log(`Object store "${PRODUCT_STORE}" created with expirationDate index.`);
        } else {
            const productStore = transaction.objectStore(PRODUCT_STORE);
            if (!productStore.indexNames.contains('by-expirationDate')) {
                productStore.createIndex('by-expirationDate', 'expirationDate');
                console.log(`Index "by-expirationDate" created on store "${PRODUCT_STORE}".`);
            }
        }


        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
            const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
            historyStore.createIndex('by-timestamp', 'timestamp');
            historyStore.createIndex('by-warehouseId', 'warehouseId');
            historyStore.createIndex('by-userId', 'userId');
            console.log(`Object store "${HISTORY_STORE}" created.`);
        } else {
            const historyStore = transaction.objectStore(HISTORY_STORE);
            if (!historyStore.indexNames.contains('by-userId')) {
                historyStore.createIndex('by-userId', 'userId');
                console.log(`Index "by-userId" created on store "${HISTORY_STORE}".`);
            }
        }
    },
    blocked(currentVersion, blockedVersion, event) {
        console.error(`IndexedDB upgrade from version ${currentVersion} to ${blockedVersion} blocked. Please close other tabs using this app.`);
        alert("La base de datos necesita actualizarse, por favor cierre otras pestañas de esta aplicación y recargue la página.");
    },
    blocking(currentVersion, blockedVersion, event) {
        console.warn(`IndexedDB version ${blockedVersion} is blocking upgrade from ${currentVersion}. Attempting to close the blocking connection.`);
        (event.target as IDBPDatabase)?.close();
        dbInstance = null; 
        openPromise = null;
    },
    terminated() {
        console.error("IndexedDB connection terminated unexpectedly.");
        dbInstance = null; 
        openPromise = null;
    }
};


// Optimized function to get the database instance
async function getDB(): Promise<IDBPDatabase<StockCounterDBSchema>> {
    if (dbInstance) {
        try {
            // Check if connection is still alive by trying to access a property
             // that would throw if the connection is closed.
            dbInstance.objectStoreNames; // This will throw if db is closed
            return dbInstance;
        } catch (error) {
            console.warn("IndexedDB connection seems closed or broken, reopening.", error);
            dbInstance = null; // Mark as closed
            openPromise = null; // Reset promise to allow reopening
        }
    }

    if (!openPromise) {
        if (typeof window === 'undefined') {
             // This check might be redundant if openDB is only called client-side,
             // but it's a good safeguard.
             return Promise.reject(new Error("IndexedDB cannot be accessed in this environment."));
        }
        console.log("Opening IndexedDB connection...");
        openPromise = import('idb').then(({ openDB: idbOpenDB }) => {
             // Ensure idbOpenDB is correctly referenced if openDB is a local const
             return idbOpenDB<StockCounterDBSchema>(DB_NAME, DB_VERSION, dbCallbacks);
        }).then(db => {
            console.log("IndexedDB opened successfully.");
            dbInstance = db;
             // Listen for close events to reset the dbInstance
             db.addEventListener('close', () => {
                console.warn('IndexedDB connection closed.');
                dbInstance = null;
                openPromise = null; // Allow re-opening
             });
             // Optional: Listen for versionchange events if needed for specific handling
             db.addEventListener('versionchange', (event) => {
                console.warn('IndexedDB version change detected. Closing connection to allow upgrade.');
                db.close(); // Close the connection to allow the upgrade to proceed.
                dbInstance = null;
                openPromise = null;
             });
             db.addEventListener('error', (event) => {
                // Generic error handling for the DB connection itself
                console.error('IndexedDB error:', (event.target as any)?.error);
             });
            openPromise = null; // Clear the promise once resolved
            return db;
        }).catch(error => {
            console.error("Failed to open IndexedDB:", error);
            dbInstance = null; // Ensure instance is null on failure
            openPromise = null; // Clear promise on failure
            throw error; // Re-throw error to be handled by caller
        });
    }
    return openPromise;
}


// --- CRUD Operations for ProductDetail (Optimized) ---
async function performWriteTransaction<S extends StoreNames<StockCounterDBSchema>, T>(
    storeName: S,
    operation: (store: IDBPTransaction<StockCounterDBSchema, [S], "readwrite">['store']) => Promise<T>
): Promise<T> {
    let tx: IDBPTransaction<StockCounterDBSchema, [S], "readwrite"> | undefined;
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

export async function addOrUpdateProductToDB(product: ProductDetail): Promise<void> {
    const productToSave: ProductDetail = {
        ...product,
        stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
        description: product.description?.trim() || `Producto ${product.barcode}`,
        provider: product.provider?.trim() || "Desconocido",
        expirationDate: product.expirationDate || undefined, // Ensure it's undefined if empty
    };
    await performWriteTransaction(PRODUCT_STORE, store => store.put(productToSave));
}

export async function getProductFromDB(barcode: string): Promise<ProductDetail | undefined> {
  try {
    const db = await getDB();
    return await db.get(PRODUCT_STORE, barcode);
  } catch (error) {
    console.error(`Error getting product ${barcode} from IndexedDB:`, error);
    throw error; // Re-throw to allow caller to handle
  }
}

export async function getAllProductsFromDB(): Promise<ProductDetail[]> {
  try {
    const db = await getDB();
    return await db.getAll(PRODUCT_STORE);
  } catch (error) {
    console.error('Error getting all products from IndexedDB:', error);
    throw error; // Re-throw
  }
}

export async function deleteProductFromDB(barcode: string): Promise<void> {
    if (!barcode) return; // Or throw an error if barcode is essential
    await performWriteTransaction(PRODUCT_STORE, store => store.delete(barcode));
}

export async function addProductsToDB(products: ProductDetail[]): Promise<void> {
  if (!products || products.length === 0) return;

  await performWriteTransaction(PRODUCT_STORE, async (store) => {
    // Using Promise.all to execute puts in parallel within the transaction
    // Note: For extremely large arrays, this might still hit browser limits.
    // Consider batching within the transaction for very large datasets if issues arise.
    await Promise.all(products.map(product => {
        if (product && typeof product.barcode === 'string') {
             const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
             // Ensure expirationDate is either a valid date string or undefined
             const expirationDate = product.expirationDate && /^\d{4}-\d{2}-\d{2}$/.test(product.expirationDate) ? product.expirationDate : undefined;

             const productToPut: ProductDetail = { ...product, stock, expirationDate };
             return store.put(productToPut);
        }
        return Promise.resolve(); // Resolve for invalid/empty product entries
    }));
  });
}


export async function clearProductDatabase(): Promise<void> {
   await performWriteTransaction(PRODUCT_STORE, store => store.clear());
}

// --- Operations for Counting History (Optimized) ---
export async function saveCountingHistory(historyEntry: CountingHistoryEntry): Promise<void> {
   // Basic validation for required fields
   if (!historyEntry.id || !historyEntry.timestamp || !historyEntry.warehouseId || !historyEntry.warehouseName || !Array.isArray(historyEntry.products)) {
       console.error("Invalid history entry data:", historyEntry);
       throw new Error("Invalid history entry data. Required fields are missing.");
   }
   // userId is optional, so no validation for it here, but it will be stored if present
   await performWriteTransaction(HISTORY_STORE, store => store.add(historyEntry));
   console.log(`Counting history entry saved with ID: ${historyEntry.id} for user: ${historyEntry.userId || 'N/A'}`);
}

export async function getCountingHistory(userId?: string): Promise<CountingHistoryEntry[]> { // Optional userId for filtering
  try {
    const db = await getDB();
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    let history: CountingHistoryEntry[];

    if (userId && tx.store.indexNames.contains('by-userId')) {
        const index = tx.store.index('by-userId');
        history = await index.getAll(userId);
    } else {
        // Fallback to timestamp sort if no userId or index not available (shouldn't happen with schema v2+)
        const index = tx.store.index('by-timestamp');
        history = await index.getAll();
    }
    
    // Ensure sorting is done correctly after fetching
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return history;
  } catch (error) {
    console.error('Error getting counting history from IndexedDB:', error);
    throw error; // Re-throw
  }
}

export async function clearCountingHistory(): Promise<void> {
    await performWriteTransaction(HISTORY_STORE, store => store.clear());
}

// --- Combined Database Operations ---
export async function clearAllDatabases(): Promise<void> {
    // This can be done in a single transaction if all stores are known,
    // or sequentially as implemented here. Sequential is simpler to manage.
    try {
        await clearProductDatabase();
        await clearCountingHistory();
        // Add other store clear operations here if new stores are added
    } catch (error) {
        console.error("Error clearing all databases:", error);
        throw error; // Re-throw
    }
}

export type { StockCounterDBSchema };
