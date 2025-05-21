
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
  serverTimestamp,
  Unsubscribe,
  onSnapshot,
  Timestamp,
  where,
  getDoc,
  deleteField,
} from 'firebase/firestore';
import type { DisplayProduct, ProductDetail, CountingHistoryEntry, Warehouse } from '@/types/product';
import { toast } from "@/hooks/use-toast"; // Assuming you have a toast hook

// --- Helper to check Firestore instance ---
function ensureDbInitialized() {
  if (!db) {
    console.error("Firestore (db) is not initialized. Check Firebase configuration and environment variables.");
    toast({
      variant: "destructive",
      title: "Error de Base de Datos",
      description: "La conexión con la base de datos en la nube no está disponible. Verifica tu configuración y conexión.",
    });
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
    return docSnap.exists() ? (docSnap.data() as ProductDetail) : undefined;
  } catch (error) {
    console.error(`Error getting product ${barcode} from catalog for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo obtener el producto del catálogo." });
    return undefined;
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
    querySnapshot.forEach((doc) => {
      products.push({ barcode: doc.id, ...doc.data() } as ProductDetail);
    });
    return products;
  } catch (error) {
    console.error(`Error getting all products from catalog for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudieron cargar los productos del catálogo." });
    return [];
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
    await setDoc(productDocRef, product, { merge: true }); // Use merge to update if exists, or create if not
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
        batch.set(productDocRef, product, { merge: true });
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
    const batch = writeBatch(db!);
    querySnapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
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
  const q = query(getWarehousesCollectionRef(userId), orderBy('name')); // Order by name for consistency
  
  return onSnapshot(
    q,
    (querySnapshot) => {
      const warehouses: Warehouse[] = [];
      querySnapshot.forEach((doc) => {
        warehouses.push(doc.data() as Warehouse);
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
    // Important: Also delete the counting list associated with this warehouse
    await clearCountingListForWarehouseInFirestore(userId, warehouseId);
  } catch (error) {
    console.error(`Error deleting warehouse ${warehouseId} for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo eliminar el almacén." });
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
    console.error("User ID, Warehouse ID, or product data is missing for setCountingListItem.");
    throw new Error("Datos incompletos para guardar el ítem de conteo.");
  }
  try {
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), product.barcode);
    // Prepare data for Firestore, ensuring serverTimestamp
    const { barcode, warehouseId: wid, ...dataToSave } = product; // Exclude barcode and wid from data being saved
    await setDoc(itemDocRef, { ...dataToSave, firestoreLastUpdated: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.error(`Error setting counting list item ${product.barcode} for user ${userId}, warehouse ${warehouseId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el producto en la lista de conteo." });
    throw error;
  }
};

export const deleteCountingListItem = async (userId: string, warehouseId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !warehouseId || !barcode) {
    console.error("User ID, Warehouse ID, or Barcode is missing for deleteCountingListItem.");
    throw new Error("Datos incompletos para eliminar el ítem de conteo.");
  }
  try {
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), barcode);
    await deleteDoc(itemDocRef);
  } catch (error) {
    console.error(`Error deleting counting list item ${barcode} for user ${userId}, warehouse ${warehouseId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo eliminar el producto de la lista de conteo." });
    throw error;
  }
};

export const clearCountingListForWarehouseInFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId || !warehouseId) {
    console.error("User ID or Warehouse ID is missing for clearCountingListForWarehouseInFirestore.");
    throw new Error("Datos incompletos para borrar la lista de conteo.");
  }
  try {
    const q = query(getCountingListCollectionRef(userId, warehouseId));
    const querySnapshot = await getDocs(q);
    const batch = writeBatch(db!);
    querySnapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  } catch (error) {
    console.error(`Error clearing counting list for user ${userId}, warehouse ${warehouseId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo borrar la lista de conteo." });
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
    return () => {}; // Return an empty unsubscribe function
  }
  const q = query(getCountingListCollectionRef(userId, warehouseId), orderBy('firestoreLastUpdated', 'desc'));

  return onSnapshot(
    q,
    (querySnapshot) => {
      const products: DisplayProduct[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        // Ensure lastUpdated is a string (ISO format) from Firestore or client
        let lastUpdatedString = data.lastUpdated;
        if (data.firestoreLastUpdated instanceof Timestamp) {
            lastUpdatedString = data.firestoreLastUpdated.toDate().toISOString();
        } else if (data.lastUpdated instanceof Timestamp) { // Fallback if only lastUpdated is a Timestamp
            lastUpdatedString = data.lastUpdated.toDate().toISOString();
        }

        products.push({
          barcode: doc.id,
          warehouseId: warehouseId, 
          description: data.description,
          provider: data.provider,
          stock: data.stock ?? 0,
          count: data.count ?? 0,
          lastUpdated: lastUpdatedString,
          expirationDate: data.expirationDate,
        } as DisplayProduct); // Cast to DisplayProduct
      });
      callback(products);
    },
    (error) => {
      console.error(`Error fetching counting list for user ${userId}, warehouse ${warehouseId}: `, error);
      if (typeof window !== 'undefined') {
        toast({
          variant: "destructive",
          title: "Error de Sincronización",
          description: "No se pueden obtener actualizaciones en tiempo real. Verifica tu conexión o intenta más tarde.",
        });
      }
      callback([]); 
    }
  );
};


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
    await setDoc(historyDocRef, { ...historyEntry, firestoreTimestamp: serverTimestamp() });
  } catch (error) {
    console.error(`Error saving counting history ${historyEntry.id} for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el historial de conteo." });
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
    const q = query(getCountingHistoryCollectionRef(userId), orderBy('timestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    const history: CountingHistoryEntry[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const products = data.products.map((p: any) => ({
        ...p,
        lastUpdated: p.lastUpdated instanceof Timestamp ? p.lastUpdated.toDate().toISOString() : p.lastUpdated,
      }));
      history.push({ id: doc.id, ...data, products } as CountingHistoryEntry);
    });
    return history;
  } catch (error) {
    console.error(`Error getting counting history for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo cargar el historial de conteos." });
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
    const batch = writeBatch(db!);
    querySnapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  } catch (error) {
    console.error(`Error clearing counting history for user ${userId}:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudo borrar el historial de conteos." });
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
    // Clear product catalog for the user
    const catalogRef = getProductCatalogCollectionRef(userId);
    const catalogSnapshot = await getDocs(catalogRef);
    const batch1 = writeBatch(db!);
    catalogSnapshot.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();
    console.log(`Product catalog cleared for user ${userId}`);

    // Clear counting history for the user
    await clearCountingHistoryInFirestore(userId);
    console.log(`Counting history cleared for user ${userId}`);

    // Clear all counting lists for all warehouses of the user
    const warehousesSnapshot = await getDocs(getWarehousesCollectionRef(userId));
    for (const whDoc of warehousesSnapshot.docs) {
      await clearCountingListForWarehouseInFirestore(userId, whDoc.id);
      console.log(`Counting list for warehouse ${whDoc.id} cleared for user ${userId}`);
    }
    
    // Optionally clear warehouses themselves if they are user-specific and should be wiped
    // const batch2 = writeBatch(db!);
    // warehousesSnapshot.forEach(doc => batch2.delete(doc.ref));
    // await batch2.commit();
    // console.log(`Warehouses cleared for user ${userId}`);

  } catch (error) {
    console.error(`Error clearing all data for user ${userId} in Firestore:`, error);
    toast({ variant: "destructive", title: "Error DB", description: "No se pudieron borrar todos los datos del usuario." });
    throw error;
  }
};
