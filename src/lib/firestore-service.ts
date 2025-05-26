
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
import { toast } from "@/hooks/use-toast";
import { dateToTimestamp, timestampToDate } from '@/lib/firebase-helpers';

// --- Helper to check Firestore instance ---
function ensureDbInitialized() {
  if (!db) {
    const errorMessage = "CRITICAL_FIRESTORE_SERVICE_ERROR: Firestore (db) is not initialized. Operations will likely fail. Check Firebase configuration and environment variables.";
    console.error(errorMessage);
    // For critical operations, we might throw an error or return a rejected promise.
  }
}

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

export const setCountingListItem = async (userId: string, warehouseId: string, product: DisplayProduct): Promise<void> => {
  ensureDbInitialized();
  console.log("[setCountingListItem] Firestore: Producto recibido:", JSON.parse(JSON.stringify(product || {})));
  console.log(`[setCountingListItem] Firestore: product.barcode recibido: '${product?.barcode}'`);

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
    console.error(`[setCountingListItem] Firestore: El código de barras del producto está ausente o vacío. Detalles: ${productDetails}`);
    throw new Error(`El código de barras del producto está ausente o vacío para setCountingListItem. Detalles: ${productDetails}`);
  }

  try {
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), product.barcode.trim());
    
    // Prepare data for Firestore, ensuring correct types and server timestamp
    const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'lastUpdated'> & { firestoreLastUpdated: any } = {
      description: product.description || `Producto ${product.barcode.trim()}`,
      provider: product.provider || "Desconocido",
      stock: product.stock ?? 0,
      count: product.count ?? 0,
      expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "")
                       ? product.expirationDate.trim()
                       : null,
      firestoreLastUpdated: serverTimestamp(), // Use server timestamp for reliable ordering
    };

    await setDoc(itemDocRef, dataToSet, { merge: true });
  } catch (error: any) {
    console.error(`Error setting counting list item ${product.barcode} for user ${userId}, warehouse ${warehouseId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Conteo (Nube)", description: `No se pudo guardar el producto en la nube: ${error.message}` }));
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
  } catch (error: any) {
    console.error(`Error deleting counting list item ${barcode} for user ${userId}, warehouse ${warehouseId} from Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Conteo (Nube)", description: `No se pudo eliminar el producto de la nube: ${error.message}` }));
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
  } catch (error: any) {
    console.error(`Error clearing counting list in Firestore for user ${userId}, warehouse ${warehouseId}:`, error);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => toast({
        variant: "destructive",
        title: "Error DB (Nube)",
        description: `No se pudo borrar la lista de conteo de la nube: ${error.message}`,
      }));
    }
    throw error;
  }
};

export const subscribeToCountingList = (
  userId: string,
  warehouseId: string,
  callback: (products: DisplayProduct[]) => void,
  onErrorCallback?: (error: Error) => void
): Unsubscribe => {
  ensureDbInitialized();
  if (!db) {
    console.error("Firestore (db) is not initialized for subscribeToCountingList. Cannot subscribe.");
    if (onErrorCallback) onErrorCallback(new Error("Firestore (db) is not initialized."));
    return () => {};
  }
  if (!userId || userId.trim() === "" || !warehouseId || warehouseId.trim() === "") {
    console.warn(`[subscribeToCountingList] User ID ('${userId}') or Warehouse ID ('${warehouseId}') is missing. Aborting subscription.`);
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
          // firestoreLastUpdated is mainly for ordering in Firestore, not usually displayed directly
        });
      });
      callback(products);
    },
    (error) => {
      console.error(`Error in onSnapshot for counting list (user ${userId}, warehouse ${warehouseId}):`, error);
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => toast({
          variant: "destructive",
          title: "Error de Sincronización de Conteo",
          description: `No se pueden obtener actualizaciones en tiempo real para la lista. ${error.message}`,
        }));
      }
      if (onErrorCallback) onErrorCallback(error);
      // Do not call callback([]) here if we want to preserve local data on error
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
  onErrorCallback?: (error: Error) => void
): Unsubscribe => {
  ensureDbInitialized();
  if (!db) {
    console.error("Firestore (db) is not initialized for subscribeToWarehouses. Cannot subscribe.");
    if (onErrorCallback) onErrorCallback(new Error("Firestore (db) is not initialized."));
    return () => {};
  }
  if (!userId || userId.trim() === "") {
    console.warn(`[subscribeToWarehouses] User ID ('${userId}') is missing. Aborting subscription.`);
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
      if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB (Almacenes)", description: `No se pudieron cargar los almacenes: ${error.message}` }));
      if (onErrorCallback) onErrorCallback(error);
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
  } catch (error: any) {
    console.error(`Error adding/updating warehouse ${warehouse.id} for user ${userId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB (Almacenes)", description: `No se pudo guardar el almacén: ${error.message}` }));
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
  } catch (error: any) {
    console.error(`Error deleting warehouse ${warehouseId} for user ${userId} from Firestore:`, error);
     if (typeof window !== 'undefined') {
        requestAnimationFrame(() => toast({
            variant: "destructive",
            title: "Error DB (Almacenes)",
            description: `No se pudo eliminar el almacén: ${error?.message || String(error)}`
        }));
    }
    throw error;
  }
};

// --- Product Catalog Operations (Firestore) ---
const getProductCatalogCollectionRef = (userId: string) => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getProductCatalogCollectionRef.");
  if (!userId || userId.trim() === "") {
    throw new Error(`User ID is missing or empty for getProductCatalogCollectionRef. Received: '${userId}'`);
  }
  return collection(db, `users/${userId}/productCatalog`);
};

export const addOrUpdateProductInCatalog = async (userId: string, product: ProductDetail): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for addOrUpdateProductInCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  if (!product || !product.barcode || product.barcode.trim() === "") {
    throw new Error("Product data (barcode) is missing or empty for addOrUpdateProductInCatalog.");
  }
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
  } catch (error: any) {
    console.error(`Error adding/updating product ${product.barcode} in catalog for user ${userId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo guardar el producto en el catálogo: ${error.message}` }));
    throw error;
  }
};

export const getProductFromCatalog = async (userId: string, barcode: string): Promise<ProductDetail | undefined> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getProductFromCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  if (!barcode || barcode.trim() === "") throw new Error(`Barcode is missing or empty. Received: '${barcode}'`);
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode.trim());
    const docSnap = await getDoc(productDocRef);
    return docSnap.exists() ? (docSnap.data() as ProductDetail) : undefined;
  } catch (error: any) {
    console.error(`Error getting product ${barcode} from catalog for user ${userId} from Firestore:`, error);
    throw error;
  }
};

export const getAllProductsFromCatalog = async (userId: string): Promise<ProductDetail[]> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getAllProductsFromCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  try {
    const q = query(getProductCatalogCollectionRef(userId), orderBy('description'));
    const querySnapshot = await getDocs(q);
    const products: ProductDetail[] = [];
    querySnapshot.forEach((docSnap) => products.push(docSnap.data() as ProductDetail));
    return products;
  } catch (error: any) {
    console.error(`Error getting all products from catalog for user ${userId} from Firestore:`, error);
    throw error;
  }
};

export const deleteProductFromCatalog = async (userId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for deleteProductFromCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  if (!barcode || barcode.trim() === "") throw new Error(`Barcode is missing or empty. Received: '${barcode}'`);
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode.trim());
    await deleteDoc(productDocRef);
  } catch (error: any) {
    console.error(`Error deleting product ${barcode} from catalog for user ${userId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo eliminar el producto del catálogo: ${error.message}` }));
    throw error;
  }
};

export const addProductsToCatalog = async (userId: string, products: ProductDetail[]): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for addProductsToCatalog.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  if (!products || products.length === 0) return;

  try {
    const batch = writeBatch(db);
    const catalogRef = getProductCatalogCollectionRef(userId);
    products.forEach((product) => {
      if (product && product.barcode && product.barcode.trim() !== "") {
        const productDocRef = doc(catalogRef, product.barcode.trim());
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
  } catch (error: any) {
    console.error(`Error adding products to catalog for user ${userId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudieron agregar los productos al catálogo: ${error.message}` }));
    throw error;
  }
};

export const clearProductCatalogInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for clearProductCatalogInFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);

  try {
    const catalogRef = getProductCatalogCollectionRef(userId);
    const querySnapshot = await getDocs(catalogRef);
    if (querySnapshot.empty) return;
    const batch = writeBatch(db);
    querySnapshot.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();
  } catch (error: any) {
    console.error(`Error clearing product catalog for user ${userId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo borrar el catálogo de productos: ${error.message}` }));
    throw error;
  }
};


// --- Counting History Operations (Firestore) ---
const getCountingHistoryCollectionRef = (userId: string) => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getCountingHistoryCollectionRef.");
  if (!userId || userId.trim() === "") {
    throw new Error(`User ID is missing or empty for getCountingHistoryCollectionRef. Received: '${userId}'`);
  }
  return collection(db, `users/${userId}/countingHistory`);
};

export const saveCountingHistoryToFirestore = async (userId: string, historyEntry: Omit<CountingHistoryEntry, 'id' | 'userId'>): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for saveCountingHistoryToFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);

  try {
    const historyCollectionRef = getCountingHistoryCollectionRef(userId);
    const newHistoryDocRef = doc(historyCollectionRef); // Firestore generates ID

    const entryToSave: CountingHistoryEntry = {
      ...historyEntry,
      id: newHistoryDocRef.id,
      userId: userId,
      timestamp: historyEntry.timestamp || new Date().toISOString(), // Ensure timestamp
      firestoreTimestamp: serverTimestamp() as Timestamp, // For ordering
    };
    await setDoc(newHistoryDocRef, entryToSave);
  } catch (error: any) {
    console.error(`Error saving counting history for user ${userId} to Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Historial (Nube)", description: `No se pudo guardar el historial: ${error.message}` }));
    throw error;
  }
};

export const getCountingHistoryFromFirestore = async (userId: string): Promise<CountingHistoryEntry[]> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for getCountingHistoryFromFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  try {
    const q = query(getCountingHistoryCollectionRef(userId), orderBy('firestoreTimestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    const history: CountingHistoryEntry[] = [];
    querySnapshot.forEach((docSnap) => {
        const data = docSnap.data() as any; // Cast to any to access firestoreTimestamp
        // Convert Firestore Timestamps in products back to ISO strings if necessary
        const products = (data.products as DisplayProduct[]).map(p => ({
            ...p,
            lastUpdated: p.lastUpdated ? (timestampToDate(p.lastUpdated)?.toISOString() ?? p.lastUpdated) : new Date(0).toISOString(),
            // firestoreLastUpdated is part of product in DisplayProduct
            firestoreLastUpdated: p.firestoreLastUpdated ? timestampToDate(p.firestoreLastUpdated) : undefined
        }));

        history.push({
            ...data,
            id: docSnap.id,
            timestamp: data.firestoreTimestamp ? (data.firestoreTimestamp as Timestamp).toDate().toISOString() : data.timestamp,
            products: products
        } as CountingHistoryEntry);
    });
    return history;
  } catch (error: any) {
    console.error(`Error getting counting history for user ${userId} from Firestore:`, error);
    throw error;
  }
};

export const clearCountingHistoryInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) is not initialized for clearCountingHistoryInFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID is missing or empty. Received: '${userId}'`);
  try {
    const historyCollectionRef = getCountingHistoryCollectionRef(userId);
    const querySnapshot = await getDocs(historyCollectionRef);
    if (querySnapshot.empty) return;
    const batch = writeBatch(db);
    querySnapshot.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
    await batch.commit();
  } catch (error: any) {
    console.error(`Error clearing counting history for user ${userId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Historial (Nube)", description: `No se pudo borrar el historial: ${error.message}` }));
    throw error;
  }
};
