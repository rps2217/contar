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
import { toast } from "@/hooks/use-toast"; // Ensure toast is imported if used within this service

// --- Helper to check Firestore instance ---
function ensureDbInitialized() {
  if (!db) {
    const errorMessage = "CRITICAL_FIRESTORE_SERVICE_ERROR: Firestore (db) is not initialized. Operations will likely fail. Check Firebase configuration and environment variables.";
    console.error(errorMessage);
    // Avoid calling toast directly in service layer if it's not always run in a UI context
    // Consider a global error state or logging for production instead.
    // if (typeof window !== 'undefined') {
    //   toast({ variant: "destructive", title: "Error de Conexión", description: "La base de datos no está disponible." });
    // }
    throw new Error("Firestore (db) is not initialized.");
  }
}

// --- Product Catalog Operations (Firestore) ---
const getProductCatalogCollectionRef = (userId: string) => {
  ensureDbInitialized();
  return collection(db!, `users/${userId}/productCatalog`);
};

export const getProductFromCatalog = async (userId: string, barcode: string): Promise<ProductDetail | undefined> => {
  ensureDbInitialized();
  if (!userId || !barcode) return undefined;
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode);
    const docSnap = await getDoc(productDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        ...data,
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
  if (!userId) return [];
  try {
    const querySnapshot = await getDocs(getProductCatalogCollectionRef(userId));
    return querySnapshot.docs.map(docSnap => ({
      barcode: docSnap.id,
      ...docSnap.data(),
      expirationDate: (docSnap.data().expirationDate && typeof docSnap.data().expirationDate === 'string' && docSnap.data().expirationDate.trim() !== "") ? docSnap.data().expirationDate.trim() : null,
    } as ProductDetail));
  } catch (error) {
    console.error(`Error getting all products from catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudieron cargar los productos." }));
    return [];
  }
};

export const addOrUpdateProductInCatalog = async (userId: string, product: ProductDetail): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !product || !product.barcode) throw new Error("Datos de usuario o producto incompletos.");
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), product.barcode);
    const dataToSave: ProductDetail = {
      barcode: product.barcode,
      description: product.description?.trim() || `Producto ${product.barcode}`,
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
  if (!userId || !barcode) throw new Error("Datos incompletos para eliminar producto.");
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
  if (!userId || !products || products.length === 0) return;
  try {
    const batch = writeBatch(db!);
    products.forEach((product) => {
      if (product && product.barcode) {
        const productDocRef = doc(getProductCatalogCollectionRef(userId), product.barcode);
        const dataToSave: ProductDetail = {
          barcode: product.barcode,
          description: product.description || `Producto ${product.barcode}`,
          provider: product.provider || "Desconocido",
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
  if (!userId) throw new Error("ID de usuario faltante.");
  try {
    const q = query(getProductCatalogCollectionRef(userId));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return;
    const batch = writeBatch(db!);
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
  return collection(db!, `users/${userId}/countingLists/${warehouseId}/products`);
};

export const setCountingListItem = async (userId: string, warehouseId: string, product: DisplayProduct): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !warehouseId || !product || !product.barcode) {
    throw new Error("User ID, Warehouse ID, or product data is missing/incomplete for setCountingListItem.");
  }
  try {
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), product.barcode);
    const productData: Omit<DisplayProduct, 'barcode' | 'warehouseId'> & { firestoreLastUpdated: Timestamp } = {
      description: product.description,
      provider: product.provider,
      stock: product.stock ?? 0,
      count: product.count ?? 0,
      lastUpdated: product.lastUpdated || new Date().toISOString(),
      expirationDate: product.expirationDate || null,
      firestoreLastUpdated: serverTimestamp() as Timestamp,
    };
    await setDoc(itemDocRef, productData, { merge: true });
  } catch (error) {
    console.error(`Error setting counting list item ${product.barcode} for user ${userId}, warehouse ${warehouseId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Conteo", description: "No se pudo guardar el producto en la lista." }));
    throw error;
  }
};

export const deleteCountingListItem = async (userId: string, warehouseId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !warehouseId || !barcode) {
    throw new Error("User ID, Warehouse ID, or barcode is missing for deleteCountingListItem.");
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
  if (!userId || !warehouseId) {
    console.error("User ID or Warehouse ID is missing for clearCountingListForWarehouseInFirestore.");
    throw new Error("Datos de usuario o almacén incompletos para limpiar la lista de conteo.");
  }
  try {
    const countingListProductsRef = getCountingListCollectionRef(userId, warehouseId);
    const querySnapshot = await getDocs(countingListProductsRef);

    if (querySnapshot.empty) {
      console.log(`Counting list for user ${userId}, warehouse ${warehouseId} is already empty in Firestore.`);
      return;
    }

    const batch = writeBatch(db!);
    querySnapshot.forEach((docSnapshot) => {
      batch.delete(docSnapshot.ref);
    });
    await batch.commit();
    console.log(`Counting list cleared in Firestore for user ${userId}, warehouse ${warehouseId}`);
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
  callback: (products: DisplayProduct[]) => void
): Unsubscribe => {
  ensureDbInitialized();
  if (!userId || !warehouseId) {
    console.warn("User ID or Warehouse ID is missing for subscribing to counting list. Returning empty list.");
    callback([]);
    return () => {};
  }
  const q = query(getCountingListCollectionRef(userId, warehouseId), orderBy('firestoreLastUpdated', 'desc'));
  
  const unsubscribe = onSnapshot(
    q,
    (querySnapshot) => {
      const products: DisplayProduct[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const firestoreTimestamp = data.firestoreLastUpdated as Timestamp | undefined;
        products.push({
          barcode: docSnap.id,
          warehouseId: warehouseId,
          description: data.description,
          provider: data.provider,
          stock: data.stock ?? 0,
          count: data.count ?? 0,
          lastUpdated: firestoreTimestamp ? firestoreTimestamp.toDate().toISOString() : data.lastUpdated,
          expirationDate: data.expirationDate || null,
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
          description: "No se pueden obtener actualizaciones en tiempo real. Verifica tu conexión.",
        }));
      }
      callback([]);
    }
  );
  return unsubscribe;
};


// --- Warehouse Operations (Firestore) ---
const getWarehousesCollectionRef = (userId: string) => {
  ensureDbInitialized();
  return collection(db!, `users/${userId}/warehouses`);
};

export const subscribeToWarehouses = (
  userId: string,
  callback: (warehouses: Warehouse[]) => void
): Unsubscribe => {
  ensureDbInitialized();
  if (!userId) {
    console.warn("User ID is missing for subscribing to warehouses. Returning empty list.");
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
      console.error(`Error fetching warehouses for user ${userId}:`, error);
      if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudieron cargar los almacenes." }));
      callback([]);
    }
  );
};

export const addOrUpdateWarehouseInFirestore = async (userId: string, warehouse: Warehouse): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !warehouse || !warehouse.id || !warehouse.name) throw new Error("Datos de usuario o almacén incompletos.");
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouse.id);
    await setDoc(warehouseDocRef, warehouse, { merge: true });
  } catch (error) {
    console.error(`Error adding/updating warehouse ${warehouse.id} for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el almacén." }));
    throw error;
  }
};

export const deleteWarehouseFromFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !warehouseId) throw new Error("Datos incompletos para eliminar almacén.");
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


// --- Counting History Operations (Firestore) ---
const getCountingHistoryCollectionRef = (userId: string) => {
  ensureDbInitialized();
  return collection(db!, `users/${userId}/countingHistory`);
};

export const saveCountingHistoryToFirestore = async (userId: string, historyEntry: Omit<CountingHistoryEntry, 'id' | 'firestoreTimestamp'>): Promise<void> => {
  ensureDbInitialized();
  if (!userId) throw new Error("User ID is missing for saving counting history.");
  try {
    const historyDocRef = doc(getCountingHistoryCollectionRef(userId)); // Auto-generate ID
    const entryWithTimestamp: CountingHistoryEntry = {
      ...historyEntry,
      id: historyDocRef.id,
      firestoreTimestamp: serverTimestamp() as Timestamp,
    };
    await setDoc(historyDocRef, entryWithTimestamp);
  } catch (error) {
    console.error(`Error saving counting history for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Historial", description: "No se pudo guardar el historial en la nube." }));
    throw error;
  }
};

export const getCountingHistoryFromFirestore = async (userId: string): Promise<CountingHistoryEntry[]> => {
  ensureDbInitialized();
  if (!userId) return [];
  try {
    const q = query(getCountingHistoryCollectionRef(userId), orderBy('firestoreTimestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(docSnap => {
      const data = docSnap.data();
      const firestoreTimestamp = data.firestoreTimestamp as Timestamp | undefined;
      return {
        ...data,
        id: docSnap.id,
        timestamp: firestoreTimestamp ? firestoreTimestamp.toDate().toISOString() : data.timestamp,
        // products array should already be in DisplayProduct format
      } as CountingHistoryEntry;
    });
  } catch (error) {
    console.error(`Error fetching counting history for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Historial", description: "No se pudo cargar el historial." }));
    return [];
  }
};

export const clearCountingHistoryInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId) throw new Error("User ID is missing for clearing counting history.");
  try {
    const q = query(getCountingHistoryCollectionRef(userId));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return;
    const batch = writeBatch(db!);
    querySnapshot.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  } catch (error) {
    console.error(`Error clearing counting history for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Historial", description: "No se pudo borrar el historial." }));
    throw error;
  }
};
