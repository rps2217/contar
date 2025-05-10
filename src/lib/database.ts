// src/lib/database.ts
import type { ProductDetail, CountingHistoryEntry } from '@/types/product';
import type { DBSchema, IDBPDatabase, StoreNames, IDBPTransaction, OpenDBCallbacks } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 2; 
const PRODUCT_STORE = 'products';
const HISTORY_STORE = 'countingHistory'; 

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
    indexes: { 'by-timestamp': string, 'by-warehouseId': string, 'by-userId'?: string }; // Added userId index
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
            console.log(`Object store "${PRODUCT_STORE}" created.`);
        }

        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
            const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
            historyStore.createIndex('by-timestamp', 'timestamp');
            historyStore.createIndex('by-warehouseId', 'warehouseId');
             historyStore.createIndex('by-userId', 'userId'); // Add userId index
            console.log(`Object store "${HISTORY_STORE}" created.`);
        } else {
            // If the store exists, check if the userId index needs to be added
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
            dbInstance.objectStoreNames;
            return dbInstance;
        } catch (error) {
            console.warn("IndexedDB connection seems closed or broken, reopening.", error);
            dbInstance = null;
            openPromise = null; 
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
             db.addEventListener('close', () => {
                console.warn('IndexedDB connection closed.');
                dbInstance = null;
                openPromise = null;
             });
             db.addEventListener('error', (event) => {
                console.error('IndexedDB error:', (event.target as any)?.error);
             });
            openPromise = null; 
            return db;
        }).catch(error => {
            console.error("Failed to open IndexedDB:", error);
            dbInstance = null;
            openPromise = null; 
            throw error; 
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
    };
    await performWriteTransaction(PRODUCT_STORE, store => store.put(productToSave));
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

export async function deleteProductFromDB(barcode: string): Promise<void> {
    if (!barcode) return;
    await performWriteTransaction(PRODUCT_STORE, store => store.delete(barcode));
}

export async function addProductsToDB(products: ProductDetail[]): Promise<void> {
  if (!products || products.length === 0) return;
  await performWriteTransaction(PRODUCT_STORE, async (store) => {
    await Promise.all(products.map(product => {
        if (product && typeof product.barcode === 'string') {
             const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
             const productToPut: ProductDetail = { ...product, stock };
             return store.put(productToPut);
        }
        return Promise.resolve();
    }));
  });
}

export async function clearProductDatabase(): Promise<void> {
   await performWriteTransaction(PRODUCT_STORE, store => store.clear());
}

// --- Operations for Counting History (Optimized) ---
export async function saveCountingHistory(historyEntry: CountingHistoryEntry): Promise<void> {
   if (!historyEntry.id || !historyEntry.timestamp || !historyEntry.warehouseId || !historyEntry.warehouseName || !Array.isArray(historyEntry.products)) {
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
        const index = tx.store.index('by-timestamp'); // Fallback to timestamp sort if no userId or index
        history = await index.getAll();
    }
    
    history.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return history;
  } catch (error) {
    console.error('Error getting counting history from IndexedDB:', error);
    throw error;
  }
}

export async function clearCountingHistory(): Promise<void> {
    await performWriteTransaction(HISTORY_STORE, store => store.clear());
}

// --- Combined Database Operations ---
export async function clearAllDatabases(): Promise<void> {
    try {
        await clearProductDatabase();
        await clearCountingHistory();
    } catch (error) {
        console.error("Error clearing all databases:", error);
        throw error;
    }
}

export type { StockCounterDBSchema };
