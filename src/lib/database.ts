// src/lib/database.ts
import type { ProductDetail, CountingHistoryEntry } from '@/types/product';
import type { DBSchema, IDBPDatabase, StoreNames, IDBPTransaction, OpenDBCallbacks } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 3; // Incremented version if schema changes
const PRODUCT_STORE = 'products';
const HISTORY_STORE = 'countingHistory'; // Keep for history if still used, or remove if not

// --- Database Initialization ---
let dbInstance: IDBPDatabase<StockCounterDBSchema> | null = null;
let openPromise: Promise<IDBPDatabase<StockCounterDBSchema>> | null = null;

interface StockCounterDBSchema extends DBSchema {
  [PRODUCT_STORE]: {
    key: string; // barcode
    value: ProductDetail;
    indexes: { 'by-barcode': string, 'by-provider': string, 'by-expirationDate'?: string };
  };
  [HISTORY_STORE]: {
    key: string; // id of the history entry
    value: CountingHistoryEntry;
    indexes: { 'by-timestamp': string }; // Example index
  };
}

const dbCallbacks: OpenDBCallbacks<StockCounterDBSchema> = {
    upgrade(db, oldVersion, newVersion, transaction, event) {
        console.log(`Upgrading IndexedDB from version ${oldVersion} to ${newVersion}...`);

        if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
            const productStore = db.createObjectStore(PRODUCT_STORE, { keyPath: 'barcode' });
            productStore.createIndex('by-barcode', 'barcode', { unique: true });
            productStore.createIndex('by-provider', 'provider');
            if (!productStore.indexNames.contains('by-expirationDate')) {
                productStore.createIndex('by-expirationDate', 'expirationDate');
            }
            console.log(`Object store "${PRODUCT_STORE}" created.`);
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
            console.log(`Object store "${HISTORY_STORE}" created.`);
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
             db.addEventListener('versionchange', (event) => {
                console.warn('IndexedDB version change detected. Closing connection to allow upgrade.');
                db.close();
                dbInstance = null;
                openPromise = null;
             });
             db.addEventListener('error', (event) => { 
                console.error('IndexedDB error:', (event.target as any)?.error);
             });
            // openPromise = null; // Clear the promise after successful opening - This was causing issues, keep promise until resolved
            return db;
        }).catch(error => {
            console.error("Failed to open IndexedDB:", error);
            dbInstance = null;
            openPromise = null;
            throw error;
        });
    }
    return openPromise.finally(() => {
        // If the global openPromise was this one, clear it after it resolves or rejects
        if (openPromise && openPromise === (openPromise as any)) { // Ensure it's the same promise instance
            openPromise = null;
        }
    });
}

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
        if (tx && !tx.done && (tx as any).abort) { // Check if abort exists
            try { await (tx as any).abort(); } catch (abortError) { console.error('Error aborting transaction:', abortError); }
        }
        throw error;
    }
}

// --- Product Catalog Operations (IndexedDB) ---
export async function addOrUpdateProductToDB(product: ProductDetail): Promise<void> {
    const productToSave: ProductDetail = {
        ...product,
        stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
        description: product.description?.trim() || `Producto ${product.barcode}`,
        provider: product.provider?.trim() || "Desconocido",
        expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "") 
                        ? product.expirationDate.trim() 
                        : null,
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
             const expirationDate = (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "") 
                                    ? product.expirationDate.trim() 
                                    : null;
             const productToPut: ProductDetail = { ...product, stock, expirationDate };
             return store.put(productToPut);
        }
        return Promise.resolve();
    }));
  });
}

export async function clearProductDatabase(): Promise<void> {
   await performWriteTransaction(PRODUCT_STORE, store => store.clear());
}


// --- Counting History Operations (IndexedDB) ---
export async function saveCountingHistory(historyEntry: CountingHistoryEntry): Promise<void> {
    const entryToSave: CountingHistoryEntry = {
        ...historyEntry,
        products: historyEntry.products.map(p => ({
            ...p,
            stock: p.stock ?? 0,
            count: p.count ?? 0,
            expirationDate: (p.expirationDate && typeof p.expirationDate === 'string' && p.expirationDate.trim() !== "") ? p.expirationDate.trim() : null,
        }))
    };
    await performWriteTransaction(HISTORY_STORE, store => store.put(entryToSave));
}

export async function getCountingHistory(): Promise<CountingHistoryEntry[]> {
    try {
        const db = await getDB();
        return await db.getAllFromIndex(HISTORY_STORE, 'by-timestamp');
    } catch (error) {
        console.error("Error getting counting history from IndexedDB:", error);
        throw error;
    }
}

export async function clearCountingHistory(): Promise<void> {
    await performWriteTransaction(HISTORY_STORE, store => store.clear());
}


export type { StockCounterDBSchema };

// Optional: Preload the database on app start
// export function preloadDatabase() {
//   if (typeof window !== 'undefined') {
//     getDB().catch(err => console.error("Failed to preload IndexedDB on app start:", err));
//   }
// }
// Call preloadDatabase() in a top-level client component or _app.tsx if using Pages Router
