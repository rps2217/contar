// src/lib/firestore-service.ts
import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  writeBatch,
  serverTimestamp, // Important for setting server-side timestamps
  Unsubscribe,
  onSnapshot,
  Timestamp,
  getDoc,
  // deleteField, // Not used currently, can be removed if not needed
} from 'firebase/firestore';
import type { DisplayProduct, ProductDetail, CountingHistoryEntry, Warehouse } from '@/types/product';
import { toast } from "@/hooks/use-toast";

// --- Helper to check Firestore instance ---
function ensureDbInitialized() {
  if (!db) {
    console.error("Firestore (db) is not initialized. Check Firebase configuration and environment variables.");
    // This toast might not be visible if the error occurs very early or in a non-UI context.
    // Consider a more global error state or logging for production.
    // toast({
    //   variant: "destructive",
    //   title: "Error de Base de Datos",
    //   description: "La conexión con la base de datos en la nube no está disponible.",
    // });
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
  if (!userId || !barcode) {
    console.warn("User ID or Barcode is missing for getProductFromCatalog.");
    return undefined;
  }
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode);
    const docSnap = await getDoc(productDocRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        // Ensure expirationDate is null if it's undefined or empty string from Firestore
        return {
            ...data,
            expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate : null,
        } as ProductDetail;
    }
    return undefined;
  } catch (error) {
    console.error(`Error getting product ${barcode} from catalog for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo obtener el producto del catálogo." });
    return undefined; // Or throw error
  }
};

export const getAllProductsFromCatalog = async (userId: string): Promise<ProductDetail[]> => {
  ensureDbInitialized();
  if (!userId) {
    console.warn("User ID is missing for getAllProductsFromCatalog. Returning empty list.");
    return [];
  }
  try {
    const querySnapshot = await getDocs(getProductCatalogCollectionRef(userId));
    const products: ProductDetail[] = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      products.push({
        barcode: docSnap.id,
        ...data,
        // Ensure expirationDate is null if it's undefined or empty string from Firestore
        expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate : null,
      } as ProductDetail);
    });
    return products;
  } catch (error) {
    console.error(`Error getting all products from catalog for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudieron cargar los productos del catálogo." });
    return []; // Or throw error
  }
};

export const addOrUpdateProductInCatalog = async (userId: string, product: ProductDetail): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !product || !product.barcode) {
    console.error("User ID or product data is missing for addOrUpdateProductInCatalog.");
    throw new Error("Datos de usuario o producto incompletos.");
  }
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
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el producto en el catálogo." });
    throw error;
  }
};

export const deleteProductFromCatalog = async (userId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !barcode) {
    console.error("User ID or Barcode is missing for deleteProductFromCatalog.");
    throw new Error("Datos de usuario o producto incompletos para eliminar.");
  }
  try {
    const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode);
    await deleteDoc(productDocRef);
  } catch (error) {
    console.error(`Error deleting product ${barcode} from catalog for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo eliminar el producto del catálogo." });
    throw error;
  }
};

export const addProductsToCatalog = async (userId: string, products: ProductDetail[]): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !products || products.length === 0) {
    console.warn("User ID or products list is missing/empty for addProductsToCatalog.");
    return;
  }
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
    toast({ variant: "destructive", title: "Error DB", description: "No se pudieron agregar los productos al catálogo." });
    throw error;
  }
};

export const clearProductCatalogInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId) {
    console.error("User ID is missing for clearProductCatalogInFirestore.");
    throw new Error("ID de usuario faltante.");
  }
  try {
    const q = query(getProductCatalogCollectionRef(userId));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      console.log(`Product catalog for user ${userId} is already empty.`);
      return;
    }
    const batch = writeBatch(db!);
    querySnapshot.forEach((docSnap) => { // Changed doc to docSnap to avoid conflict
      batch.delete(docSnap.ref);
    });
    await batch.commit();
    console.log(`Product catalog cleared for user ${userId}`);
  } catch (error) {
    console.error(`Error clearing product catalog for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo borrar el catálogo de productos." });
    throw error;
  }
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
      querySnapshot.forEach((docSnap) => { // Changed doc to docSnap
        warehouses.push(docSnap.data() as Warehouse);
      });
      callback(warehouses);
    },
    (error) => {
      console.error(`Error fetching warehouses for user ${userId}:`, error);
      toast({ variant: "destructive", title: "Error DB", description: "No se pudieron cargar los almacenes." });
      callback([]);
    }
  );
};

export const addOrUpdateWarehouseInFirestore = async (userId: string, warehouse: Warehouse): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !warehouse || !warehouse.id || !warehouse.name) {
    console.error("User ID or warehouse data is missing/incomplete for addOrUpdateWarehouseInFirestore.");
    throw new Error("Datos de usuario o almacén incompletos.");
  }
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouse.id);
    await setDoc(warehouseDocRef, warehouse, { merge: true });
  } catch (error) {
    console.error(`Error adding/updating warehouse ${warehouse.id} for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el almacén." });
    throw error;
  }
};

export const deleteWarehouseFromFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
   if (!userId || !warehouseId) {
    console.error("User ID or Warehouse ID is missing for deleteWarehouseFromFirestore.");
    throw new Error("Datos de usuario o almacén incompletos para eliminar.");
  }
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouseId);
    await deleteDoc(warehouseDocRef);
    // Note: Deleting a warehouse does NOT automatically delete its associated counting list.
    // This might be desired, or you might want to implement cascading deletes if necessary.
    // For now, we keep them separate.
  } catch (error) {
    console.error(`Error deleting warehouse ${warehouseId} for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo eliminar el almacén." });
    throw error;
  }
};

// --- Counting List Operations (Firestore) ---
// This section was removed when reverting to localStorage for countingList.
// It can be re-added if Firestore sync for countingList is desired again.


// --- Counting History Operations (Firestore) ---
const getCountingHistoryCollectionRef = (userId: string) => {
  ensureDbInitialized();
  return collection(db!, `users/${userId}/countingHistory`);
};

export const saveCountingHistoryToFirestore = async (userId: string, historyEntry: CountingHistoryEntry): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !historyEntry || !historyEntry.id) {
    console.error("User ID or history entry data is missing for saveCountingHistoryToFirestore.");
    throw new Error("Datos de usuario o historial incompletos.");
  }
  try {
    const historyDocRef = doc(getCountingHistoryCollectionRef(userId), historyEntry.id);
    // Add serverTimestamp for consistent ordering and to know when it was saved on the server
    await setDoc(historyDocRef, { ...historyEntry, firestoreTimestamp: serverTimestamp() });
  } catch (error) {
    console.error(`Error saving counting history ${historyEntry.id} for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el historial de conteo en la nube." });
    throw error;
  }
};

export const getCountingHistoryFromFirestore = async (userId: string): Promise<CountingHistoryEntry[]> => {
  ensureDbInitialized();
  if (!userId) {
    console.warn("User ID is missing for getCountingHistoryFromFirestore. Returning empty list.");
    return [];
  }
  try {
    // Order by firestoreTimestamp if available, otherwise by client-side timestamp
    const q = query(getCountingHistoryCollectionRef(userId), orderBy('firestoreTimestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    const history: CountingHistoryEntry[] = [];
    querySnapshot.forEach((docSnap) => { // Changed doc to docSnap
      const data = docSnap.data();
      // Convert Firestore Timestamps in products array back to ISO strings if needed
      const products = (data.products as DisplayProduct[]).map(p => ({
        ...p,
        lastUpdated: p.lastUpdated instanceof Timestamp ? p.lastUpdated.toDate().toISOString() : p.lastUpdated,
      }));
      history.push({ 
        id: docSnap.id, 
        ...data, 
        timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toDate().toISOString() : data.timestamp,
        products 
      } as CountingHistoryEntry);
    });
    return history;
  } catch (error) {
    console.error(`Error getting counting history for user ${userId} from Firestore:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo cargar el historial de conteos de la nube." });
    return [];
  }
};

export const clearCountingHistoryInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId) {
    console.error("User ID is missing for clearCountingHistoryInFirestore.");
    throw new Error("ID de usuario faltante.");
  }
  try {
    const q = query(getCountingHistoryCollectionRef(userId));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
        console.log(`Counting history for user ${userId} in Firestore is already empty.`);
        return;
    }
    const batch = writeBatch(db!);
    querySnapshot.forEach((docSnap) => { // Changed doc to docSnap
      batch.delete(docSnap.ref);
    });
    await batch.commit();
    console.log(`Counting history cleared for user ${userId} in Firestore.`);
  } catch (error) {
    console.error(`Error clearing counting history for user ${userId} in Firestore:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo borrar el historial de conteos de la nube." });
    throw error;
  }
};

// --- Combined Database Operations for current user ---
export const clearAllUserDataInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId) {
    console.error("User ID is missing for clearAllUserDataInFirestore.");
    throw new Error("ID de usuario faltante.");
  }
  try {
    await clearProductCatalogInFirestore(userId);
    await clearCountingHistoryInFirestore(userId);

    // Clear all counting lists for all warehouses of the user (if they were in Firestore)
    // Since countingList is now local, this part is not strictly needed for countingList,
    // but good to have if you decide to sync it again.
    // const warehousesSnapshot = await getDocs(getWarehousesCollectionRef(userId));
    // for (const whDoc of warehousesSnapshot.docs) {
    //   await clearCountingListForWarehouseInFirestore(userId, whDoc.id); // This function was removed as countingList is local
    //   console.log(`Counting list for warehouse ${whDoc.id} (Firestore) notionally cleared for user ${userId}`);
    // }
    
    // Delete warehouses themselves
    const warehousesSnapshot = await getDocs(getWarehousesCollectionRef(userId));
    const warehouseBatch = writeBatch(db!);
    warehousesSnapshot.forEach(docSnap => warehouseBatch.delete(docSnap.ref)); // Changed doc to docSnap
    await warehouseBatch.commit();
    console.log(`Warehouses cleared for user ${userId} in Firestore.`);

    toast({ title: "Todos los Datos en la Nube Borrados", description: "Catálogo, historial y almacenes eliminados de Firestore."});

  } catch (error) {
    console.error(`Error clearing all data for user ${userId} in Firestore:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudieron borrar todos los datos del usuario de la nube." });
    throw error;
  }
};
