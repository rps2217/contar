// src/lib/database.ts
import type { ProductDetail } from '@/types/product'; 
import type { DBSchema, IDBPDatabase, StoreNames, IDBPTransaction, OpenDBCallbacks } from 'idb';

const DB_NAME = 'StockCounterProDB';
const DB_VERSION = 3; // Mantener o incrementar si el esquema cambia
const PRODUCT_STORE = 'products'; // Para Catálogo de Productos

let dbInstance: IDBPDatabase<StockCounterDBSchema> | null = null;
let openPromise: Promise<IDBPDatabase<StockCounterDBSchema>> | null = null;

interface StockCounterDBSchema extends DBSchema {
  [PRODUCT_STORE]: {
    key: string; // barcode
    value: ProductDetail;
    indexes: { 'by-barcode': string; 'by-provider': string, 'by-expirationDate': string };
  };
  // HISTORY_STORE ya no se usa aquí si se eliminó su funcionalidad
}

const dbCallbacks: OpenDBCallbacks<StockCounterDBSchema> = {
    upgrade(db, oldVersion, newVersion, transaction, event) {
        console.log(`[IndexedDB] Actualizando de versión ${oldVersion} a ${newVersion}...`);

        if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
            const productStore = db.createObjectStore(PRODUCT_STORE, { keyPath: 'barcode' });
            productStore.createIndex('by-barcode', 'barcode', { unique: true });
            productStore.createIndex('by-provider', 'provider');
            productStore.createIndex('by-expirationDate', 'expirationDate');
            console.log(`[IndexedDB] Object store "${PRODUCT_STORE}" creado con índices.`);
        } else {
            const productStore = transaction.objectStore(PRODUCT_STORE);
            if (!productStore.indexNames.contains('by-provider')) {
                productStore.createIndex('by-provider', 'provider');
                console.log(`[IndexedDB] Índice "by-provider" creado en store "${PRODUCT_STORE}".`);
            }
            if (!productStore.indexNames.contains('by-expirationDate')) {
                productStore.createIndex('by-expirationDate', 'expirationDate');
                 console.log(`[IndexedDB] Índice "by-expirationDate" creado en store "${PRODUCT_STORE}".`);
            }
        }
    },
    blocked(currentVersion, blockedVersion, event) {
        console.error(`[IndexedDB] Actualización de versión ${currentVersion} a ${blockedVersion} bloqueada.`);
        alert("La base de datos necesita actualizarse, por favor cierre otras pestañas de esta aplicación y recargue la página.");
    },
    blocking(currentVersion, blockedVersion, event) {
        console.warn(`[IndexedDB] Versión ${blockedVersion} está bloqueando la actualización desde ${currentVersion}. Intentando cerrar.`);
        (event.target as IDBPDatabase)?.close();
        dbInstance = null;
        openPromise = null;
    },
    terminated() {
        console.error("[IndexedDB] Conexión terminada inesperadamente.");
        dbInstance = null;
        openPromise = null;
    }
};

async function getDB(): Promise<IDBPDatabase<StockCounterDBSchema>> {
    if (dbInstance) {
        try {
            // Verifica si la conexión sigue activa. objectStoreNames es una propiedad que debería estar disponible.
            // Si no, una excepción será lanzada.
            dbInstance.objectStoreNames; 
            return dbInstance;
        } catch (error) {
            console.warn("[IndexedDB] La conexión parece cerrada, reabriendo.", error);
            dbInstance = null; // Forza la reapertura
            openPromise = null; // Resetea la promesa de apertura
        }
    }

    if (!openPromise) {
        if (typeof window === 'undefined') {
             // No podemos usar IndexedDB en el servidor
             return Promise.reject(new Error("[IndexedDB] No se puede acceder en este entorno."));
        }
        console.log("[IndexedDB] Abriendo conexión...");
        // Asegurar que import('idb') se resuelva antes de usarlo
        openPromise = import('idb').then(({ openDB: idbOpenDB }) => {
             return idbOpenDB<StockCounterDBSchema>(DB_NAME, DB_VERSION, dbCallbacks);
        }).then(db => {
            console.log("[IndexedDB] Abierta exitosamente.");
            dbInstance = db;
             // Escuchadores de eventos importantes para la gestión de la conexión
             db.addEventListener('close', () => {
                console.warn('[IndexedDB] Conexión cerrada.');
                dbInstance = null;
                openPromise = null;
             });
             db.addEventListener('versionchange', (event) => {
                console.warn('[IndexedDB] Cambio de versión detectado. Cerrando conexión para permitir actualización.');
                db.close(); // Es crucial cerrar la conexión aquí
                dbInstance = null;
                openPromise = null;
                // Opcionalmente: alertar al usuario para que recargue, o intentar recargar automáticamente.
             });
             db.addEventListener('error', (event) => { // Manejo de errores generales en la instancia de DB
                console.error('[IndexedDB] Error:', (event.target as any)?.error);
             });
            return db;
        }).catch(error => {
            console.error("[IndexedDB] Fallo al abrir:", error);
            dbInstance = null; // Asegurar que dbInstance sea nulo en caso de error
            openPromise = null; // Limpiar la promesa para permitir un nuevo intento
            throw error; // Re-lanzar el error para que la llamada original lo maneje
        });
    }
    // Evitar que openPromise se quede "colgado" si falla y se reintenta
    return openPromise.finally(() => {
        // Este finally puede no ser el lugar ideal para resetear openPromise
        // si múltiples llamadas concurrentes ocurren mientras está pendiente.
        // La lógica principal de reseteo está en el catch y en el manejo de dbInstance.
        if (openPromise && openPromise === (openPromise as any)) { // Comparación para evitar problemas con promesas encadenadas
            // openPromise = null; // Comentado, el reseteo se maneja mejor en .then y .catch
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
        console.error(`[IndexedDB] Error en transacción de escritura en store ${storeName}:`, error);
        if (tx && !tx.done && (tx as any).abort) { // Verificar si abort existe antes de llamar
            try { await (tx as any).abort(); } catch (abortError) { console.error('[IndexedDB] Error abortando transacción:', abortError); }
        }
        throw error; // Re-lanzar para que el llamador sepa que falló
    }
}

// --- Product Catalog Operations (IndexedDB) ---
export async function addOrUpdateProductToDB(product: ProductDetail): Promise<void> {
    // Normalización y valores por defecto
    const productToSave: ProductDetail = {
        ...product,
        stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
        description: product.description?.trim() || `Producto ${product.barcode}`,
        provider: product.provider?.trim() || "Desconocido",
        expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "") 
                        ? product.expirationDate.trim() 
                        : null, // Usar null en lugar de undefined
    };
    await performWriteTransaction(PRODUCT_STORE, store => store.put(productToSave));
}

export async function getProductFromDB(barcode: string): Promise<ProductDetail | undefined> {
  try {
    const db = await getDB();
    return await db.get(PRODUCT_STORE, barcode);
  } catch (error) {
    console.error(`[IndexedDB] Error obteniendo producto ${barcode}:`, error);
    throw error;
  }
}

export async function getAllProductsFromDB(): Promise<ProductDetail[]> {
  try {
    const db = await getDB();
    return await db.getAll(PRODUCT_STORE);
  } catch (error) {
    console.error('[IndexedDB] Error obteniendo todos los productos:', error);
    // Devolver un array vacío en caso de error para no romper la UI, pero loguear el error
    return [];
  }
}

export async function deleteProductFromDB(barcode: string): Promise<void> {
    if (!barcode) return; // No hacer nada si el barcode es inválido
    await performWriteTransaction(PRODUCT_STORE, store => store.delete(barcode));
}

export async function addProductsToDB(products: ProductDetail[]): Promise<void> {
  if (!products || products.length === 0) return;
  await performWriteTransaction(PRODUCT_STORE, async (store) => {
    // Usar Promise.all para ejecutar todas las operaciones 'put' en paralelo dentro de la transacción
    await Promise.all(products.map(product => {
        if (product && typeof product.barcode === 'string' && product.barcode.trim() !== '') {
             const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
             // Asegurar que expirationDate sea null si es una cadena vacía o inválida
             const expirationDate = (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "") 
                                    ? product.expirationDate.trim() 
                                    : null;
             const description = product.description?.trim() || `Producto ${product.barcode.trim()}`;
             const provider = product.provider?.trim() || "Desconocido";

             // Crear el objeto a guardar con valores normalizados/por defecto
             const productToPut: ProductDetail = { ...product, barcode: product.barcode.trim(), description, provider, stock, expirationDate };
             return store.put(productToPut);
        }
        return Promise.resolve(); // Devolver una promesa resuelta para ítems inválidos
    }));
  });
}

export async function clearProductDatabase(): Promise<void> {
   await performWriteTransaction(PRODUCT_STORE, store => store.clear());
   console.log("[IndexedDB] Catálogo de productos limpiado.");
}

// No hay funciones de historial aquí si la funcionalidad fue eliminada

export type { StockCounterDBSchema }; // Exportar el tipo de esquema si es necesario en otros lugares
    
