
// src/lib/database.ts
import type { ProductDetail } from '@/types/product'; 
import type { DBSchema, IDBPDatabase, StoreNames, IDBPTransaction, OpenDBCallbacks } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 3; 
const PRODUCT_STORE = 'products'; // For Product Catalog

let dbInstance: IDBPDatabase<StockCounterDBSchema> | null = null;
let openPromise: Promise<IDBPDatabase<StockCounterDBSchema>> | null = null;

interface StockCounterDBSchema extends DBSchema {
  [PRODUCT_STORE]: {
    key: string; // barcode
    value: ProductDetail;
    indexes: { 'by-barcode': string, 'by-provider': string, 'by-expirationDate': string }; // Added by-expirationDate
  };
}

const dbCallbacks: OpenDBCallbacks<StockCounterDBSchema> = {
    upgrade(db, oldVersion, newVersion, transaction, event) {
        console.log(`[IndexedDB] Upgrading from version ${oldVersion} to ${newVersion}...`);

        if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
            const productStore = db.createObjectStore(PRODUCT_STORE, { keyPath: 'barcode' });
            productStore.createIndex('by-barcode', 'barcode', { unique: true });
            productStore.createIndex('by-provider', 'provider');
            productStore.createIndex('by-expirationDate', 'expirationDate'); // Added index
            console.log(`[IndexedDB] Object store "${PRODUCT_STORE}" created with indexes.`);
        } else {
            const productStore = transaction.objectStore(PRODUCT_STORE);
            if (!productStore.indexNames.contains('by-provider')) {
                productStore.createIndex('by-provider', 'provider');
                console.log(`[IndexedDB] Index "by-provider" created on store "${PRODUCT_STORE}".`);
            }
            if (!productStore.indexNames.contains('by-expirationDate')) { // Added check for expirationDate index
                productStore.createIndex('by-expirationDate', 'expirationDate');
                 console.log(`[IndexedDB] Index "by-expirationDate" created on store "${PRODUCT_STORE}".`);
            }
        }
    },
    blocked(currentVersion, blockedVersion, event) {
        console.error(`[IndexedDB] Upgrade from version ${currentVersion} to ${blockedVersion} blocked.`);
        alert("La base de datos necesita actualizarse, por favor cierre otras pestañas de esta aplicación y recargue la página.");
    },
    blocking(currentVersion, blockedVersion, event) {
        console.warn(`[IndexedDB] Version ${blockedVersion} is blocking upgrade from ${currentVersion}. Attempting to close.`);
        (event.target as IDBPDatabase)?.close();
        dbInstance = null;
        openPromise = null;
    },
    terminated() {
        console.error("[IndexedDB] Connection terminated unexpectedly.");
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
            console.warn("[IndexedDB] Connection seems closed, reopening.", error);
            dbInstance = null;
            openPromise = null;
        }
    }

    if (!openPromise) {
        if (typeof window === 'undefined') {
             return Promise.reject(new Error("[IndexedDB] Cannot be accessed in this environment."));
        }
        console.log("[IndexedDB] Opening connection...");
        openPromise = import('idb').then(({ openDB: idbOpenDB }) => {
             return idbOpenDB<StockCounterDBSchema>(DB_NAME, DB_VERSION, dbCallbacks);
        }).then(db => {
            console.log("[IndexedDB] Opened successfully.");
            dbInstance = db;
             db.addEventListener('close', () => {
                console.warn('[IndexedDB] Connection closed.');
                dbInstance = null;
                openPromise = null;
             });
             db.addEventListener('versionchange', (event) => {
                console.warn('[IndexedDB] Version change detected. Closing connection to allow upgrade.');
                db.close();
                dbInstance = null;
                openPromise = null;
             });
             db.addEventListener('error', (event) => { 
                console.error('[IndexedDB] Error:', (event.target as any)?.error);
             });
            return db;
        }).catch(error => {
            console.error("[IndexedDB] Failed to open:", error);
            dbInstance = null;
            openPromise = null;
            throw error;
        });
    }
    return openPromise.finally(() => {
        if (openPromise && openPromise === (openPromise as any)) { 
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
        console.error(`[IndexedDB] Error in write transaction on store ${storeName}:`, error);
        if (tx && !tx.done && (tx as any).abort) {
            try { await (tx as any).abort(); } catch (abortError) { console.error('[IndexedDB] Error aborting transaction:', abortError); }
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
    console.error(`[IndexedDB] Error getting product ${barcode}:`, error);
    throw error;
  }
}

export async function getAllProductsFromDB(): Promise<ProductDetail[]> {
  try {
    const db = await getDB();
    return await db.getAll(PRODUCT_STORE);
  } catch (error) {
    console.error('[IndexedDB] Error getting all products:', error);
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
        if (product && typeof product.barcode === 'string' && product.barcode.trim() !== '') {
             const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
             const expirationDate = (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "") 
                                    ? product.expirationDate.trim() 
                                    : null;
             const description = product.description?.trim() || `Producto ${product.barcode.trim()}`;
             const provider = product.provider?.trim() || "Desconocido";
             const productToPut: ProductDetail = { ...product, barcode: product.barcode.trim(), description, provider, stock, expirationDate };
             return store.put(productToPut);
        }
        return Promise.resolve();
    }));
  });
}

export async function clearProductDatabase(): Promise<void> {
   await performWriteTransaction(PRODUCT_STORE, store => store.clear());
   console.log("[IndexedDB] Product catalog cleared.");
}

export type { StockCounterDBSchema };
    