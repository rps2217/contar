
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
} from 'firebase/firestore';
import type { DisplayProduct, ProductDetail, CountingHistoryEntry } from '@/types/product';

// Helper to get a reference to the user's specific counting list collection for a warehouse
// const getCountingListCollectionRef = (userId: string, warehouseId: string) => {
//   return collection(db, `users/${userId}/countingLists/${warehouseId}/products`);
// };

// --- Counting List Operations (Now managed via localStorage in page.tsx) ---
// Functions for setCountingListItem, deleteCountingListItem, clearCountingListForWarehouseInFirestore,
// and subscribeToCountingList are REMOVED as countingList is now local.

// --- Counting History Operations (Firestore) ---

// Helper to get a reference to the user's counting history collection
const getCountingHistoryCollectionRef = (userId: string) => {
  return collection(db, `users/${userId}/countingHistory`);
};

/**
 * Saves a counting history entry to Firestore for a specific user.
 */
export const saveCountingHistoryToFirestore = async (userId: string, historyEntry: CountingHistoryEntry): Promise<void> => {
  if (!userId) {
    console.error("User ID is missing, cannot save counting history.");
    throw new Error("User ID is missing.");
  }
  if (!historyEntry || !historyEntry.id) {
    console.error("History entry or ID is missing.");
    throw new Error("History entry or ID is missing.");
  }
  const historyDocRef = doc(getCountingHistoryCollectionRef(userId), historyEntry.id);
  await setDoc(historyDocRef, { ...historyEntry, firestoreTimestamp: serverTimestamp() });
};

/**
 * Fetches all counting history entries for a specific user from Firestore, ordered by timestamp.
 */
export const getCountingHistoryFromFirestore = async (userId: string): Promise<CountingHistoryEntry[]> => {
  if (!userId) {
    console.warn("User ID is missing, cannot fetch counting history. Returning empty list.");
    return [];
  }
  const q = query(getCountingHistoryCollectionRef(userId), orderBy('timestamp', 'desc'));
  const querySnapshot = await getDocs(q);
  const history: CountingHistoryEntry[] = [];
  querySnapshot.forEach((doc) => {
    // Convert Firestore Timestamps back to ISO strings if necessary for DisplayProduct.lastUpdated
    const data = doc.data();
    const products = data.products.map((p: any) => ({
      ...p,
      lastUpdated: p.lastUpdated instanceof Timestamp ? p.lastUpdated.toDate().toISOString() : p.lastUpdated,
      // expirationDate might also need conversion if stored as Timestamp, though currently it's a string
    }));
    history.push({ id: doc.id, ...data, products } as CountingHistoryEntry);
  });
  return history;
};

/**
 * Clears all counting history entries for a specific user in Firestore.
 */
export const clearCountingHistoryInFirestore = async (userId: string): Promise<void> => {
  if (!userId) {
    console.error("User ID is missing, cannot clear counting history.");
    throw new Error("User ID is missing.");
  }
  const historyCollectionRef = getCountingHistoryCollectionRef(userId);
  const querySnapshot = await getDocs(historyCollectionRef);
  const batch = writeBatch(db);
  querySnapshot.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
};


// --- Potentially for Product Catalog in Firestore (if needed in future, currently IndexedDB) ---
// const getGlobalProductCatalogCollectionRef = () => {
//   return collection(db, 'globalProductCatalog');
// };

// export const addOrUpdateGlobalProduct = async (product: ProductDetail): Promise<void> => {
//   const productDocRef = doc(getGlobalProductCatalogCollectionRef(), product.barcode);
//   await setDoc(productDocRef, product, { merge: true });
// };

// export const getGlobalProduct = async (barcode: string): Promise<ProductDetail | undefined> => {
//   const productDocRef = doc(getGlobalProductCatalogCollectionRef(), barcode);
//   const docSnap = await getDoc(productDocRef);
//   return docSnap.exists() ? (docSnap.data() as ProductDetail) : undefined;
// };

// export const getAllGlobalProducts = async (): Promise<ProductDetail[]> => {
//   const querySnapshot = await getDocs(getGlobalProductCatalogCollectionRef());
//   const products: ProductDetail[] = [];
//   querySnapshot.forEach((doc) => {
//     products.push({ barcode: doc.id, ...doc.data() } as ProductDetail);
//   });
//   return products;
// };

// --- Warehouse data in Firestore (Example if needed, currently localStorage) ---
// const getWarehousesCollectionRef = (userId: string) => {
//   return collection(db, `users/${userId}/warehouses`);
// };

// export const saveWarehouseToFirestore = async (userId: string, warehouse: Warehouse): Promise<void> => {
//   const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouse.id);
//   await setDoc(warehouseDocRef, warehouse);
// };

// export const getWarehousesFromFirestore = async (userId: string): Promise<Warehouse[]> => {
//   const querySnapshot = await getDocs(getWarehousesCollectionRef(userId));
//   const warehouses: Warehouse[] = [];
//   querySnapshot.forEach((doc) => {
//     warehouses.push(doc.data() as Warehouse);
//   });
//   return warehouses;
// };

// export const deleteWarehouseFromFirestore = async (userId: string, warehouseId: string): Promise<void> => {
//    const warehouseDocRef = doc(getWarehousesCollectionRef(userId), warehouseId);
//    await deleteDoc(warehouseDocRef);
// };
