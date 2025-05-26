
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
import type { DisplayProduct, ProductDetail, Warehouse } from '@/types/product';
import { toast } from "@/hooks/use-toast";

// --- Helper to check Firestore instance ---
function ensureDbInitialized() {
  if (!db) {
    const errorMessage = "CRITICAL_FIRESTORE_SERVICE_ERROR: Firestore (db) is not initialized. Operations will likely fail. Check Firebase configuration and environment variables.";
    console.error(errorMessage);
    // For critical operations, we might throw an error or return a rejected promise.
    // For subscriptions, it's handled by returning an empty unsubscribe and calling onErrorCallback.
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
    
    const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId'> & { firestoreLastUpdated: any } = {
      description: product.description || `Producto ${product.barcode.trim()}`,
      provider: product.provider || "Desconocido",
      stock: product.stock ?? 0,
      count: product.count ?? 0,
      lastUpdated: product.lastUpdated || new Date().toISOString(),
      expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "")
                       ? product.expirationDate.trim()
                       : null,
      firestoreLastUpdated: serverTimestamp(),
    };

    await setDoc(itemDocRef, dataToSet, { merge: true });
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
  onErrorCallback?: (error: Error) => void
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
        });
      });
      callback(products);
    },
    (error) => {
      console.error(`Error fetching counting list for user ${userId}, warehouse ${warehouseId}: `, error);
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => toast({
          variant: "destructive",
          title: "Error de Sincronización",
          description: "No se pueden obtener actualizaciones en tiempo real. Verifica tu conexión o intenta más tarde.",
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
  onErrorCallback?: (error: Error) => void
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
  } catch (error: any) {
    console.error(`Error deleting warehouse ${warehouseId} for user ${userId}:`, error);
     if (typeof window !== 'undefined') {
        requestAnimationFrame(() => toast({
            variant: "destructive",
            title: "Error DB",
            description: `No se pudo eliminar el almacén: ${error?.message || String(error)}`
        }));
    }
    throw error;
  }
};

// Catalog functions are now removed from here as they will be handled by IndexedDB
// (addOrUpdateProductInCatalog, getProductFromCatalog, getAllProductsFromCatalog, deleteProductFromCatalog, etc.)
