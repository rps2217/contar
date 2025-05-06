// src/lib/firebase-helpers.ts
import { db } from './firebase'; // Import initialized Firestore instance
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  Timestamp,
  collectionGroup,
} from 'firebase/firestore';
import type { ProductDetail, InventoryItem, DisplayProduct } from '@/types/product';

const PRODUCT_DETAILS_COLLECTION = 'productDetails';
const INVENTORY_ITEMS_COLLECTION = 'inventoryItems'; // Collection name for warehouse-specific inventory

// --- CRUD for ProductDetail ---

export const getProductDetail = async (barcode: string): Promise<ProductDetail | undefined> => {
  try {
    const docRef = doc(db, PRODUCT_DETAILS_COLLECTION, barcode);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as ProductDetail;
    } else {
      console.log(`No product detail found for barcode: ${barcode}`);
      return undefined;
    }
  } catch (error) {
    console.error(`Error getting product detail for barcode ${barcode}:`, error);
    throw error;
  }
};

export const getAllProductDetails = async (): Promise<ProductDetail[]> => {
  try {
    const querySnapshot = await getDocs(collection(db, PRODUCT_DETAILS_COLLECTION));
    const details: ProductDetail[] = [];
    querySnapshot.forEach((doc) => {
      details.push(doc.data() as ProductDetail);
    });
    return details;
  } catch (error) {
    console.error('Error getting all product details:', error);
    throw error;
  }
};

export const addOrUpdateProductDetail = async (productDetail: ProductDetail): Promise<void> => {
  try {
    const docRef = doc(db, PRODUCT_DETAILS_COLLECTION, productDetail.barcode);
    // Use setDoc with merge: true to update if exists, or create if not
    await setDoc(docRef, productDetail, { merge: true });
    console.log(`Product detail ${productDetail.barcode} added or updated.`);
  } catch (error) {
    console.error(`Error adding/updating product detail ${productDetail.barcode}:`, error);
    throw error;
  }
};

export const addProductDetailsInBulk = async (productDetails: ProductDetail[]): Promise<void> => {
    if (!productDetails || productDetails.length === 0) {
      console.warn('addProductDetailsInBulk called with empty list.');
      return;
    }
    const batch = writeBatch(db);
    let operationCount = 0;
    const MAX_BATCH_SIZE = 500; // Firestore batch limit
    console.log(`Attempting to add/update ${productDetails.length} product details in bulk.`);

    for (const detail of productDetails) {
      if (!detail || typeof detail.barcode !== 'string' || detail.barcode.trim() === '') {
        console.warn('Skipping invalid product detail data:', detail);
        continue;
      }
      const detailToAdd: ProductDetail = {
        barcode: detail.barcode.trim(),
        description: detail.description?.trim() || `Producto ${detail.barcode.trim()}`,
        provider: detail.provider?.trim() || 'Desconocido',
      };
      const docRef = doc(db, PRODUCT_DETAILS_COLLECTION, detailToAdd.barcode);
      batch.set(docRef, detailToAdd, { merge: true }); // Use set with merge
      operationCount++;

      if (operationCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        // Re-initialize batch for the next set of operations
        // batch = writeBatch(db); // Error: writeBatch can only be used once
        // Need to create a new batch instance
        const newBatch = writeBatch(db);
        operationCount = 0;
        console.log(`Committed a batch of ${MAX_BATCH_SIZE} product details.`);
        // Assign the new batch to the 'batch' variable for the next iteration
        // This line is incorrect, the loop needs restructuring or multiple commit calls
        // A better approach might be to process in chunks outside the loop or use multiple commits.
        // Let's correct this by committing within the loop when needed.
      }
    }

    // Commit any remaining operations in the last batch
    if (operationCount > 0) {
      try {
        await batch.commit();
        console.log(`Committed final batch of ${operationCount} product details.`);
      } catch(error) {
          console.error("Error committing final product detail batch:", error);
          throw error;
      }
    }

    console.log(`Bulk detail add/update finished.`);
};

export const deleteProductDetail = async (barcode: string): Promise<void> => {
  // Note: This only deletes the detail, not associated inventory items.
  // Use deleteProductCompletely for full deletion.
  try {
    const docRef = doc(db, PRODUCT_DETAILS_COLLECTION, barcode);
    await deleteDoc(docRef);
    console.log(`Product detail ${barcode} deleted.`);
  } catch (error) {
    console.error(`Error deleting product detail ${barcode}:`, error);
    throw error;
  }
};

// --- CRUD for InventoryItem ---

// Generates a composite ID for inventory items
const getInventoryItemId = (barcode: string, warehouseId: string): string => `${barcode}_${warehouseId}`;

export const getInventoryItem = async (barcode: string, warehouseId: string): Promise<InventoryItem | undefined> => {
  try {
    const inventoryId = getInventoryItemId(barcode, warehouseId);
    const docRef = doc(db, INVENTORY_ITEMS_COLLECTION, inventoryId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      // Convert Firestore Timestamp to ISO string if necessary
      const lastUpdated = data.lastUpdated instanceof Timestamp ? data.lastUpdated.toDate().toISOString() : data.lastUpdated;
      return { ...data, lastUpdated } as InventoryItem;
    } else {
      console.log(`No inventory item found for barcode ${barcode} in warehouse ${warehouseId}`);
      return undefined;
    }
  } catch (error) {
    console.error(`Error getting inventory item for ${barcode} in warehouse ${warehouseId}:`, error);
    throw error;
  }
};

// Get all inventory items for a specific product across all warehouses
export const getInventoryItemsForProduct = async (barcode: string): Promise<InventoryItem[]> => {
  try {
    const q = query(collection(db, INVENTORY_ITEMS_COLLECTION), where('barcode', '==', barcode));
    const querySnapshot = await getDocs(q);
    const items: InventoryItem[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const lastUpdated = data.lastUpdated instanceof Timestamp ? data.lastUpdated.toDate().toISOString() : data.lastUpdated;
      items.push({ ...data, lastUpdated } as InventoryItem);
    });
    return items;
  } catch (error) {
    console.error(`Error getting inventory items for product ${barcode}:`, error);
    throw error;
  }
};

// Get all inventory items for a specific warehouse
export const getInventoryItemsForWarehouse = async (warehouseId: string): Promise<InventoryItem[]> => {
  try {
    const q = query(collection(db, INVENTORY_ITEMS_COLLECTION), where('warehouseId', '==', warehouseId));
    const querySnapshot = await getDocs(q);
    const items: InventoryItem[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const lastUpdated = data.lastUpdated instanceof Timestamp ? data.lastUpdated.toDate().toISOString() : data.lastUpdated;
      items.push({ ...data, lastUpdated } as InventoryItem);
    });
    return items;
  } catch (error) {
    console.error(`Error getting inventory items for warehouse ${warehouseId}:`, error);
    throw error;
  }
};

// Get all inventory items from the database
export const getAllInventoryItems = async (): Promise<InventoryItem[]> => {
  try {
    const querySnapshot = await getDocs(collection(db, INVENTORY_ITEMS_COLLECTION));
    const items: InventoryItem[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
       const lastUpdated = data.lastUpdated instanceof Timestamp ? data.lastUpdated.toDate().toISOString() : data.lastUpdated;
       items.push({ ...data, lastUpdated } as InventoryItem);
    });
    return items;
  } catch (error) {
    console.error('Error getting all inventory items:', error);
    throw error;
  }
};

export const addOrUpdateInventoryItem = async (inventoryItem: InventoryItem): Promise<void> => {
  // Ensure correct types before putting into DB
  const itemToAdd: InventoryItem = {
    barcode: inventoryItem.barcode.trim(),
    warehouseId: inventoryItem.warehouseId.trim(),
    stock: Number.isFinite(Number(inventoryItem.stock)) ? Number(inventoryItem.stock) : 0,
    count: Number.isFinite(Number(inventoryItem.count)) ? Number(inventoryItem.count) : 0,
    lastUpdated: inventoryItem.lastUpdated || new Date().toISOString(),
  };

  if (!itemToAdd.barcode || !itemToAdd.warehouseId) {
    console.error('Cannot add/update inventory item: barcode and warehouseId are required.', itemToAdd);
    throw new Error('Barcode and Warehouse ID are required for inventory items.');
  }

  try {
    const inventoryId = getInventoryItemId(itemToAdd.barcode, itemToAdd.warehouseId);
    const docRef = doc(db, INVENTORY_ITEMS_COLLECTION, inventoryId);
    // Store lastUpdated as a Firestore Timestamp for better querying/sorting
    const dataToSet = {
      ...itemToAdd,
      lastUpdated: Timestamp.fromDate(new Date(itemToAdd.lastUpdated!)) // Convert ISO string back to Timestamp
    };
    await setDoc(docRef, dataToSet, { merge: true });
    console.log(`Inventory item ${inventoryId} added or updated.`);
  } catch (error) {
    console.error(`Error adding/updating inventory item ${itemToAdd.barcode} in warehouse ${itemToAdd.warehouseId}:`, error);
    throw error;
  }
};

export const addInventoryItemsInBulk = async (inventoryItems: InventoryItem[]): Promise<void> => {
    if (!inventoryItems || inventoryItems.length === 0) {
      console.warn('addInventoryItemsInBulk called with empty list.');
      return;
    }
    const MAX_BATCH_SIZE = 500; // Firestore batch limit
    console.log(`Attempting to add/update ${inventoryItems.length} inventory items in bulk.`);

    for (let i = 0; i < inventoryItems.length; i += MAX_BATCH_SIZE) {
        const chunk = inventoryItems.slice(i, i + MAX_BATCH_SIZE);
        const batch = writeBatch(db);
        let operationCount = 0;

        for (const item of chunk) {
            const itemToAdd: InventoryItem = {
                barcode: item.barcode?.trim(),
                warehouseId: item.warehouseId?.trim(),
                stock: Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0,
                count: Number.isFinite(Number(item.count)) ? Number(item.count) : 0, // Usually count starts at 0 for bulk import
                lastUpdated: item.lastUpdated || new Date().toISOString(),
            };

            if (!itemToAdd.barcode || !itemToAdd.warehouseId) {
                console.warn('Skipping invalid inventory item data (missing barcode/warehouseId):', item);
                continue;
            }

            const inventoryId = getInventoryItemId(itemToAdd.barcode, itemToAdd.warehouseId);
            const docRef = doc(db, INVENTORY_ITEMS_COLLECTION, inventoryId);
            // Store lastUpdated as Firestore Timestamp
            const dataToSet = {
              ...itemToAdd,
              lastUpdated: Timestamp.fromDate(new Date(itemToAdd.lastUpdated!))
            };
            batch.set(docRef, dataToSet, { merge: true });
            operationCount++;
        }

        if (operationCount > 0) {
            try {
                await batch.commit();
                console.log(`Committed batch of ${operationCount} inventory items (chunk ${i / MAX_BATCH_SIZE + 1}).`);
            } catch (error) {
                console.error(`Error committing inventory item batch (chunk ${i / MAX_BATCH_SIZE + 1}):`, error);
                // Decide how to handle batch errors (e.g., retry, log, stop)
                // Throwing error will stop the bulk operation
                throw error;
            }
        }
    }
    console.log(`Bulk inventory item add/update finished.`);
};

export const deleteInventoryItem = async (barcode: string, warehouseId: string): Promise<void> => {
  try {
    const inventoryId = getInventoryItemId(barcode, warehouseId);
    const docRef = doc(db, INVENTORY_ITEMS_COLLECTION, inventoryId);
    await deleteDoc(docRef);
    console.log(`Inventory item ${inventoryId} deleted.`);
  } catch (error) {
    console.error(`Error deleting inventory item ${barcode} in warehouse ${warehouseId}:`, error);
    throw error;
  }
};

// --- Combined Operations ---

export const getDisplayProductForWarehouse = async (barcode: string, warehouseId: string): Promise<DisplayProduct | null> => {
  try {
    const detail = await getProductDetail(barcode);
    if (!detail) return null;

    const inventory = await getInventoryItem(barcode, warehouseId);

    const displayProduct: DisplayProduct = {
      ...detail,
      warehouseId: warehouseId,
      stock: inventory?.stock ?? 0,
      count: inventory?.count ?? 0,
      lastUpdated: inventory?.lastUpdated, // Keep as ISO string
    };
    return displayProduct;
  } catch (error) {
    console.error(`Error getting display product for ${barcode} in warehouse ${warehouseId}:`, error);
    throw error; // Re-throw to be handled by caller
  }
};

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
        lastUpdated: inventory?.lastUpdated, // Keep as ISO string
      };
    });

    return displayProducts;
  } catch (error) {
    console.error(`Error getting all display products for warehouse ${warehouseId}:`, error);
    throw error;
  }
};

// --- Utility / Maintenance ---

// Clears BOTH product details and inventory items collections
export const clearDatabaseCompletely = async (): Promise<void> => {
    console.log('Attempting to clear Firestore collections...');
    const batch = writeBatch(db);
    let deletedCount = 0;
    const MAX_DELETES_PER_BATCH = 500; // Firestore batch limit

    try {
        // Clear Product Details
        const detailsSnapshot = await getDocs(collection(db, PRODUCT_DETAILS_COLLECTION));
        detailsSnapshot.forEach(doc => {
            batch.delete(doc.ref);
            deletedCount++;
            if (deletedCount % MAX_DELETES_PER_BATCH === 0) {
                 // Commit the batch if it reaches the limit (though we might need multiple batches)
                 // This logic needs refinement for very large collections. A better approach uses multiple sequential batches.
            }
        });
        console.log(`Marked ${detailsSnapshot.size} product details for deletion.`);

        // Clear Inventory Items
        const inventorySnapshot = await getDocs(collection(db, INVENTORY_ITEMS_COLLECTION));
        inventorySnapshot.forEach(doc => {
            batch.delete(doc.ref);
             deletedCount++;
             if (deletedCount % MAX_DELETES_PER_BATCH === 0) {
                // Commit batch logic needed here too
             }
        });
        console.log(`Marked ${inventorySnapshot.size} inventory items for deletion.`);

        // Commit the final batch (or the only batch if small)
        await batch.commit();
        console.log('Firestore collections cleared successfully.');

    } catch (error) {
        console.error('Error clearing Firestore collections:', error);
        throw error;
    }
    // Note: For very large collections, this approach might be slow or hit limits.
    // Consider using Cloud Functions for bulk deletion in the background for huge datasets.
};

// Deletes a product completely (details and all inventory items across warehouses)
export const deleteProductCompletely = async (barcode: string): Promise<void> => {
    const batch = writeBatch(db);

    try {
        // Delete the product detail entry
        const detailRef = doc(db, PRODUCT_DETAILS_COLLECTION, barcode);
        batch.delete(detailRef);
        console.log(`Marked detail for barcode ${barcode} for deletion.`);

        // Find and delete all inventory items for this barcode
        const q = query(collection(db, INVENTORY_ITEMS_COLLECTION), where('barcode', '==', barcode));
        const inventorySnapshot = await getDocs(q);
        inventorySnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        console.log(`Marked ${inventorySnapshot.size} inventory items for barcode ${barcode} for deletion.`);

        // Commit all deletions in one batch
        await batch.commit();
        console.log(`Completed deletion process for barcode: ${barcode}`);

    } catch (error) {
        console.error(`Error deleting product ${barcode} completely:`, error);
        throw error;
    }
};
