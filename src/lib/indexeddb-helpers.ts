// src/lib/indexeddb-helpers.ts

import type { ProductDetail, InventoryItem, DisplayProduct } from '@/types/product';

const DATABASE_NAME = "stockCounterDB";
const PRODUCT_DETAILS_STORE = "productDetails";
const INVENTORY_ITEMS_STORE = "inventoryItems";
const DATABASE_VERSION = 2; // Incremented version for schema change

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
      const transaction = (event.target as IDBOpenDBRequest).transaction; // Get transaction for upgrade

      // Create productDetails store if it doesn't exist
      if (!db.objectStoreNames.contains(PRODUCT_DETAILS_STORE)) {
        console.log(`Creating object store: ${PRODUCT_DETAILS_STORE}`);
        const detailsStore = db.createObjectStore(PRODUCT_DETAILS_STORE, { keyPath: "barcode" });
        // Add indexes if needed later (e.g., for searching by description)
        // detailsStore.createIndex("description", "description", { unique: false });
        console.log(`${PRODUCT_DETAILS_STORE} object store created.`);
      }

       // Create inventoryItems store if it doesn't exist
      if (!db.objectStoreNames.contains(INVENTORY_ITEMS_STORE)) {
         console.log(`Creating object store: ${INVENTORY_ITEMS_STORE}`);
         // Compound key: unique combination of barcode and warehouseId
         const inventoryStore = db.createObjectStore(INVENTORY_ITEMS_STORE, { keyPath: ["barcode", "warehouseId"] });
         // Index by barcode to easily find all items for a product across warehouses
         inventoryStore.createIndex("barcode", "barcode", { unique: false });
         // Index by warehouseId to easily find all items in a warehouse
         inventoryStore.createIndex("warehouseId", "warehouseId", { unique: false });
         console.log(`${INVENTORY_ITEMS_STORE} object store created with indexes.`);
      } else {
          // If the store exists from v1, we might need to migrate data or update indexes
          // For this transition, let's assume v1 had a 'products' store we want to replace/ignore
          // Or if v1 store was 'products' and we want to *rename* it, it's more complex.
          // Simpler approach for upgrade: ensure the *new* stores exist.
          // If 'inventoryItems' store exists, check if indexes need updating (if they changed)
          if (transaction) {
              const inventoryStore = transaction.objectStore(INVENTORY_ITEMS_STORE);
              if (!inventoryStore.indexNames.contains("barcode")) {
                   inventoryStore.createIndex("barcode", "barcode", { unique: false });
                   console.log("Created missing 'barcode' index on inventoryItems.");
              }
               if (!inventoryStore.indexNames.contains("warehouseId")) {
                   inventoryStore.createIndex("warehouseId", "warehouseId", { unique: false });
                   console.log("Created missing 'warehouseId' index on inventoryItems.");
              }
          }
          console.log(`Object store ${INVENTORY_ITEMS_STORE} already exists or indexes updated.`);
      }

      // Example of removing an old store (if 'products' existed in v1)
       if (db.objectStoreNames.contains("products")) {
           console.log("Removing old 'products' object store.");
           db.deleteObjectStore("products");
       }

       console.log("IndexedDB upgrade complete.");
    };

    request.onsuccess = (event) => {
      console.log("IndexedDB opened successfully.");
      const db = (event.target as IDBOpenDBRequest).result;
      db.onerror = (event: Event) => {
        console.error("Database error:", (event.target as any).error);
      };
      resolve(db);
    };
  });
};

// Generic transaction helper remains largely the same but operates on specified stores
const performTransaction = async <T>(
    storeNames: string | string[], // Accept single or multiple store names
    mode: IDBTransactionMode,
    operation: (stores: { [storeName: string]: IDBObjectStore }, transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> => {
    let db: IDBDatabase | null = null;
    const storesToAccess = Array.isArray(storeNames) ? storeNames : [storeNames];

    try {
        db = await openDB();

        // Verify all requested stores exist
        for (const storeName of storesToAccess) {
            if (!db.objectStoreNames.contains(storeName)) {
                console.error(`Object store '${storeName}' not found.`);
                db.close();
                throw new Error(`Object store '${storeName}' not found.`);
            }
        }

        const transaction = db.transaction(storesToAccess, mode);
        const storeMap: { [storeName: string]: IDBObjectStore } = {};
        storesToAccess.forEach(name => {
            storeMap[name] = transaction.objectStore(name);
        });


        let result: T | undefined;
        let txError: DOMException | null = null;

        const transactionPromise = new Promise<void>((resolveTx, rejectTx) => {
             transaction.oncomplete = () => {
                console.log(`Transaction (${mode}) on ${storesToAccess.join(', ')} completed.`);
                resolveTx();
            };
            transaction.onerror = (event) => {
                txError = (event.target as IDBTransaction).error;
                console.error(`Transaction (${mode}) on ${storesToAccess.join(', ')} error:`, txError?.name, txError?.message);
                rejectTx(new Error(`Transaction error: ${txError?.name} - ${txError?.message}`));
            };
            transaction.onabort = (event) => {
                txError = (event.target as IDBTransaction).error;
                console.warn(`Transaction (${mode}) on ${storesToAccess.join(', ')} aborted:`, txError?.name, txError?.message);
                rejectTx(new Error(`Transaction aborted: ${txError?.name} - ${txError?.message || 'Reason unknown'}`));
            };
        });

        try {
            result = await operation(storeMap, transaction);
            await transactionPromise;
            return result!;
        } catch (opError: any) {
            console.error("Error during operation within transaction:", opError);
             try {
                 // Ensure transaction is aborted if an operation fails
                 if (transaction.abort) {
                     transaction.abort();
                     console.log("Transaction explicitly aborted due to operation error.");
                 }
                 await transactionPromise.catch(() => {}); // Wait for abort/error but ignore the promise rejection here
             } catch (txErr) {
                 console.error("Error during transaction abort/completion after operation error:", txErr);
             }
            throw opError;
        }

    } catch (error: any) {
        console.error("Error setting up or completing transaction:", error);
        throw error;
    } finally {
        if (db) {
            db.close();
            console.log("Database connection closed.");
        }
    }
};


// --- CRUD for ProductDetail ---

export const getProductDetail = (barcode: string): Promise<ProductDetail | undefined> => {
    return performTransaction(PRODUCT_DETAILS_STORE, "readonly", (stores) => {
        const store = stores[PRODUCT_DETAILS_STORE];
        return new Promise((resolve, reject) => {
            const request = store.get(barcode);
            request.onsuccess = () => resolve(request.result as ProductDetail | undefined);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

export const getAllProductDetails = (): Promise<ProductDetail[]> => {
    return performTransaction(PRODUCT_DETAILS_STORE, "readonly", (stores) => {
        const store = stores[PRODUCT_DETAILS_STORE];
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result as ProductDetail[]);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

export const addOrUpdateProductDetail = (productDetail: ProductDetail): Promise<void> => {
    return performTransaction(PRODUCT_DETAILS_STORE, "readwrite", (stores) => {
        const store = stores[PRODUCT_DETAILS_STORE];
        return new Promise<void>((resolve, reject) => {
            const request = store.put(productDetail);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};


export const addProductDetailsInBulk = (productDetails: ProductDetail[]): Promise<void> => {
    if (!productDetails || productDetails.length === 0) {
        console.warn("addProductDetailsInBulk called with empty list.");
        return Promise.resolve();
    }
    return performTransaction(PRODUCT_DETAILS_STORE, "readwrite", async (stores) => {
        const store = stores[PRODUCT_DETAILS_STORE];
        console.log(`Attempting to add/update ${productDetails.length} product details in bulk.`);
        let successCount = 0;
        let errorCount = 0;

        // Process sequentially or in parallel within the transaction
        for (const detail of productDetails) {
            try {
                await new Promise<void>((resolvePut, rejectPut) => {
                    if (!detail || typeof detail.barcode !== 'string' || detail.barcode.trim() === '') {
                        console.warn('Skipping invalid product detail data:', detail);
                        resolvePut(); // Skip invalid data
                        return;
                    }
                     const detailToAdd: ProductDetail = {
                        barcode: detail.barcode.trim(),
                        description: detail.description?.trim() || `Producto ${detail.barcode.trim()}`,
                        provider: detail.provider?.trim() || "Desconocido",
                    };
                    const request = store.put(detailToAdd);
                    request.onsuccess = () => { successCount++; resolvePut(); };
                    request.onerror = (event) => {
                         errorCount++;
                         console.error("Error putting product detail", (event.target as IDBRequest).error, detailToAdd);
                         rejectPut((event.target as IDBRequest).error);
                     };
                });
            } catch (e) {
                // Error already logged in the promise rejection
            }
        }
        console.log(`Bulk detail add/update finished. Success: ${successCount}, Errors/Skipped: ${errorCount}`);
        if (errorCount > 0) {
            // Consider if throwing an error is appropriate or just logging
             // throw new Error(`Finished bulk detail add/update with ${errorCount} errors.`);
        }
    });
};

export const deleteProductDetail = (barcode: string): Promise<void> => {
    return performTransaction(PRODUCT_DETAILS_STORE, "readwrite", (stores) => {
        const store = stores[PRODUCT_DETAILS_STORE];
        return new Promise<void>((resolve, reject) => {
            const request = store.delete(barcode);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

// --- CRUD for InventoryItem ---

export const getInventoryItem = (barcode: string, warehouseId: string): Promise<InventoryItem | undefined> => {
    return performTransaction(INVENTORY_ITEMS_STORE, "readonly", (stores) => {
        const store = stores[INVENTORY_ITEMS_STORE];
        return new Promise((resolve, reject) => {
            const request = store.get([barcode, warehouseId]); // Use compound key
            request.onsuccess = () => resolve(request.result as InventoryItem | undefined);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

export const getInventoryItemsForProduct = (barcode: string): Promise<InventoryItem[]> => {
    return performTransaction(INVENTORY_ITEMS_STORE, "readonly", (stores) => {
        const store = stores[INVENTORY_ITEMS_STORE];
        const index = store.index("barcode"); // Use the barcode index
        return new Promise((resolve, reject) => {
            const request = index.getAll(barcode);
            request.onsuccess = () => resolve(request.result as InventoryItem[]);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

export const getInventoryItemsForWarehouse = (warehouseId: string): Promise<InventoryItem[]> => {
    return performTransaction(INVENTORY_ITEMS_STORE, "readonly", (stores) => {
        const store = stores[INVENTORY_ITEMS_STORE];
        const index = store.index("warehouseId"); // Use the warehouseId index
        return new Promise((resolve, reject) => {
            const request = index.getAll(warehouseId);
            request.onsuccess = () => resolve(request.result as InventoryItem[]);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

export const getAllInventoryItems = (): Promise<InventoryItem[]> => {
    return performTransaction(INVENTORY_ITEMS_STORE, "readonly", (stores) => {
        const store = stores[INVENTORY_ITEMS_STORE];
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result as InventoryItem[]);
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

export const addOrUpdateInventoryItem = (inventoryItem: InventoryItem): Promise<void> => {
     // Ensure correct types before putting into DB
     const itemToAdd: InventoryItem = {
        barcode: inventoryItem.barcode.trim(),
        warehouseId: inventoryItem.warehouseId.trim(),
        stock: Number.isFinite(Number(inventoryItem.stock)) ? Number(inventoryItem.stock) : 0,
        count: Number.isFinite(Number(inventoryItem.count)) ? Number(inventoryItem.count) : 0,
        lastUpdated: inventoryItem.lastUpdated || new Date().toISOString(),
    };

    if (!itemToAdd.barcode || !itemToAdd.warehouseId) {
        console.error("Cannot add/update inventory item: barcode and warehouseId are required.", itemToAdd);
        return Promise.reject(new Error("Barcode and Warehouse ID are required for inventory items."));
    }

    return performTransaction(INVENTORY_ITEMS_STORE, "readwrite", (stores) => {
        const store = stores[INVENTORY_ITEMS_STORE];
        return new Promise<void>((resolve, reject) => {
            const request = store.put(itemToAdd); // 'put' handles add or update
            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                console.error("Error putting inventory item", (event.target as IDBRequest).error, itemToAdd);
                reject((event.target as IDBRequest).error);
            };
        });
    });
};

export const addInventoryItemsInBulk = (inventoryItems: InventoryItem[]): Promise<void> => {
    if (!inventoryItems || inventoryItems.length === 0) {
        console.warn("addInventoryItemsInBulk called with empty list.");
        return Promise.resolve();
    }
    return performTransaction(INVENTORY_ITEMS_STORE, "readwrite", async (stores) => {
        const store = stores[INVENTORY_ITEMS_STORE];
        console.log(`Attempting to add/update ${inventoryItems.length} inventory items in bulk.`);
        let successCount = 0;
        let errorCount = 0;

        for (const item of inventoryItems) {
            try {
                 await new Promise<void>((resolvePut, rejectPut) => {
                    const itemToAdd: InventoryItem = {
                        barcode: item.barcode?.trim(),
                        warehouseId: item.warehouseId?.trim(),
                        stock: Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0,
                        count: Number.isFinite(Number(item.count)) ? Number(item.count) : 0, // Usually count starts at 0 for bulk import
                        lastUpdated: item.lastUpdated || new Date().toISOString(),
                    };

                    if (!itemToAdd.barcode || !itemToAdd.warehouseId) {
                        console.warn('Skipping invalid inventory item data (missing barcode/warehouseId):', item);
                        resolvePut(); // Skip invalid data
                        return;
                    }

                    const request = store.put(itemToAdd);
                    request.onsuccess = () => { successCount++; resolvePut(); };
                    request.onerror = (event) => {
                         errorCount++;
                         console.error("Error putting inventory item", (event.target as IDBRequest).error, itemToAdd);
                         rejectPut((event.target as IDBRequest).error);
                     };
                });
            } catch(e) {
                // Error logged in promise rejection
            }
        }
        console.log(`Bulk inventory item add/update finished. Success: ${successCount}, Errors/Skipped: ${errorCount}`);
         if (errorCount > 0) {
             // throw new Error(`Finished bulk inventory item add/update with ${errorCount} errors.`);
         }
    });
};

export const deleteInventoryItem = (barcode: string, warehouseId: string): Promise<void> => {
    return performTransaction(INVENTORY_ITEMS_STORE, "readwrite", (stores) => {
        const store = stores[INVENTORY_ITEMS_STORE];
        return new Promise<void>((resolve, reject) => {
            const request = store.delete([barcode, warehouseId]); // Use compound key
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    });
};

// --- Combined Operations ---

// Example: Get product details and inventory for a specific warehouse
export const getDisplayProductForWarehouse = async (barcode: string, warehouseId: string): Promise<DisplayProduct | null> => {
    try {
        const detail = await getProductDetail(barcode);
        if (!detail) return null;

        const inventory = await getInventoryItem(barcode, warehouseId);

        // If inventory for this warehouse doesn't exist, create a default entry?
        // Or return null/partial data depending on requirements.
        // Here, we return the detail combined with inventory data (or defaults if no inventory)
        const displayProduct: DisplayProduct = {
            ...detail,
            warehouseId: warehouseId,
            stock: inventory?.stock ?? 0,
            count: inventory?.count ?? 0,
            lastUpdated: inventory?.lastUpdated,
        };
        return displayProduct;

    } catch (error) {
        console.error(`Error getting display product for ${barcode} in warehouse ${warehouseId}:`, error);
        throw error; // Re-throw to be handled by caller
    }
};

// Get all products with their inventory for a specific warehouse
export const getAllDisplayProductsForWarehouse = async (warehouseId: string): Promise<DisplayProduct[]> => {
    try {
        const allDetails = await getAllProductDetails();
        const warehouseInventory = await getInventoryItemsForWarehouse(warehouseId);

        const inventoryMap = new Map<string, InventoryItem>();
        warehouseInventory.forEach(item => inventoryMap.set(item.barcode, item));

        const displayProducts = allDetails.map(detail => {
            const inventory = inventoryMap.get(detail.barcode);
            return {
                ...detail,
                warehouseId: warehouseId,
                stock: inventory?.stock ?? 0,
                count: inventory?.count ?? 0,
                lastUpdated: inventory?.lastUpdated,
            };
        });

        return displayProducts;
    } catch (error) {
        console.error(`Error getting all display products for warehouse ${warehouseId}:`, error);
        throw error;
    }
};


// --- Utility / Maintenance ---

// Clears BOTH product details and inventory items
export const clearDatabaseCompletely = (): Promise<void> => {
    return performTransaction(
        [PRODUCT_DETAILS_STORE, INVENTORY_ITEMS_STORE],
        "readwrite",
        (stores) => {
            return new Promise<void>((resolve, reject) => {
                console.log(`Attempting to clear stores: ${PRODUCT_DETAILS_STORE}, ${INVENTORY_ITEMS_STORE}`);
                let clearCount = 0;
                const totalStores = 2;
                let errorOccurred = false;

                const checkCompletion = () => {
                    if (!errorOccurred && clearCount === totalStores) {
                        console.log("All specified stores cleared successfully.");
                        resolve();
                    }
                };

                const createErrorHandler = (storeName: string) => (event: Event) => {
                     if (!errorOccurred) { // Reject only once
                         errorOccurred = true;
                         console.error(`Error clearing store ${storeName}`, (event.target as IDBRequest).error);
                         reject((event.target as IDBRequest).error);
                     }
                 };

                 const detailRequest = stores[PRODUCT_DETAILS_STORE].clear();
                 detailRequest.onsuccess = () => { clearCount++; checkCompletion(); };
                 detailRequest.onerror = createErrorHandler(PRODUCT_DETAILS_STORE);

                 const inventoryRequest = stores[INVENTORY_ITEMS_STORE].clear();
                 inventoryRequest.onsuccess = () => { clearCount++; checkCompletion(); };
                 inventoryRequest.onerror = createErrorHandler(INVENTORY_ITEMS_STORE);
            });
        }
    );
};

// Deletes a product completely (details and all inventory items across warehouses)
export const deleteProductCompletely = (barcode: string): Promise<void> => {
    return performTransaction(
        [PRODUCT_DETAILS_STORE, INVENTORY_ITEMS_STORE],
        "readwrite",
        async (stores) => {
            const detailsStore = stores[PRODUCT_DETAILS_STORE];
            const inventoryStore = stores[INVENTORY_ITEMS_STORE];
            const inventoryIndex = inventoryStore.index("barcode");

            // Delete the product detail entry
             await new Promise<void>((resolve, reject) => {
                const req = detailsStore.delete(barcode);
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject((e.target as IDBRequest).error);
             });
             console.log(`Deleted detail for barcode: ${barcode}`);


            // Find and delete all inventory items for this barcode
            await new Promise<void>((resolve, reject) => {
                 const cursorReq = inventoryIndex.openCursor(IDBKeyRange.only(barcode));
                 let deleteCount = 0;
                 cursorReq.onsuccess = (event) => {
                     const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                     if (cursor) {
                         const deleteReq = cursor.delete();
                         deleteReq.onsuccess = () => {
                             deleteCount++;
                             cursor.continue(); // Move to the next item for this barcode
                         };
                          deleteReq.onerror = (e) => {
                             console.error("Error deleting inventory item during bulk delete", e);
                             // Decide how to handle partial deletion error - maybe continue?
                             cursor.continue(); // Try continuing
                          };
                     } else {
                         // No more items for this barcode
                         console.log(`Deleted ${deleteCount} inventory items for barcode: ${barcode}`);
                         resolve();
                     }
                 };
                 cursorReq.onerror = (e) => reject((e.target as IDBRequest).error);
            });

             console.log(`Completed deletion process for barcode: ${barcode}`);
        }
    );
};


// Note: The old functions like `getAllProductsFromDB`, `addProductsToDB`, etc.,
// that operated on the old 'products' store are now obsolete with the new schema.
// They should be removed or refactored if backward compatibility is needed.
// For clarity, I'm removing them here.

/* REMOVED OLD FUNCTIONS:
export const getAllProductsFromDB = (): Promise<Product[]> => { ... };
export const addProductsToDB = (products: Product[]): Promise<void> => { ... };
export const updateProductInDB = (product: Product): Promise<void> => { ... };
export const deleteProductFromDB = (barcode: string): Promise<void> => { ... };
export const clearDatabaseDB = (): Promise<void> => { ... }; // Replaced by clearDatabaseCompletely
*/
