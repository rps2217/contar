
// src/lib/firestore-service.ts
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  writeBatch,
  serverTimestamp,
  Timestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { DisplayProduct, ProductDetail, Warehouse, CountingHistoryEntry } from '@/types/product';
import { toast } from "@/hooks/use-toast"; // Assuming toast can be used here for user feedback on errors

// --- Helper to check Firestore instance ---
function ensureDbInitialized() {
  if (!db) {
    const errorMessage = "CRITICAL_FIRESTORE_SERVICE_ERROR: Firestore (db) is not initialized. Operations will likely fail. Check Firebase configuration and environment variables.";
    console.error(errorMessage);
    // Do not throw here, let individual functions handle the db being null if they can operate locally or show specific errors
  }
}

// --- Product Catalog Operations (Firestore) ---
const getProductCatalogCollectionRef = (userId: string) => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getProductCatalogCollectionRef.");
  if (!userId || userId.trim() === "") {
    throw new Error(`User ID is missing or empty for getProductCatalogCollectionRef. Received: '${userId}'`);
  }
  return collection(db, `users/${userId}/productCatalog`);
};

export const getProductFromCatalog = async (userId: string, barcode: string): Promise<ProductDetail | undefined> => {
  ensureDbInitialized();
  if (!db) return undefined; // Cannot operate if db is not initialized
  if (!userId || userId.trim() === "") {
    console.error(`[getProductFromCatalog] User ID is missing or empty. Received: '${userId}'`);
    return undefined;
  }
  if (!barcode || barcode.trim() === "") {
    console.error(`[getProductFromCatalog] Barcode is missing or empty. Received: '${barcode}'`);
    return undefined;
  }
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode);
    const docSnap = await getDoc(productDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        barcode: docSnap.id,
        description: data.description || `Producto ${docSnap.id}`,
        provider: data.provider || "Desconocido",
        stock: data.stock ?? 0,
        expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate.trim() : null,
      } as ProductDetail;
    }
    return undefined;
  } catch (error) {
    console.error(`Error getting product ${barcode} from catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudo obtener el producto." }));
    return undefined;
  }
};

export const getAllProductsFromCatalog = async (userId: string): Promise<ProductDetail[]> => {
  ensureDbInitialized();
  if (!db) return [];
  if (!userId || userId.trim() === "") {
     console.error(`[getAllProductsFromCatalog] User ID is missing or empty. Received: '${userId}'`);
     return [];
  }
  try {
    const querySnapshot = await getDocs(getProductCatalogCollectionRef(userId));
    return querySnapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        barcode: docSnap.id,
        description: data.description || `Producto ${docSnap.id}`,
        provider: data.provider || "Desconocido",
        stock: data.stock ?? 0,
        expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate.trim() : null,
      } as ProductDetail;
    });
  } catch (error) {
    console.error(`Error getting all products from catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudieron cargar los productos." }));
    return [];
  }
};

export const addOrUpdateProductInCatalog = async (userId: string, product: ProductDetail): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for addOrUpdateProductInCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty for addOrUpdateProductInCatalog. Received: '${userId}'`);
  if (!product) throw new Error("Product data is missing for addOrUpdateProductInCatalog.");
  if (!product.barcode || product.barcode.trim() === "") throw new Error(`Product barcode is missing or empty for addOrUpdateProductInCatalog. Description: ${product.description}`);

  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), product.barcode.trim());
    const dataToSave: ProductDetail = {
      barcode: product.barcode.trim(),
      description: product.description?.trim() || `Producto ${product.barcode.trim()}`,
      provider: product.provider?.trim() || "Desconocido",
      stock: (typeof product.stock === 'number' && !isNaN(product.stock)) ? product.stock : 0,
      expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "")
                       ? product.expirationDate.trim()
                       : null,
    };
    await setDoc(productDocRef, dataToSave, { merge: true });
  } catch (error) {
    console.error(`Error adding/updating product ${product.barcode} in catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudo guardar el producto." }));
    throw error;
  }
};

export const deleteProductFromCatalog = async (userId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for deleteProductFromCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty for deleteProductFromCatalog. Received: '${userId}'`);
  if (!barcode || barcode.trim() === "") throw new Error("Barcode is missing or empty for deleteProductFromCatalog.");
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode);
    await deleteDoc(productDocRef);
  } catch (error) {
    console.error(`Error deleting product ${barcode} from catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudo eliminar el producto." }));
    throw error;
  }
};

export const addProductsToCatalog = async (userId: string, products: ProductDetail[]): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for addProductsToCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty for addProductsToCatalog. Received: '${userId}'`);
  if (!products || products.length === 0) return;

  try {
    const batch = writeBatch(db);
    products.forEach((product) => {
      if (product && product.barcode && product.barcode.trim() !== "") {
        const productDocRef = doc(getProductCatalogCollectionRef(userId), product.barcode.trim());
        const dataToSave: ProductDetail = {
          barcode: product.barcode.trim(),
          description: product.description?.trim() || `Producto ${product.barcode.trim()}`,
          provider: product.provider?.trim() || "Desconocido",
          stock: (typeof product.stock === 'number' && !isNaN(product.stock)) ? product.stock : 0,
          expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "")
                           ? product.expirationDate.trim()
                           : null,
        };
        batch.set(productDocRef, dataToSave, { merge: true });
      }
    });
    await batch.commit();
  } catch (error) {
    console.error(`Error batch adding products to catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudieron agregar los productos." }));
    throw error;
  }
};

export const clearProductCatalogInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for clearProductCatalogInFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty for clearProductCatalogInFirestore. Received: '${userId}'`);
  try {
    const q = query(getProductCatalogCollectionRef(userId));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return;
    const batch = writeBatch(db);
    querySnapshot.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  } catch (error) {
    console.error(`Error clearing product catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudo borrar el catálogo." }));
    throw error;
  }
};

// --- Counting List Operations (Firestore) ---
const getCountingListCollectionRef = (userId: string, warehouseId: string) => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getCountingListCollectionRef.");

  if (!userId || userId.trim() === "") {
    throw new Error(`User ID is missing or empty for getCountingListCollectionRef. Received: '${userId}'`);
  }
  if (!warehouseId || warehouseId.trim() === "") {
    throw new Error(`Warehouse ID is missing or empty for getCountingListCollectionRef. Received: '${warehouseId}'`);
  }
  return collection(db, `users/${userId}/countingLists/${warehouseId}/products`);
};

export const setCountingListItem = async (
  userId: string,
  warehouseId: string,
  product: Partial<DisplayProduct> & { barcode: string }, // Ensure barcode is present, other fields can be partial for updates
  merge = false
): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for setCountingListItem.");

  console.log("[setCountingListItem] Producto recibido:", JSON.parse(JSON.stringify(product || {})));
  console.log(`[setCountingListItem] product.barcode recibido: '${product?.barcode}'`);


  if (!userId || userId.trim() === "") {
    throw new Error(`User ID is missing or empty for setCountingListItem. Received: '${userId}'`);
  }
  if (!warehouseId || warehouseId.trim() === "") {
    throw new Error(`Warehouse ID is missing or empty for setCountingListItem. Received: '${warehouseId}'`);
  }
  if (!product) {
    throw new Error("Product data is missing (null or undefined) for setCountingListItem.");
  }
  if (!product.barcode || product.barcode.trim() === "") {
    const productDetails = product 
        ? `Barcode: '${product.barcode}', Description: ${product.description}, Count: ${product.count}` 
        : 'El objeto producto es null/undefined.';
    console.error(`[setCountingListItem] El código de barras del producto está ausente o vacío. Detalles: ${productDetails}`);
    throw new Error(`El código de barras del producto está ausente o vacío para setCountingListItem. Detalles: ${productDetails}`);
  }

  try {
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), product.barcode.trim());
    // Prepare data for Firestore, ensuring all required fields for DisplayProduct (excluding barcode and warehouseId) are present or defaulted
    // And add firestoreLastUpdated.
    const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId'> & { firestoreLastUpdated: Timestamp } = {
      description: product.description || `Producto ${product.barcode.trim()}`,
      provider: product.provider || "Desconocido",
      stock: product.stock ?? 0,
      count: product.count ?? 0,
      lastUpdated: product.lastUpdated || new Date().toISOString(),
      expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "")
                       ? product.expirationDate.trim()
                       : null,
      firestoreLastUpdated: serverTimestamp() as Timestamp, // Required for ordering and as a server-side timestamp
    };
    
    // Remove barcode and warehouseId if they were part of the product object to avoid saving them in the document fields
    const { barcode, warehouseId: whId, ...finalDataToSet } = product; 
    const completeDataToSet = { ...dataToSet, ...finalDataToSet }; // Merge defaults with provided product data


    if (merge) {
      await setDoc(itemDocRef, completeDataToSet, { merge: true });
    } else {
      await setDoc(itemDocRef, completeDataToSet);
    }
  } catch (error) {
    console.error(`Error setting counting list item ${product.barcode} for user ${userId}, warehouse ${warehouseId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Conteo", description: "No se pudo guardar el producto en la lista." }));
    throw error;
  }
};

export const deleteCountingListItem = async (userId: string, warehouseId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for deleteCountingListItem.");

  if (!userId || userId.trim() === "") {
    throw new Error(`User ID is missing or empty for deleteCountingListItem. Received: '${userId}'`);
  }
  if (!warehouseId || warehouseId.trim() === "") {
    throw new Error(`Warehouse ID is missing or empty for deleteCountingListItem. Received: '${warehouseId}'`);
  }
  if (!barcode || barcode.trim() === "") {
    throw new Error(`Barcode is missing or empty for deleteCountingListItem. Received: '${barcode}'`);
  }

  try {
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), barcode);
    await deleteDoc(itemDocRef);
  } catch (error) {
    console.error(`Error deleting counting list item ${barcode} for user ${userId}, warehouse ${warehouseId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Conteo", description: "No se pudo eliminar el producto de la lista." }));
    throw error;
  }
};

export const clearCountingListForWarehouseInFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for clearCountingListForWarehouseInFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty for clearCountingList. Received: '${userId}'`);
  if (!warehouseId || warehouseId.trim() === "") throw new Error(`Warehouse ID is missing or empty for clearCountingList. Received: '${warehouseId}'`);

  try {
    const countingListProductsRef = getCountingListCollectionRef(userId, warehouseId);
    const querySnapshot = await getDocs(countingListProductsRef);

    if (querySnapshot.empty) return;

    const batch = writeBatch(db);
    querySnapshot.forEach((docSnapshot) => {
      batch.delete(docSnapshot.ref);
    });
    await batch.commit();
  } catch (error) {
    console.error(`Error clearing counting list in Firestore for user ${userId}, warehouse ${warehouseId}:`, error);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => toast({
        variant: "destructive",
        title: "Error DB",
        description: "No se pudo borrar la lista de conteo de la nube.",
      }));
    }
    throw error;
  }
};

export const subscribeToCountingList = (
  userId: string,
  warehouseId: string,
  callback: (products: DisplayProduct[]) => void,
  onErrorCallback?: (error: Error) => void // Optional error callback
): Unsubscribe => {
  ensureDbInitialized();
  if (!db) {
    console.error("Firestore (db) is not initialized for subscribeToCountingList. Cannot subscribe.");
    callback([]);
    if (onErrorCallback) onErrorCallback(new Error("Firestore (db) is not initialized."));
    return () => {};
  }
  if (!userId || userId.trim() === "" || !warehouseId || warehouseId.trim() === "") {
    console.warn("User ID or Warehouse ID is missing or empty for subscribing to counting list. Returning empty list.");
    callback([]);
    return () => {};
  }
  const q = query(getCountingListCollectionRef(userId, warehouseId), orderBy('firestoreLastUpdated', 'desc'));
  
  return onSnapshot(
    q,
    (querySnapshot) => {
      const products: DisplayProduct[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const firestoreTimestamp = data.firestoreLastUpdated as Timestamp | undefined;
        products.push({
          barcode: docSnap.id,
          warehouseId: warehouseId,
          description: data.description || `Producto ${docSnap.id}`,
          provider: data.provider || "Desconocido",
          stock: data.stock ?? 0,
          count: data.count ?? 0,
          lastUpdated: firestoreTimestamp ? firestoreTimestamp.toDate().toISOString() : (data.lastUpdated || new Date(0).toISOString()),
          expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate.trim() : null,
          // firestoreLastUpdated is not part of DisplayProduct UI type, but it's used for ordering
        });
      });
      callback(products);
    },
    (error) => {
      console.error(`Error in onSnapshot for counting list (user ${userId}, warehouse ${warehouseId}): `, error);
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => toast({
          variant: "destructive",
          title: "Error de Sincronización",
          description: "No se pueden obtener actualizaciones de la lista de conteo. Verifica tu conexión.",
        }));
      }
      if (onErrorCallback) onErrorCallback(error);
      callback([]);
    }
  );
};


// --- Warehouse Operations (Firestore) ---
const getWarehousesCollectionRef = (userId: string) => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getWarehousesCollectionRef.");
  if (!userId || userId.trim() === "") {
    throw new Error(`User ID is missing or empty for getWarehousesCollectionRef. Received: '${userId}'`);
  }
  return collection(db, `users/${userId}/warehouses`);
};

export const subscribeToWarehouses = (
  userId: string,
  callback: (warehouses: Warehouse[]) => void,
  onErrorCallback?: (error: Error) => void // Optional error callback
): Unsubscribe => {
  ensureDbInitialized();
  if (!db) {
    console.error("Firestore (db) is not initialized for subscribeToWarehouses. Cannot subscribe.");
    callback([]);
    if (onErrorCallback) onErrorCallback(new Error("Firestore (db) is not initialized."));
    return () => {};
  }
  if (!userId || userId.trim() === "") {
    console.warn("User ID is missing or empty for subscribing to warehouses. Returning empty list.");
    callback([]);
    return () => {};
  }
  const q = query(getWarehousesCollectionRef(userId), orderBy('name'));
  
  return onSnapshot(
    q,
    (querySnapshot) => {
      const warehouses: Warehouse[] = [];
      querySnapshot.forEach((docSnap) => warehouses.push(docSnap.data() as Warehouse));
      callback(warehouses);
    },
    (error) => {
      console.error(`Error in onSnapshot for warehouses (user ${userId}):`, error);
      if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudieron cargar los almacenes." }));
      if (onErrorCallback) onErrorCallback(error);
      callback([]);
    }
  );
};

export const addOrUpdateWarehouseInFirestore = async (userId: string, warehouse: Warehouse): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for addOrUpdateWarehouseInFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  if (!warehouse || !warehouse.id || warehouse.id.trim() === "" || !warehouse.name || warehouse.name.trim() === "") {
    throw new Error("Warehouse data (ID or Name) is missing or empty.");
  }
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouse.id.trim());
    await setDoc(warehouseDocRef, {name: warehouse.name.trim(), id: warehouse.id.trim()}, { merge: true });
  } catch (error) {
    console.error(`Error adding/updating warehouse ${warehouse.id} for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el almacén." }));
    throw error;
  }
};

export const deleteWarehouseFromFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for deleteWarehouseFromFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  if (!warehouseId || warehouseId.trim() === "") throw new Error(`Warehouse ID is missing or empty. Received: '${warehouseId}'`);
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouseId);
    await deleteDoc(warehouseDocRef);
  } catch (error) {
    console.error(`Error deleting warehouse ${warehouseId} for user ${userId}:`, error);
     if (typeof window !== 'undefined') {
        requestAnimationFrame(() => toast({
            variant: "destructive",
            title: "Error DB",
            description: `No se pudo eliminar el almacén: ${error instanceof Error ? error.message : String(error)}`
        }));
    }
    throw error;
  }
};

    