
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
  if (!db) {
    console.error("[FirestoreService] db is null in getCountingListCollectionRef");
    throw new Error("Firestore (db) es nulo o no está inicializado para getCountingListCollectionRef.");
  }
  if (!userId || userId.trim() === "") {
    console.error(`[FirestoreService] User ID está ausente o vacío para getCountingListCollectionRef. Recibido: '${userId}'`);
    throw new Error(`User ID está ausente o vacío para getCountingListCollectionRef. Recibido: '${userId}'`);
  }
  if (!warehouseId || warehouseId.trim() === "") {
    console.error(`[FirestoreService] Warehouse ID está ausente o vacío para getCountingListCollectionRef. Recibido: '${warehouseId}'`);
    throw new Error(`Warehouse ID está ausente o vacío para getCountingListCollectionRef. Recibido: '${warehouseId}'`);
  }
  return collection(db, `users/${userId}/countingLists/${warehouseId}/products`);
};

export const setCountingListItem = async (userId: string, warehouseId: string, product: DisplayProduct): Promise<void> => {
  ensureDbInitialized();
  console.log("[setCountingListItem] Firestore: Producto recibido:", JSON.parse(JSON.stringify(product || {})));
  console.log(`[setCountingListItem] Firestore: product.barcode recibido: '${product?.barcode}'`);

  if (!userId || userId.trim() === "") {
    throw new Error(`User ID está ausente o vacío para setCountingListItem. Recibido: '${userId}'`);
  }
  if (!warehouseId || warehouseId.trim() === "") {
    throw new Error(`Warehouse ID está ausente o vacío para setCountingListItem. Recibido: '${warehouseId}'`);
  }
  if (!product) {
    throw new Error("Product data es nulo o indefinido para setCountingListItem.");
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
    
    const dataToSet = {
      description: product.description?.trim() || `Producto ${product.barcode.trim()}`,
      provider: product.provider?.trim() || "Desconocido",
      stock: (typeof product.stock === 'number' && !isNaN(product.stock)) ? product.stock : 0,
      count: (typeof product.count === 'number' && !isNaN(product.count)) ? product.count : 0,
      expirationDate: (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "") 
                       ? product.expirationDate.trim() 
                       : null,
      lastUpdated: product.lastUpdated || new Date().toISOString(),
      firestoreLastUpdated: serverTimestamp(),
    };

    await setDoc(itemDocRef, dataToSet, { merge: true });
  } catch (error: any) {
    console.error(`Error guardando item de lista de conteo ${product.barcode} para usuario ${userId}, almacén ${warehouseId} en Firestore:`, error);
    if (typeof window !== 'undefined') {
        requestAnimationFrame(() => { // Ensure toast is called outside render cycle
            toast({ variant: "destructive", title: "Error Conteo (Nube)", description: `No se pudo guardar el producto en la nube: ${error.message}` });
        });
    }
    throw error;
  }
};

export const deleteCountingListItem = async (userId: string, warehouseId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
   if (!db) {
    console.error("[FirestoreService] db is null in deleteCountingListItem");
    throw new Error("Firestore (db) es nulo o no está inicializado para deleteCountingListItem.");
   }
  if (!userId || userId.trim() === "") {
    throw new Error(`User ID está ausente o vacío para deleteCountingListItem. Recibido: '${userId}'`);
  }
  if (!warehouseId || warehouseId.trim() === "") {
    throw new Error(`Warehouse ID está ausente o vacío para deleteCountingListItem. Recibido: '${warehouseId}'`);
  }
  if (!barcode || barcode.trim() === "") {
    throw new Error(`Barcode está ausente o vacío para deleteCountingListItem. Recibido: '${barcode}'`);
  }

  try {
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), barcode.trim());
    await deleteDoc(itemDocRef);
  } catch (error: any) {
    console.error(`Error eliminando item de lista de conteo ${barcode} para usuario ${userId}, almacén ${warehouseId} de Firestore:`, error);
    if (typeof window !== 'undefined') {
        requestAnimationFrame(() => { // Ensure toast is called outside render cycle
            toast({ variant: "destructive", title: "Error Conteo (Nube)", description: `No se pudo eliminar el producto de la nube: ${error.message}` });
        });
    }
    throw error;
  }
};

export const clearCountingListForWarehouseInFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) {
    console.error("[FirestoreService] db is null in clearCountingListForWarehouseInFirestore");
    throw new Error("Firestore (db) es nulo o no está inicializado para clearCountingListForWarehouseInFirestore.");
  }
  if (!userId || userId.trim() === "") throw new Error(`User ID está ausente o vacío para clearCountingList. Recibido: '${userId}'`);
  if (!warehouseId || warehouseId.trim() === "") throw new Error(`Warehouse ID está ausente o vacío para clearCountingList. Recibido: '${warehouseId}'`);

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
    console.error(`Error limpiando lista de conteo en Firestore para usuario ${userId}, almacén ${warehouseId}:`, error);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => { // Ensure toast is called outside render cycle
        toast({
          variant: "destructive",
          title: "Error DB (Nube)",
          description: `No se pudo borrar la lista de conteo de la nube: ${error.message}`,
        });
      });
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
    console.error("Firestore (db) es nulo o no está inicializado para subscribeToCountingList. No se puede suscribir.");
    if (onErrorCallback) onErrorCallback(new Error("Firestore (db) no está inicializado."));
    return () => {};
  }
   if (!userId || userId.trim() === "" || !warehouseId || warehouseId.trim() === "") {
    console.warn(`[subscribeToCountingList] User ID ('${userId}') o Warehouse ID ('${warehouseId}') está ausente. Cancelando suscripción.`);
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
      console.error(`Error en onSnapshot para lista de conteo (usuario ${userId}, almacén ${warehouseId}):`, error);
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => { // Ensure toast is called outside render cycle
          toast({
            variant: "destructive",
            title: "Error de Sincronización de Conteo",
            description: `No se pueden obtener actualizaciones en tiempo real para la lista. ${error.message}`,
          });
        });
      }
      if (onErrorCallback) onErrorCallback(error);
    }
  );
};

// --- Warehouse Operations (Firestore) ---
const getWarehousesCollectionRef = (userId: string) => {
  ensureDbInitialized();
  if (!db) {
    console.error("[FirestoreService] db is null in getWarehousesCollectionRef");
    throw new Error("Firestore (db) es nulo o no está inicializado para getWarehousesCollectionRef.");
  }
  if (!userId || userId.trim() === "") {
    throw new Error(`User ID está ausente o vacío para getWarehousesCollectionRef. Recibido: '${userId}'`);
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
    console.error("Firestore (db) es nulo o no está inicializado para subscribeToWarehouses. No se puede suscribir.");
    if (onErrorCallback) onErrorCallback(new Error("Firestore (db) no está inicializado."));
    return () => {};
  }
   if (!userId || userId.trim() === "") {
    console.warn(`[subscribeToWarehouses] User ID ('${userId}') está ausente. Cancelando suscripción.`);
    callback([]); 
    return () => {}; 
  }
  const q = query(getWarehousesCollectionRef(userId), orderBy('name'));
  
  return onSnapshot(
    q,
    (querySnapshot) => {
      const warehouses: Warehouse[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        warehouses.push({
            id: docSnap.id, 
            name: data.name || `Almacén ${docSnap.id}` 
        });
      });
      callback(warehouses);
    },
    (error) => {
      console.error(`Error en onSnapshot para almacenes (usuario ${userId}):`, error);
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => { // Ensure toast is called outside render cycle
            toast({ variant: "destructive", title: "Error DB (Almacenes)", description: `No se pudieron cargar los almacenes: ${error.message}` });
        });
      }
      if (onErrorCallback) onErrorCallback(error);
    }
  );
};

export const addOrUpdateWarehouseInFirestore = async (userId: string, warehouse: Warehouse): Promise<void> => {
  ensureDbInitialized();
  if (!db) {
    console.error("[FirestoreService] db is null in addOrUpdateWarehouseInFirestore");
    throw new Error("Firestore (db) es nulo o no está inicializado para addOrUpdateWarehouseInFirestore.");
  }
  if (!userId || userId.trim() === "") throw new Error(`User ID está ausente o vacío. Recibido: '${userId}'`);
  if (!warehouse || !warehouse.id || warehouse.id.trim() === "" || !warehouse.name || warehouse.name.trim() === "") {
    throw new Error("Datos del almacén (ID o Nombre) están ausentes o vacíos.");
  }
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouse.id.trim());
    await setDoc(warehouseDocRef, {name: warehouse.name.trim().toUpperCase(), id: warehouse.id.trim()}, { merge: true });
  } catch (error: any) {
    console.error(`Error añadiendo/actualizando almacén ${warehouse.id} para usuario ${userId} en Firestore:`, error);
    if (typeof window !== 'undefined') {
        requestAnimationFrame(() => { // Ensure toast is called outside render cycle
            toast({ variant: "destructive", title: "Error DB (Almacenes)", description: `No se pudo guardar el almacén: ${error.message}` });
        });
    }
    throw error;
  }
};

export const deleteWarehouseFromFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) {
    console.error("[FirestoreService] db is null in deleteWarehouseFromFirestore");
    throw new Error("Firestore (db) es nulo o no está inicializado para deleteWarehouseFromFirestore.");
  }
  if (!userId || userId.trim() === "") throw new Error(`User ID está ausente o vacío. Recibido: '${userId}'`);
  if (!warehouseId || warehouseId.trim() === "") throw new Error(`Warehouse ID está ausente o vacío. Recibido: '${warehouseId}'`);
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouseId);
    await deleteDoc(warehouseDocRef);
    // También limpiar la lista de conteo asociada a este almacén en Firestore
    await clearCountingListForWarehouseInFirestore(userId, warehouseId);
  } catch (error: any) {
    console.error(`Error eliminando almacén ${warehouseId} para usuario ${userId} de Firestore:`, error);
     if (typeof window !== 'undefined') {
        requestAnimationFrame(() => { // Ensure toast is called outside render cycle
            toast({
                variant: "destructive",
                title: "Error DB (Almacenes)",
                description: `No se pudo eliminar el almacén: ${error?.message || String(error)}`
            });
        });
    }
    throw error;
  }
};
    
// --- Product Catalog Operations (Firestore) ---
const getProductCatalogCollectionRef = (userId: string) => {
    ensureDbInitialized();
    if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para getProductCatalogCollectionRef.");
    if (!userId || userId.trim() === "") {
        throw new Error(`User ID está ausente o vacío para getProductCatalogCollectionRef. Recibido: '${userId}'`);
    }
    return collection(db, `users/${userId}/productCatalog`);
};

export const addOrUpdateProductInCatalog = async (userId: string, product: ProductDetail): Promise<void> => {
    ensureDbInitialized();
    if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para addOrUpdateProductInCatalog.");
    if (!userId || userId.trim() === "") {
        throw new Error(`User ID está ausente o vacío para addOrUpdateProductInCatalog. Recibido: '${userId}'`);
    }
    if (!product || !product.barcode || product.barcode.trim() === "") {
        throw new Error("Product data o barcode está ausente/incompleto para addOrUpdateProductInCatalog.");
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
        console.error(`Error añadiendo/actualizando producto ${product.barcode} en catálogo para usuario ${userId}:`, error);
        if (typeof window !== 'undefined') {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo guardar el producto en el catálogo: ${error.message}` }));
        }
        throw error;
    }
};

export const getProductFromCatalog = async (userId: string, barcode: string): Promise<ProductDetail | undefined> => {
    ensureDbInitialized();
    if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para getProductFromCatalog.");
    if (!userId || userId.trim() === "") {
        throw new Error(`User ID está ausente o vacío para getProductFromCatalog. Recibido: '${userId}'`);
    }
    if (!barcode || barcode.trim() === "") {
        throw new Error(`Barcode está ausente o vacío para getProductFromCatalog. Recibido: '${barcode}'`);
    }
    try {
        const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode.trim());
        const docSnap = await getDoc(productDocRef);
        if (docSnap.exists()) {
            return docSnap.data() as ProductDetail;
        }
        return undefined;
    } catch (error: any) {
        console.error(`Error obteniendo producto ${barcode} del catálogo para usuario ${userId}:`, error);
        throw error; // Re-throw para que el llamador lo maneje
    }
};

export const getAllProductsFromCatalog = async (userId: string): Promise<ProductDetail[]> => {
    ensureDbInitialized();
    if (!db) {
        console.warn("Firestore (db) es nulo o no está inicializado para getAllProductsFromCatalog. Devolviendo array vacío.");
        return [];
    }
    if (!userId || userId.trim() === "") {
        console.warn(`User ID está ausente o vacío para getAllProductsFromCatalog. Recibido: '${userId}'. Devolviendo array vacío.`);
        return [];
    }
    try {
        const q = query(getProductCatalogCollectionRef(userId), orderBy('description'));
        const querySnapshot = await getDocs(q);
        const products: ProductDetail[] = [];
        querySnapshot.forEach((docSnap) => {
            products.push(docSnap.data() as ProductDetail);
        });
        return products;
    } catch (error: any) {
        console.error(`Error obteniendo todos los productos del catálogo para usuario ${userId}:`, error);
        if (typeof window !== 'undefined') {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo cargar el catálogo: ${error.message}` }));
        }
        return [];
    }
};

export const deleteProductFromCatalog = async (userId: string, barcode: string): Promise<void> => {
    ensureDbInitialized();
    if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para deleteProductFromCatalog.");
    if (!userId || userId.trim() === "") {
        throw new Error(`User ID está ausente o vacío para deleteProductFromCatalog. Recibido: '${userId}'`);
    }
    if (!barcode || barcode.trim() === "") {
        throw new Error(`Barcode está ausente o vacío para deleteProductFromCatalog. Recibido: '${barcode}'`);
    }
    try {
        const productDocRef = doc(getProductCatalogCollectionRef(userId), barcode.trim());
        await deleteDoc(productDocRef);
    } catch (error: any) {
        console.error(`Error eliminando producto ${barcode} del catálogo para usuario ${userId}:`, error);
        if (typeof window !== 'undefined') {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo eliminar el producto del catálogo: ${error.message}` }));
        }
        throw error;
    }
};

export const addProductsToCatalog = async (userId: string, products: ProductDetail[]): Promise<void> => {
    ensureDbInitialized();
    if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para addProductsToCatalog.");
    if (!userId || userId.trim() === "") {
        throw new Error(`User ID está ausente o vacío para addProductsToCatalog. Recibido: '${userId}'`);
    }
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
    } catch (error: any) {
        console.error(`Error añadiendo productos en lote al catálogo para usuario ${userId}:`, error);
        if (typeof window !== 'undefined') {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo guardar los productos en el catálogo: ${error.message}` }));
        }
        throw error;
    }
};

export const clearProductCatalogInFirestore = async (userId: string): Promise<void> => {
    ensureDbInitialized();
    if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para clearProductCatalogInFirestore.");
    if (!userId || userId.trim() === "") {
        throw new Error(`User ID está ausente o vacío para clearProductCatalogInFirestore. Recibido: '${userId}'`);
    }
    try {
        const catalogRef = getProductCatalogCollectionRef(userId);
        const querySnapshot = await getDocs(catalogRef);
        if (querySnapshot.empty) return;

        const batch = writeBatch(db);
        querySnapshot.forEach((docSnapshot) => {
            batch.delete(docSnapshot.ref);
        });
        await batch.commit();
    } catch (error: any) {
        console.error(`Error limpiando catálogo de productos para usuario ${userId}:`, error);
        if (typeof window !== 'undefined') {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo borrar el catálogo: ${error.message}` }));
        }
        throw error;
    }
};
