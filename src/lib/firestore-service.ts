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
  getDoc,
} from 'firebase/firestore';
import type { DisplayProduct, ProductDetail, CountingHistoryEntry, Warehouse } from '@/types/product';
import { toast } from "@/hooks/use-toast";

// --- Helper to check Firestore instance ---
function ensureDbInitialized() {
  if (!db) {
    console.warn("CRITICAL_FIRESTORE_SERVICE_ERROR: Firestore (db) is not initialized. Operations will likely fail. Check Firebase configuration and environment variables.");
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
        return {
            ...data,
            expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate : null,
        } as ProductDetail;
    }
    return undefined;
  } catch (error) {
    console.error(`Error getting product ${barcode} from catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudo obtener el producto del catálogo." }));
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
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      products.push({
        barcode: docSnap.id,
        ...data,
        expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate : null,
      } as ProductDetail);
    });
    return products;
  } catch (error) {
    console.error(`Error getting all products from catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudieron cargar los productos del catálogo." }));
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
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudo guardar el producto en el catálogo." }));
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
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudo eliminar el producto del catálogo." }));
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
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudieron agregar los productos al catálogo." }));
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
    querySnapshot.forEach((docSnap) => { 
      batch.delete(docSnap.ref);
    });
    await batch.commit();
    console.log(`Product catalog cleared for user ${userId}`);
  } catch (error) {
    console.error(`Error clearing product catalog for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudo borrar el catálogo de productos." }));
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
      querySnapshot.forEach((docSnap) => { 
        warehouses.push(docSnap.data() as Warehouse);
      });
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
  if (!userId || !warehouse || !warehouse.id || !warehouse.name) {
    console.error("User ID or warehouse data is missing/incomplete for addOrUpdateWarehouseInFirestore.");
    throw new Error("Datos de usuario o almacén incompletos.");
  }
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
   if (!userId || !warehouseId) {
    console.error("User ID or Warehouse ID is missing for deleteWarehouseFromFirestore.");
    throw new Error("Datos de usuario o almacén incompletos para eliminar.");
  }
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouseId);
    await deleteDoc(warehouseDocRef);
  } catch (error) {
    console.error(`Error deleting warehouse ${warehouseId} for user ${userId}:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudo eliminar el almacén." }));
    throw error;
  }
};

// --- Counting History Operations (Firestore) ---
// Functions related to counting history have been removed as per user request.
// - getCountingHistoryCollectionRef (helper for history)
// - saveCountingHistoryToFirestore
// - getCountingHistoryFromFirestore
// - clearCountingHistoryInFirestore


// --- Combined Database Operations for current user ---
export const clearAllUserDataInFirestore = async (userId: string): Promise<void> => {
  ensureDbInitialized();
  if (!userId) {
    console.error("User ID is missing for clearAllUserDataInFirestore.");
    throw new Error("ID de usuario faltante.");
  }
  try {
    await clearProductCatalogInFirestore(userId);
    // await clearCountingHistoryInFirestore(userId); // History clearing removed
    
    const warehousesSnapshot = await getDocs(getWarehousesCollectionRef(userId));
    const warehouseBatch = writeBatch(db!);
    warehousesSnapshot.forEach(docSnap => warehouseBatch.delete(docSnap.ref)); 
    await warehouseBatch.commit();
    console.log(`Warehouses cleared for user ${userId} in Firestore.`);

    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ title: "Datos en la Nube Borrados", description: "Catálogo y almacenes eliminados de Firestore."}));

  } catch (error) {
    console.error(`Error clearing all data for user ${userId} in Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: "No se pudieron borrar todos los datos del usuario de la nube." }));
    throw error;
  }
};
