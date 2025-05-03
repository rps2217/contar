// src/lib/indexeddb-helpers.ts

import type { Product } from '@/types/product';

const DATABASE_NAME = "stockCounterDB";
const OBJECT_STORE_NAME = "products";
const DATABASE_VERSION = 1; // Increment if schema changes

// --- IndexedDB Helper Functions ---

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn("IndexedDB not supported by this browser.");
      return reject(new Error("IndexedDB not supported by this browser."));
    }
    console.log(`Opening IndexedDB: ${DATABASE_NAME} v${DATABASE_VERSION}`);
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onerror = (event) => {
      const error = (event.target as IDBOpenDBRequest).error;
      console.error("IndexedDB error:", error?.name, error?.message);
      reject(new Error(`IndexedDB error: ${error?.name} - ${error?.message}`));
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      console.log("IndexedDB upgrade needed.");
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        console.log(`Creating object store: ${OBJECT_STORE_NAME}`);
        const store = db.createObjectStore(OBJECT_STORE_NAME, { keyPath: "barcode" });
        store.createIndex("description", "description", { unique: false });
        store.createIndex("provider", "provider", { unique: false });
        console.log("IndexedDB object store created with indexes.");
      } else {
        console.log(`Object store ${OBJECT_STORE_NAME} already exists.`);
        // Handle potential index updates in future versions if needed
      }
    };

    request.onsuccess = (event) => {
      console.log("IndexedDB opened successfully.");
      const db = (event.target as IDBOpenDBRequest).result;
      // Add global error handler for the connection
      db.onerror = (event: Event) => {
        console.error("Database error:", (event.target as any).error);
      };
      resolve(db);
    };
  });
};

const performTransaction = async <T>(
    mode: IDBTransactionMode,
    operation: (objectStore: IDBObjectStore) => Promise<T> | T,
    storeName: string = OBJECT_STORE_NAME // Allow specifying store name if needed
): Promise<T> => {
    let db: IDBDatabase | null = null;
    try {
        db = await openDB();
        if (!db.objectStoreNames.contains(storeName)) {
            console.error(`Object store '${storeName}' not found.`);
            db.close(); // Close connection if store doesn't exist
            throw new Error(`Object store '${storeName}' not found.`);
        }

        const transaction = db.transaction(storeName, mode);
        const objectStore = transaction.objectStore(storeName);

        let result: T | undefined;
        let txError: DOMException | null = null;

        // Use a promise to wait for the transaction to complete or error
        const transactionPromise = new Promise<void>((resolveTx, rejectTx) => {
            transaction.oncomplete = () => {
                console.log(`Transaction (${mode}) on ${storeName} completed.`);
                resolveTx();
            };
            transaction.onerror = (event) => {
                txError = (event.target as IDBTransaction).error;
                console.error(`Transaction (${mode}) on ${storeName} error:`, txError?.name, txError?.message);
                rejectTx(new Error(`Transaction error: ${txError?.name} - ${txError?.message}`));
            };
            transaction.onabort = (event) => {
                txError = (event.target as IDBTransaction).error; // Abort might also have an error
                console.warn(`Transaction (${mode}) on ${storeName} aborted:`, txError?.name, txError?.message);
                rejectTx(new Error(`Transaction aborted: ${txError?.name} - ${txError?.message || 'Reason unknown'}`));
            };
        });

        try {
            // Perform the actual operation within the transaction context
            result = await operation(objectStore);
            // After the operation promise resolves, wait for the transaction to complete
            await transactionPromise;
            return result!; // Assume operation returns a value or is void
        } catch (opError: any) {
            console.error("Error during operation within transaction:", opError);
            // If the operation itself throws, try to wait for the transaction outcome
            // but prioritize the operation error.
            try {
                await transactionPromise; // See if transaction completed/errored independently
            } catch (txErr) {
                // Log transaction error but throw the original operation error
                console.error("Transaction failed after operation error:", txErr);
            }
            throw opError; // Rethrow the original error from the operation
        }

    } catch (error: any) {
        console.error("Error setting up or completing transaction:", error);
        // Don't need to close db here, handled in finally
        throw error; // Rethrow the caught error (either from openDB or transactionPromise)
    } finally {
        if (db) {
            db.close(); // Ensure DB connection is closed
            console.log("Database connection closed.");
        }
    }
};


export const getAllProductsFromDB = (): Promise<Product[]> => {
    return performTransaction("readonly", (objectStore): Promise<Product[]> => {
        return new Promise((resolve, reject) => {
            const request = objectStore.getAll();
            request.onsuccess = () => resolve(request.result as Product[]);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};


export const addProductsToDB = (products: Product[]): Promise<void> => {
    if (!products || products.length === 0) {
        console.warn("addProductsToDB called with empty or invalid product list.");
        return Promise.resolve();
    }

    return performTransaction("readwrite", async (objectStore) => {
        let successCount = 0;
        let errorCount = 0;
        const totalProducts = products.length;

        console.log(`Attempting to add/update ${totalProducts} products in bulk.`);

        // Use Promise.allSettled to process all puts concurrently within the transaction
        const putPromises = products.map(product => {
            return new Promise<void>((resolvePut, rejectPut) => {
                if (!product || typeof product.barcode !== 'string' || product.barcode.trim() === '') {
                    console.warn('Skipping invalid product data:', product);
                    errorCount++;
                    resolvePut(); // Resolve even for invalid data to not break Promise.all
                    return;
                }
                // Ensure correct types before putting into DB
                const productToAdd: Product = {
                    barcode: product.barcode.trim(),
                    description: product.description?.trim() || `Producto ${product.barcode.trim()}`, // Default description
                    provider: product.provider?.trim() || "Desconocido", // Default provider
                    stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0, // Ensure stock is a finite number
                    count: Number.isFinite(Number(product.count)) ? Number(product.count) : 0, // Ensure count is a finite number
                    lastUpdated: product.lastUpdated || new Date().toISOString(), // Ensure lastUpdated exists
                };

                const request = objectStore.put(productToAdd);
                request.onsuccess = () => {
                    successCount++;
                    resolvePut();
                };
                request.onerror = (event) => {
                    errorCount++;
                    console.error("Error putting product to IndexedDB", (event.target as IDBRequest).error, productToAdd);
                    // Reject the specific put operation, but Promise.allSettled will handle it
                    rejectPut((event.target as IDBRequest).error);
                };
            });
        });

        // Wait for all put operations to settle
        const results = await Promise.allSettled(putPromises);

        // Log errors from failed puts
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`Failed to put product (index ${index}):`, result.reason);
                // errorCount is already incremented in the onerror handler
            }
        });

        console.log(`Bulk add/update finished. Success: ${successCount}, Errors/Skipped: ${errorCount}`);

        if (errorCount > 0) {
            // Optionally throw a summary error if needed
            // throw new Error(`Finished bulk add/update with ${errorCount} errors/skipped items.`);
        }
    });
};


export const updateProductInDB = (product: Product): Promise<void> => {
  // Uses addProductsToDB which uses 'put' - handles updates implicitly
  console.log("Updating product in DB:", product.barcode);
  if (!product || !product.barcode) {
       console.error("Update failed: Invalid product data provided.");
       return Promise.reject(new Error("Invalid product data for update."));
  }
  return addProductsToDB([product]); // Wrap in array
};

export const deleteProductFromDB = (barcode: string): Promise<void> => {
     if (!barcode) {
        console.error("Delete failed: No barcode provided.");
        return Promise.reject(new Error("Barcode is required for deletion."));
    }
    return performTransaction("readwrite", (objectStore): Promise<void> => {
        return new Promise((resolve, reject) => {
            console.log(`Attempting to delete product with barcode: ${barcode}`);
            const request = objectStore.delete(barcode);
            request.onsuccess = () => {
                console.log(`Product with barcode ${barcode} deleted successfully.`);
                resolve();
            };
            request.onerror = (event) => {
                console.error("Error deleting product from IndexedDB", (event.target as IDBRequest).error);
                reject((event.target as IDBRequest).error);
            };
        });
    });
};

export const clearDatabaseDB = (): Promise<void> => {
    return performTransaction("readwrite", (objectStore): Promise<void> => {
        return new Promise((resolve, reject) => {
            console.log(`Attempting to clear object store: ${OBJECT_STORE_NAME}`);
            const request = objectStore.clear();
            request.onsuccess = () => {
                console.log("IndexedDB object store cleared successfully.");
                resolve();
            };
            request.onerror = (event) => {
                console.error("Error clearing IndexedDB", (event.target as IDBRequest).error);
                reject((event.target as IDBRequest).error);
            };
        });
    });
};
