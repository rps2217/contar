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
  if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para getCountingListCollectionRef.");

  if (!userId || userId.trim() === "") {
    throw new Error(`User ID está ausente o vacío para getCountingListCollectionRef. Recibido: '${userId}'`);
  }
  if (!warehouseId || warehouseId.trim() === "") {
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
    
    // Asegurar que expirationDate sea null si es undefined o cadena vacía
    const expirationDateToSave = (product.expirationDate && typeof product.expirationDate === 'string' && product.expirationDate.trim() !== "")
                                  ? product.expirationDate.trim()
                                  : null;

    const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'lastUpdated'> & { firestoreLastUpdated: any } = {
      description: product.description?.trim() || `Producto ${product.barcode.trim()}`,
      provider: product.provider?.trim() || "Desconocido",
      stock: (typeof product.stock === 'number' && !isNaN(product.stock)) ? product.stock : 0,
      count: (typeof product.count === 'number' && !isNaN(product.count)) ? product.count : 0,
      expirationDate: expirationDateToSave,
      firestoreLastUpdated: serverTimestamp(),
    };

    await setDoc(itemDocRef, dataToSet, { merge: true });
  } catch (error: any) {
    console.error(`Error guardando item de lista de conteo ${product.barcode} para usuario ${userId}, almacén ${warehouseId} en Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Conteo (Nube)", description: `No se pudo guardar el producto en la nube: ${error.message}` }));
    throw error;
  }
};

export const deleteCountingListItem = async (userId: string, warehouseId: string, barcode: string): Promise<void> => {
  ensureDbInitialized();
   if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para deleteCountingListItem.");

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
    const itemDocRef = doc(getCountingListCollectionRef(userId, warehouseId), barcode);
    await deleteDoc(itemDocRef);
  } catch (error: any) {
    console.error(`Error eliminando item de lista de conteo ${barcode} para usuario ${userId}, almacén ${warehouseId} de Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Conteo (Nube)", description: `No se pudo eliminar el producto de la nube: ${error.message}` }));
    throw error;
  }
};

export const clearCountingListForWarehouseInFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para clearCountingListForWarehouseInFirestore.");
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
          // Convertir Timestamp de Firestore a cadena ISO para lastUpdated
          lastUpdated: firestoreTimestamp ? firestoreTimestamp.toDate().toISOString() : (data.lastUpdated || new Date(0).toISOString()),
          expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") ? data.expirationDate.trim() : null,
        });
      });
      callback(products);
    },
    (error) => {
      console.error(`Error en onSnapshot para lista de conteo (usuario ${userId}, almacén ${warehouseId}):`, error);
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => toast({
          variant: "destructive",
          title: "Error de Sincronización de Conteo",
          description: `No se pueden obtener actualizaciones en tiempo real para la lista. ${error.message}`,
        }));
      }
      if (onErrorCallback) onErrorCallback(error);
    }
  );
};


// --- Warehouse Operations (Firestore) ---
const getWarehousesCollectionRef = (userId: string) => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para getWarehousesCollectionRef.");
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
    callback([]); // Devuelve una lista vacía si no hay usuario
    return () => {}; // Devuelve una función de desuscripción vacía
  }
  const q = query(getWarehousesCollectionRef(userId), orderBy('name'));
  
  return onSnapshot(
    q,
    (querySnapshot) => {
      const warehouses: Warehouse[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        warehouses.push({
            id: docSnap.id, // Usar docSnap.id como el ID del almacén
            name: data.name || `Almacén ${docSnap.id}` // Asegurar que name tenga un valor
        });
      });
      callback(warehouses);
    },
    (error) => {
      console.error(`Error en onSnapshot para almacenes (usuario ${userId}):`, error);
      if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB (Almacenes)", description: `No se pudieron cargar los almacenes: ${error.message}` }));
      if (onErrorCallback) onErrorCallback(error);
    }
  );
};

export const addOrUpdateWarehouseInFirestore = async (userId: string, warehouse: Warehouse): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para addOrUpdateWarehouseInFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID está ausente o vacío. Recibido: '${userId}'`);
  if (!warehouse || !warehouse.id || warehouse.id.trim() === "" || !warehouse.name || warehouse.name.trim() === "") {
    throw new Error("Datos del almacén (ID o Nombre) están ausentes o vacíos.");
  }
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouse.id.trim());
    // Solo guardar name y id, ya que son los campos de la interfaz Warehouse
    await setDoc(warehouseDocRef, {name: warehouse.name.trim().toUpperCase(), id: warehouse.id.trim()}, { merge: true });
  } catch (error: any) {
    console.error(`Error añadiendo/actualizando almacén ${warehouse.id} para usuario ${userId} en Firestore:`, error);
    if (typeof window !== 'undefined') requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB (Almacenes)", description: `No se pudo guardar el almacén: ${error.message}` }));
    throw error;
  }
};

export const deleteWarehouseFromFirestore = async (userId: string, warehouseId: string): Promise<void> => {
  ensureDbInitialized();
  if (!db) throw new Error("Firestore (db) es nulo o no está inicializado para deleteWarehouseFromFirestore.");
  if (!userId || userId.trim() === "") throw new Error(`User ID está ausente o vacío. Recibido: '${userId}'`);
  if (!warehouseId || warehouseId.trim() === "") throw new Error(`Warehouse ID está ausente o vacío. Recibido: '${warehouseId}'`);
  try {
    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouseId);
    await deleteDoc(warehouseDocRef);
    // Considerar la eliminación de la subcolección de conteo asociada si es necesario
    await clearCountingListForWarehouseInFirestore(userId, warehouseId);
  } catch (error: any) {
    console.error(`Error eliminando almacén ${warehouseId} para usuario ${userId} de Firestore:`, error);
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

// --- NO Product Catalog Operations in Firestore ---
// Las funciones como getAllProductsFromCatalog, addOrUpdateProductInCatalog, etc., han sido eliminadas.
// El catálogo de productos se gestiona con IndexedDB a través de src/lib/database.ts
