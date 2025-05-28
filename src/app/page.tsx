
"use client";

import type { DisplayProduct, ProductDetail, Warehouse, ConsolidatedProductViewItem } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem, debounce } from "@/lib/utils";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle as UIDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock,
  BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide,
  LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert,
  Filter, Download, Edit, Library, X, Camera, ScanLine, Scan
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo, useTransition } from "react";

// IndexedDB functions (Product Catalog is managed here)
import {
  getProductFromDB as getProductFromIndexedDB,
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  clearProductDatabase, // Renamed alias for clarity
  addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database'; // Using IndexedDB for product catalog

// Firestore functions (Warehouses, CountingList)
import {
  subscribeToWarehouses,
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  setCountingListItem,
  deleteCountingListItem,
  subscribeToCountingList,
  clearCountingListForWarehouseInFirestore,
  // Catalog functions are removed from here, managed by IndexedDB
} from '@/lib/firestore-service';

import { SidebarLayout } from '@/components/sidebar-layout';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { useIsMobile } from '@/hooks/use-mobile';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { EditProductDialog } from '@/components/edit-product-dialog';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { WarehouseManagement } from '@/components/warehouse-management';
import { EditWarehouseDialog } from '@/components/edit-warehouse-dialog';
import { ProductDatabase as ProductDatabaseComponent } from '@/components/product-database';
import { CounterSection } from '@/components/counter-section';
import { ConsolidatedView } from '@/components/consolidated-view';
import { BarcodeEntry } from '@/components/barcode-entry';
import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera';
// import { CountingListTable } from '@/components/counting-list-table'; // Already imported in CounterSection


// Firebase db instance for Firestore operations
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection } from 'firebase/firestore'; // Removed serverTimestamp as it's not used in page.tsx directly
import Papa from 'papaparse';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { playBeep } from '@/lib/helpers';
import {
    LOCAL_STORAGE_USER_ID_KEY,
    LOCAL_STORAGE_ACTIVE_SECTION_KEY,
    LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY,
    LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX,
    LOCAL_STORAGE_WAREHOUSE_LIST_KEY_PREFIX,
    LOGIN_USER,
    LOGIN_PASSWORD,
    LAST_SCANNED_BARCODE_TIMEOUT_MS,
    DEFAULT_WAREHOUSE_ID,
    DEFAULT_WAREHOUSE_NAME,
    GOOGLE_SHEET_URL_LOCALSTORAGE_KEY, // Needed for ProductDatabase prop
    LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX,
  } from '@/lib/constants';


// --- Helper functions for Google Sheet Import (moved here from ProductDatabaseComponent) ---
const extractSpreadsheetIdAndGid = (input: string): { spreadsheetId: string | null; gid: string } => {
    if (!input) return { spreadsheetId: null, gid: '0' };

    let spreadsheetId: string | null = null;
    const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/.*)?/;
    const idMatch = input.match(sheetUrlPattern);

    if (idMatch && idMatch[1]) {
        spreadsheetId = idMatch[1];
    } else if (!input.includes('/') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
        spreadsheetId = input;
    }

    const gidMatch = input.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';

    return { spreadsheetId, gid };
};


async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);

    if (!spreadsheetId) {
      console.warn("[fetchGoogleSheetData] No se pudo extraer el ID de la hoja de cálculo de la entrada:", sheetUrlOrId);
      throw new Error("URL/ID de Hoja de Google inválido. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }

    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    let response: Response;

    try {
      const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
      response = await fetch(urlWithCacheBust, { cache: "no-store" });
    } catch (error: any) {
      let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL/ID.";
      if (error.message?.includes('Failed to fetch')) {
          userMessage += " Posible problema de CORS, conectividad, o la URL/ID es incorrecta. Asegúrese de que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.";
      } else {
          userMessage += ` Detalle: ${error.message}`;
      }
      console.error("[fetchGoogleSheetData] Error de red:", error);
      throw new Error(userMessage);
    }


    if (!response.ok) {
      const status = response.status;
      const statusText = response.statusText;
      let errorBody = "No se pudo leer el cuerpo del error.";
      try { errorBody = await response.text(); } catch { /* no-op */ }

      let userMessage = `Error ${status} al obtener datos de Google Sheet. `;
      if (status === 400) userMessage += "Solicitud incorrecta (Bad Request). ¿El GID es correcto?";
      else if (status === 403) userMessage += "Acceso denegado (Forbidden). Asegúrese de que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.";
      else if (status === 404) userMessage += "Hoja no encontrada (Not Found). Verifique el ID de la hoja.";
      else userMessage += ` ${statusText}. Detalle: ${errorBody.substring(0, 200)}`;

      console.error("[fetchGoogleSheetData] Detalles del error de obtención de Google Sheet:", { status, statusText, errorBody, csvExportUrl });
      throw new Error(userMessage);
    }

    const csvText = await response.text();

    return new Promise((resolve, reject) => {
      if (typeof Papa === 'undefined') {
        console.error("[fetchGoogleSheetData] PapaParse (Papa) no está definido/cargado.");
        reject(new Error("La librería PapaParse (Papa) no está cargada."));
        return;
      }

      Papa.parse<string[]>(csvText, {
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
              results.errors.forEach(err => console.warn(`[fetchGoogleSheetData] Error de PapaParse: ${err.message} en la fila ${err.row}. Código: ${err.code}. Tipo: ${err.type}`));
          }
          const csvData = results.data;
          const products: ProductDetail[] = [];

          if (csvData.length <= 1) {
            resolve(products);
            return;
          }

          const BARCODE_COLUMN_INDEX = 0;
          const DESCRIPTION_COLUMN_INDEX = 1;
          const EXPIRATION_DATE_COLUMN_INDEX = 2; // Ajustar si es diferente
          const STOCK_COLUMN_INDEX = 5;
          const PROVIDER_COLUMN_INDEX = 9;

          for (let i = 1; i < csvData.length; i++) {
            const values = csvData[i];
            if (!values || values.length === 0 || values.every(v => !v?.trim())) continue;

            const barcode = values[BARCODE_COLUMN_INDEX]?.trim();
            if (!barcode) {
              console.warn(`[fetchGoogleSheetData] Fila ${i + 1} omitida: Código de barras vacío o faltante.`);
              continue;
            }

            const description = values[DESCRIPTION_COLUMN_INDEX]?.trim();
            const provider = values[PROVIDER_COLUMN_INDEX]?.trim();
            const stockStr = values[STOCK_COLUMN_INDEX]?.trim();
            const expirationDateStr = values[EXPIRATION_DATE_COLUMN_INDEX]?.trim();

            const finalDescription = description || `Producto ${barcode}`;
            const finalProvider = provider || "Desconocido";

            let stock = 0;
            if (stockStr) {
              const parsedStock = parseInt(stockStr, 10);
              if (!isNaN(parsedStock) && parsedStock >= 0) {
                stock = parsedStock;
              } else {
                console.warn(`[fetchGoogleSheetData] Valor de stock inválido "${stockStr}" para código ${barcode} en fila ${i + 1}. Usando 0.`);
              }
            }

            const expirationDate: string | null = expirationDateStr ? expirationDateStr : null;

            products.push({ barcode, description: finalDescription, provider: finalProvider, stock, expirationDate });
          }
          resolve(products);
        },
        error: (error: any) => {
          console.error("[fetchGoogleSheetData] Error de análisis CSV de PapaParse:", error);
          reject(new Error(`Error al analizar el archivo CSV desde Google Sheet: ${error.message}`));
        }
      });
    });
}

const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
];

// --- Main Component ---
export default function Home() {
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(false);
  const lastScannedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isTransitionPending, startTransition] = useTransition();

  // --- Authentication State ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // --- UI State ---
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useLocalStorage<string>(
    LOCAL_STORAGE_ACTIVE_SECTION_KEY,
    'Contador'
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage<boolean>(
    LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY,
    false
  );
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const isMobile = useIsMobile();
  const [isDbLoading, setIsDbLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");

  // --- Warehouse State (Firestore as master, localStorage as cache for active warehouse ID & list) ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  const [isInitialFetchDoneForUserWarehouses, setIsInitialFetchDoneForUserWarehouses] = useState(false);

  // --- Product Catalog State (IndexedDB as master, React state as copy) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]);

  // --- Counting List State (Firestore as master, localStorage as cache for offline/quick load) ---
  const [barcode, setBarcode] = useState("");
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);

  // --- Dialog States ---
  const [openModifyDialog, setOpenModifyDialog] = useState<{ type: 'count' | 'stock', product: DisplayProduct | null } | null>(null);
  const [isConfirmQuantityDialogOpen, setIsConfirmQuantityDialogOpen] = useState(false);
  const [confirmQuantityAction, setConfirmQuantityAction] = useState<'increment' | 'decrement' | 'set' | null>(null);
  const [confirmQuantityProductBarcode, setConfirmQuantityProductBarcode] = useState<string | null>(null);
  const [confirmQuantityNewValue, setConfirmQuantityNewValue] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleteListDialogOpen, setIsDeleteListDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);

  // --- Misc State ---
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);

  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
  const [isClearCatalogConfirmOpen, setIsClearCatalogConfirmOpen] = useState(false);

  // --- Camera Scan Mode State ---
  const [isCameraScanMode, setIsCameraScanMode] = useState(false);
  const [isActivelyScanningByButton, setIsActivelyScanningByButton] = useState(false);
  const handleScanButtonPress = useCallback(() => setIsActivelyScanningByButton(true), []);
  const handleScanButtonRelease = useCallback(() => setIsActivelyScanningByButton(false), []);
  const toggleCameraScanMode = useCallback(() => setIsCameraScanMode(prev => !prev), []);

  // --- Focus Management ---
  const focusBarcodeIfCounting = useCallback(() => {
    if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current) {
        requestAnimationFrame(() => {
            if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current) {
                 if (document.activeElement !== barcodeInputRef.current) {
                    barcodeInputRef.current.focus();
                 }
            }
        });
        setTimeout(() => {
            if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current) {
                if (document.activeElement !== barcodeInputRef.current) {
                    barcodeInputRef.current.focus();
                }
            }
        }, 100);
    }
  }, [activeSection]);

  // --- Toast for Discrepancies (conditionally shown) ---
  const showDiscrepancyToastIfNeeded = useCallback((product: DisplayProduct, newCountVal?: number) => {
    const countToCheck = newCountVal !== undefined ? newCountVal : (product.count ?? 0);
    const stockToCheck = product.stock ?? 0;

    if (stockToCheck > 0 && countToCheck !== stockToCheck) {
        if (isMountedRef.current && activeSection !== 'Contador' && activeSection !== 'Contador Cámara') {
            requestAnimationFrame(() => {
                if(isMountedRef.current) {
                    toast({
                        title: "Alerta de Discrepancia",
                        description: `${product.description}: Contado ${countToCheck}, Stock ${stockToCheck}.`,
                        variant: "default",
                    });
                }
            });
        }
        return true;
    }
    return false;
  }, [toast, activeSection]);


  // --- Catalog Management (IndexedDB as Master, React state as copy) ---
  const synchronizeAndLoadCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    setProcessingStatus("Cargando catálogo local (IndexedDB)...");
    console.log("[SyncCatalog] Attempting to load catalog from IndexedDB.");

    try {
        const localProducts = await getAllProductsFromIndexedDB();
        const sortedLocalProducts = localProducts
            .filter(p => p && p.barcode) // Ensure product and barcode exist
            .map(p => ({
                ...p,
                description: p.description || `Producto ${p.barcode}`, // Fallback for description
                provider: p.provider || "Desconocido", // Fallback for provider
                stock: p.stock ?? 0, // Fallback for stock
                expirationDate: p.expirationDate || null, // Ensure null if undefined/empty
            }))
            .sort((a, b) => (a.description || '').localeCompare(b.description || ''));

        startTransition(() => setCatalogProducts(sortedLocalProducts));
        setProcessingStatus(localProducts.length > 0 ? "Catálogo local cargado." : "Catálogo local vacío.");
        console.log(`[SyncCatalog] Loaded ${sortedLocalProducts.length} products from IndexedDB.`);
    } catch (indexedDbError) {
        console.error("[SyncCatalog] Error loading catalog from IndexedDB:", indexedDbError);
        startTransition(() => setCatalogProducts([]));
        setProcessingStatus("Error al cargar catálogo local.");
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo cargar el catálogo." }));
    } finally {
        if (isMountedRef.current) setIsDbLoading(false);
        console.log("[SyncCatalog] Catalog loading process finished.");
    }
  }, [
    toast,
    getAllProductsFromIndexedDB,
    setCatalogProducts, setIsDbLoading, setProcessingStatus // State setters
  ]);


  // --- Warehouse Management (Firestore as master, localStorage as cache) ---
  useEffect(() => {
    const localWarehouseListKey = currentUserId ? `${LOCAL_STORAGE_WAREHOUSE_LIST_KEY_PREFIX}${currentUserId}` : null;
    const storedCurrentWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : null;

    // 1. Load from localStorage first for quick UI
    if (isMountedRef.current && currentUserId && localWarehouseListKey && storedCurrentWarehouseIdKey) {
        const localWarehouses = getLocalStorageItem<Warehouse[]>(localWarehouseListKey, []);
        const localCurrentId = getLocalStorageItem<string>(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID);

        let warehousesToSetFromLocal = [...localWarehouses];
        PREDEFINED_WAREHOUSES_LIST.forEach(predef => {
            if (!warehousesToSetFromLocal.some(w => w.id === predef.id)) {
                warehousesToSetFromLocal.push(predef);
            }
        });
        warehousesToSetFromLocal = warehousesToSetFromLocal.filter((wh, index, self) => index === self.findIndex((t) => t.id === wh.id));
        warehousesToSetFromLocal.sort((a,b) => a.name.localeCompare(b.name));

        startTransition(() => {
            setWarehouses(warehousesToSetFromLocal);
            setCurrentWarehouseId(warehousesToSetFromLocal.some(w => w.id === localCurrentId) ? localCurrentId : DEFAULT_WAREHOUSE_ID);
        });
    } else if (isMountedRef.current && !currentUserId) { // No user, use predefined
        startTransition(() => {
            setWarehouses([...PREDEFINED_WAREHOUSES_LIST].sort((a,b) => a.name.localeCompare(b.name)));
            setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
        });
    }

    // 2. Subscribe to Firestore if user is authenticated and db is available
    if (!currentUserId || !db || !isAuthenticated) {
      if (isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(false); // Reset flag if user logs out
      return () => {}; // No subscription if no user or db
    }

    let isInitialFetchForUser = !isInitialFetchDoneForUserWarehouses;

    console.log(`[Warehouses] Subscribing to Firestore for user: ${currentUserId}`);
    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehousesFromFirestore) => {
        if (!isMountedRef.current) return;
        console.log(`[Warehouses] Received ${fetchedWarehousesFromFirestore.length} warehouses from Firestore.`);

        let effectiveWarehouseList = [...fetchedWarehousesFromFirestore];
        let currentSelectionIdFromStorage = storedCurrentWarehouseIdKey ? getLocalStorageItem<string>(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;

        if (isInitialFetchForUser && db && currentUserId) {
            setIsSyncing(true);
            const warehousesToAddBatch: Warehouse[] = [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predef => {
                if (!effectiveWarehouseList.some(fsWh => fsWh.id === predef.id)) {
                    warehousesToAddBatch.push(predef);
                }
            });

            if (warehousesToAddBatch.length > 0) {
                console.log(`[Warehouses] Adding ${warehousesToAddBatch.length} predefined warehouses to Firestore for ${currentUserId}.`);
                try {
                    const batch = writeBatch(db); // db should be defined here
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                    console.log("[Warehouses] Predefined warehouses added to Firestore.");
                    // Firestore will send new snapshot, no need to merge locally here
                } catch (err) {
                    console.error(`[Warehouses] Failed to add predefined warehouses to Firestore for ${currentUserId}:`, err);
                    if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                }
            }
            if (isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(true);
            setIsSyncing(false);
        }

        // The listener will eventually give us the most up-to-date list including newly added ones
        // So, use fetchedWarehousesFromFirestore as the base, then ensure predefined ones are present for UI consistency
        // if Firestore is slow or initial add hasn't propagated yet.
        let combinedList = [...effectiveWarehouseList];
        PREDEFINED_WAREHOUSES_LIST.forEach(predef => {
            if (!combinedList.some(w => w.id === predef.id)) {
                combinedList.push(predef);
            }
        });
        combinedList = combinedList.filter((wh, index, self) => index === self.findIndex((t) => t.id === wh.id));
        combinedList.sort((a, b) => a.name.localeCompare(b.name));

        startTransition(() => {
            setWarehouses(combinedList);
            if (localWarehouseListKey) setLocalStorageItem(localWarehouseListKey, combinedList); // Cache the Firestore list

            if (!combinedList.some(w => w.id === currentSelectionIdFromStorage)) {
                const mainExists = combinedList.find(w => w.id === DEFAULT_WAREHOUSE_ID);
                currentSelectionIdFromStorage = mainExists ? DEFAULT_WAREHOUSE_ID : (combinedList[0]?.id || DEFAULT_WAREHOUSE_ID);
            }

            if (currentWarehouseId !== currentSelectionIdFromStorage) {
                setCurrentWarehouseId(currentSelectionIdFromStorage);
            }
            if (storedCurrentWarehouseIdKey && currentSelectionIdFromStorage !== getLocalStorageItem(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID)) {
                 setLocalStorageItem(storedCurrentWarehouseIdKey, currentSelectionIdFromStorage);
            }
        });

    }, (error) => {
        console.error("[Warehouses] Firestore subscription error:", error);
        if (isMountedRef.current) {
            // Fallback to localStorage if Firestore subscription fails
            let localOrPredefined = localWarehouseListKey ? getLocalStorageItem<Warehouse[]>(localWarehouseListKey!, []) : [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predef => {
                if (!localOrPredefined.some(w => w.id === predef.id)) {
                    localOrPredefined.push(predef);
                }
            });
            localOrPredefined = localOrPredefined.filter((wh, index, self) => index === self.findIndex((t) => t.id === wh.id));
            localOrPredefined.sort((a,b) => a.name.localeCompare(b.name));

            startTransition(() => {
                setWarehouses(localOrPredefined);
                const storedId = storedCurrentWarehouseIdKey ? getLocalStorageItem<string>(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
                const finalCurrentId = localOrPredefined.some(w => w.id === storedId) ? storedId : (localOrPredefined.find(w => w.id === DEFAULT_WAREHOUSE_ID)?.id || localOrPredefined[0]?.id || DEFAULT_WAREHOUSE_ID);
                if(currentWarehouseId !== finalCurrentId) setCurrentWarehouseId(finalCurrentId);
            });
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Red (Almacenes)", description: "No se pudieron cargar almacenes de la nube. Usando datos locales."}));
            if (isInitialFetchForUser && isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(true);
        }
    });

    return () => {
        console.log("[Warehouses] Unsubscribing from Firestore.");
        unsubscribe();
    };
  }, [currentUserId, isAuthenticated, toast, db, isInitialFetchDoneForUserWarehouses, currentWarehouseId]); // currentWarehouseId added back for re-validation of selection


  // --- Counting List (Firestore as master, localStorage as cache) ---
  useEffect(() => {
    if (!isMountedRef.current) return () => {};

    const localKey = currentUserId && currentWarehouseId ? `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}` : null;

    if (localKey) {
      const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
      if (isMountedRef.current) {
        startTransition(() => { setCountingList(localList); }); // Load local list first
      }
    } else {
      if (isMountedRef.current) {
        startTransition(() => { setCountingList([]); });
      }
    }

    if (!currentUserId || !currentWarehouseId || !isAuthenticated || !db) {
      if (isSyncing && isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
      return () => {};
    }

    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);

    const unsubscribeFirestore = subscribeToCountingList(
      currentUserId,
      currentWarehouseId,
      (productsFromFirestore) => {
        if (isMountedRef.current) {
            console.log(`[CountingList] Received ${productsFromFirestore.length} items from Firestore for ${currentWarehouseId}.`);
            startTransition(() => { setCountingList(productsFromFirestore); });
            if (localKey) setLocalStorageItem(localKey, productsFromFirestore); // Update local cache
            if (isSyncing && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
        }
      },
      (error) => {
        if (isMountedRef.current) {
            console.warn(`[CountingList] Firestore subscription error (user ${currentUserId}, warehouse ${currentWarehouseId}). Using localStorage.`, error);
            if (isSyncing && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Conteo)", description: "No se pudo conectar para la lista de conteo. Usando datos locales guardados."}));
        }
      }
    );

    return () => {
        console.log(`[CountingList] Unsubscribing for warehouse ${currentWarehouseId}`);
        unsubscribeFirestore();
        if (isMountedRef.current && isSyncing && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, toast, isAuthenticated, db, activeSection]); // Added activeSection

  const focusBarcodeIfCountingAndAuthenticated = useCallback(() => {
    if (isAuthenticated) { // Solo enfocar si está autenticado
      focusBarcodeIfCounting();
    }
  }, [isAuthenticated, focusBarcodeIfCounting]);

  const handleBarcodeScannedFromCamera = useCallback((scannedBarcode: string) => {
    if (isMountedRef.current && activeSection === 'Contador Cámara' && isActivelyScanningByButton) {
      handleAddProduct(scannedBarcode);
    }
  }, [activeSection, isActivelyScanningByButton, handleAddProduct]); // handleAddProduct is a dependency

  useEffect(() => {
    isMountedRef.current = true;
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId === LOGIN_USER) {
        setCurrentUserId(LOGIN_USER);
        setIsAuthenticated(true);
    } else {
        setCurrentUserId(null); // Ensure currentUserId is null if not authenticated
        setIsAuthenticated(false);
        if(typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
    }
    requestAnimationFrame(() => {
      if (isMountedRef.current) focusBarcodeIfCountingAndAuthenticated();
    });
    return () => {
      isMountedRef.current = false;
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
    };
  }, [focusBarcodeIfCountingAndAuthenticated]);


  // Load catalog on initial mount or when user changes
  useEffect(() => {
    if (isAuthenticated && currentUserId) { // Only load if authenticated and userId is set
      synchronizeAndLoadCatalog();
    } else {
      startTransition(() => setCatalogProducts([])); // Clear catalog if not authenticated
      if (isMountedRef.current) setIsDbLoading(false);
    }
  }, [isAuthenticated, currentUserId, synchronizeAndLoadCatalog]);


  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
    if (!warehouseId) return 'N/A';
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : `Almacén (${warehouseId.substring(0,6)}...)`;
  }, [warehouses]);

  const handleAddProduct = useCallback(async (scannedBarcode?: string) => {
    if (!isMountedRef.current) return;
    const rawBarcode = scannedBarcode ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      if(isMountedRef.current && !scannedBarcode) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "default", title: "Código vacío" }); });
      if (!scannedBarcode && barcodeInputRef.current) requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
      return;
    }
    if (!currentWarehouseId || !currentUserId) { // Check currentUserId too
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén o no hay usuario activo." }); });
        return;
    }

     if (trimmedBarcode === lastScannedBarcode && (scannedBarcode || !barcodeInputRef.current || document.activeElement !== barcodeInputRef.current)) {
         if (!scannedBarcode && barcodeInputRef.current) requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
         return;
     }
     if(isMountedRef.current) {
        if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
        setLastScannedBarcode(trimmedBarcode);
        lastScannedTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setLastScannedBarcode(null); }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }

    if(isMountedRef.current && db && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);

    let dataForFirestore: DisplayProduct;

    try {
        const barcodeToLookup = trimmedBarcode;
        console.log(`[handleAddProduct] Buscando código: "'${barcodeToLookup}'" (longitud: ${barcodeToLookup.length})`);

        let catalogProd = catalogProducts.find(cp => cp.barcode === barcodeToLookup);
        console.log(`[handleAddProduct] Resultado para '${barcodeToLookup}' desde catalogProducts (estado React):`, JSON.parse(JSON.stringify(catalogProd || {})));

        if (!catalogProd && isMountedRef.current) {
            console.log(`[handleAddProduct] Código '${barcodeToLookup}' no encontrado en estado React. Intentando IndexedDB (caché)...`);
            catalogProd = await getProductFromIndexedDB(barcodeToLookup);
            console.log(`[handleAddProduct] Resultado para '${barcodeToLookup}' desde IndexedDB (caché):`, JSON.parse(JSON.stringify(catalogProd || {})));
        }

        let baseProductData: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'count' | 'lastUpdated' | 'firestoreLastUpdated'>;
        if (catalogProd && catalogProd.barcode) {
             baseProductData = {
                description: catalogProd.description || `Producto ${trimmedBarcode}`,
                provider: catalogProd.provider || "Desconocido",
                stock: catalogProd.stock ?? 0,
                expirationDate: catalogProd.expirationDate || null,
            };
            if(!scannedBarcode) playBeep(660, 150);
        } else {
             baseProductData = {
                description: `Producto desconocido ${trimmedBarcode}`,
                provider: "Desconocido",
                stock: 0,
                expirationDate: null,
            };
            if(!scannedBarcode) playBeep(440, 300);
            if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')){
                if (isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Producto Desconocido", description: `Agregado temporalmente. Edita en 'Catálogo'.`}); });
            }
        }

        const existingProductInList = countingList.find((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);
        const currentCount = existingProductInList ? (existingProductInList.count ?? 0) + 1 : 1;

        dataForFirestore = {
            ...baseProductData,
            barcode: trimmedBarcode,
            warehouseId: currentWarehouseId,
            count: currentCount,
            lastUpdated: new Date().toISOString(),
        };

        console.log("[handleAddProduct] Objeto a enviar a setCountingListItem:", JSON.parse(JSON.stringify(dataForFirestore)));

        if (!dataForFirestore.barcode || dataForFirestore.barcode.trim() === "") {
             console.error("[handleAddProduct] Intento de guardar producto con código de barras vacío o inválido:", dataForFirestore);
             if (isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error Interno", description: "Código de barras inválido al agregar." }); });
             if (isMountedRef.current && db && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
             return;
        }

        if (currentUserId && currentWarehouseId && db) {
            await setCountingListItem(currentUserId, currentWarehouseId, dataForFirestore);
        } else if (!db && isMountedRef.current) {
            console.warn("[handleAddProduct] DB (Firestore) no disponible. Operando en modo offline para la lista de conteo.");
            let updatedOfflineList: DisplayProduct[];
            if (existingProductInList) {
                updatedOfflineList = countingList.map(p =>
                    p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId
                    ? { ...p, count: currentCount, lastUpdated: new Date().toISOString() }
                    : p
                );
            } else {
                updatedOfflineList = [...countingList, dataForFirestore].sort((a,b) => (new Date(b.lastUpdated || 0)).getTime() - (new Date(a.lastUpdated || 0)).getTime());
            }
            startTransition(() => { setCountingList(updatedOfflineList); });
            if (currentUserId && currentWarehouseId) { // Check if IDs are valid before setting localStorage
                setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, updatedOfflineList);
            }
            requestAnimationFrame(() => toast({ title: "Guardado Localmente (Offline)", description: "El cambio se guardó localmente. Se sincronizará cuando haya conexión." }));
        }
        // showDiscrepancyToastIfNeeded(dataForFirestore, currentCount); // Already handled by the listener if needed
    } catch (error: any) {
        if(!scannedBarcode) playBeep(220, 500);
        console.error("Error obteniendo o agregando producto:", error);
        if (isMountedRef.current) {
          requestAnimationFrame(() => {
            if (isMountedRef.current) {
              toast({ variant: "destructive", title: "Error de Sincronización", description: `No se pudo guardar el producto. ${error.message}` });
            }
          });
        }
    } finally {
        if (isMountedRef.current) {
             if (db && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
        }
    }

    if (!scannedBarcode && isMountedRef.current) {
        requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
    } else if (scannedBarcode && isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) {
        if (activeSection === 'Contador') requestAnimationFrame(focusBarcodeIfCounting);
    }
  }, [
    barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList,
    focusBarcodeIfCounting, activeSection, catalogProducts, db,
    setBarcode, setIsSyncing, setLastScannedBarcode, startTransition, getProductFromIndexedDB, setCountingList // State setters and DB function
  ]);


  const modifyProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar. Falta información o conexión."}));
        return;
    }

    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto "${productBarcode}" no encontrado en la lista actual.`}));
         return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    const calculatedNewValue = Math.max(0, originalValue + change);

    const needsConfirmation = type === 'count' &&
                          (productInList.stock !== undefined && productInList.stock !== 0) &&
                          calculatedNewValue > productInList.stock &&
                          originalValue <= productInList.stock;


    if (type === 'count' && needsConfirmation && !isConfirmQuantityDialogOpen) {
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
            setConfirmQuantityNewValue(calculatedNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100);
        return;
    }

    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);
    try {
        let updatedProductData: DisplayProduct;

        if (type === 'count') {
             updatedProductData = {
                ...productInList,
                count: calculatedNewValue,
                lastUpdated: new Date().toISOString(),
            };
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
            // showDiscrepancyToastIfNeeded is handled by onSnapshot implicitly
        } else { // type === 'stock'
            // This should update the MASTER catalog (IndexedDB) and then Firestore for the counting list item
            const catalogProdToUpdate = await getProductFromIndexedDB(productBarcode); // Fetch from IndexedDB
            if (catalogProdToUpdate) {
                 const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: calculatedNewValue };
                 await addOrUpdateProductToIndexedDB(updatedMasterProduct); // Update IndexedDB (master catalog)
                 await synchronizeAndLoadCatalog(); // Reload catalogProducts state from IndexedDB

                 updatedProductData = {
                    ...productInList,
                    stock: calculatedNewValue, // Reflect the change in the counting list as well
                    lastUpdated: new Date().toISOString(),
                 };
                 await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData); // Update Firestore for counting list
                 requestAnimationFrame(() => toast({ title: "Stock en Catálogo Actualizado" }));
            } else {
                 console.warn(`[modifyProductValue] Producto ${productBarcode} no encontrado en catálogo (IndexedDB) para actualizar stock.`);
                 if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no encontrado en catálogo maestro local."}));
            }
        }

    } catch (error: any) {
        console.error("Error modificando valor del producto:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current) {
             if (activeSection === 'Contador' || activeSection === 'Contador Cámara') setIsSyncing(false);
        }
    }
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
  }, [
    currentWarehouseId, currentUserId, toast, countingList, db, activeSection,
    focusBarcodeIfCounting, // catalogProducts, // Not needed here as we fetch directly from IndexedDB for stock updates
    synchronizeAndLoadCatalog,
    addOrUpdateProductToIndexedDB, // IndexedDB function
    getProductFromIndexedDB, // IndexedDB function
    isConfirmQuantityDialogOpen,
    setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction, setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen // State setters
  ]);


const handleSetProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', newValue: number, sumValue: boolean = false) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar. Falta información o conexión."}));
        return;
    }

    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Producto no encontrado en la lista actual." }));
      if(isMountedRef.current) setOpenModifyDialog(null);
      return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    if (type === 'count' && !sumValue && newValue === originalValue && !isConfirmQuantityDialogOpen) {
        if (isMountedRef.current) setOpenModifyDialog(null);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    const finalNewValue = Math.max(0, calculatedValue);

    const needsConfirmation = type === 'count' &&
                            (productInList.stock !== undefined && productInList.stock !== 0) &&
                            finalNewValue > productInList.stock &&
                            (!sumValue || originalValue <= productInList.stock);


    if (type === 'count' && needsConfirmation && !isConfirmQuantityDialogOpen) {
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction('set');
            setConfirmQuantityNewValue(finalNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100);
        return;
    }

    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);
    try {
        let updatedProductData: DisplayProduct;
        if (type === 'count') {
            updatedProductData = {
                ...productInList,
                count: finalNewValue,
                lastUpdated: new Date().toISOString(),
            };
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
        } else { // type === 'stock'
            const catalogProdToUpdate = await getProductFromIndexedDB(productBarcode); // Fetch from IndexedDB
            if (catalogProdToUpdate) {
                 const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: finalNewValue };
                 await addOrUpdateProductToIndexedDB(updatedMasterProduct); // Update IndexedDB
                 await synchronizeAndLoadCatalog(); // Reload catalogProducts state from IndexedDB

                 updatedProductData = {
                    ...productInList,
                    stock: finalNewValue, // Reflect the change in the counting list as well
                    lastUpdated: new Date().toISOString(),
                 };
                 await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
                 requestAnimationFrame(() => toast({ title: "Stock en Catálogo Actualizado" }));
            } else {
                 console.warn(`[handleSetProductValue] Producto ${productBarcode} no encontrado en catálogo (IndexedDB).`);
                 if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no encontrado en catálogo maestro local."}));
            }
        }
    } catch (error: any) {
        console.error("Error estableciendo valor del producto:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current) {
             if (activeSection === 'Contador' || activeSection === 'Contador Cámara') setIsSyncing(false);
        }
    }

    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
}, [
    toast, countingList, focusBarcodeIfCounting, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen, db, activeSection,
    synchronizeAndLoadCatalog, // catalogProducts not needed here
    addOrUpdateProductToIndexedDB, getProductFromIndexedDB, // IndexedDB functions
    setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction, setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen, setOpenModifyDialog // State setters
]);


  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, 1);
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1);
  }, [modifyProductValue]);


 const handleConfirmQuantityChange = useCallback(async () => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null || !currentUserId || !currentWarehouseId || !db) {
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
         return;
     }

     const productInList = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
     if (!productInList) {
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
         return;
     }

    const finalConfirmedCount = Math.max(0, confirmQuantityNewValue);

    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);
    try {
        const updatedProductForFirestore: DisplayProduct = {
            ...productInList,
            count: finalConfirmedCount,
            lastUpdated: new Date().toISOString(),
        };
        await setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);

    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current){
            if (activeSection === 'Contador' || activeSection === 'Contador Cámara') setIsSyncing(false);
            setIsConfirmQuantityDialogOpen(false);
            setConfirmQuantityProductBarcode(null);
            setConfirmQuantityAction(null);
            setConfirmQuantityNewValue(null);
            setOpenModifyDialog(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    currentWarehouseId, currentUserId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue,
    toast, countingList, focusBarcodeIfCounting, db, activeSection,
    setIsSyncing, setIsConfirmQuantityDialogOpen, setConfirmQuantityProductBarcode, setConfirmQuantityAction, setConfirmQuantityNewValue, setOpenModifyDialog // State setters
]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
    if(isMountedRef.current) setProductToDelete(product);
    if(isMountedRef.current) setIsDeleteDialogOpen(true);
  }, [setProductToDelete, setIsDeleteDialogOpen]);

 const confirmDelete = useCallback(async () => {
    if (!isMountedRef.current || !productToDelete || !currentUserId || !currentWarehouseId || !db) return;
    const {barcode: barcodeForToast, description: descriptionForToast } = productToDelete;

    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);
    try {
        await deleteCountingListItem(currentUserId, currentWarehouseId, barcodeForToast);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó de la lista.` }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current){
            if (activeSection === 'Contador' || activeSection === 'Contador Cámara') setIsSyncing(false);
            setIsDeleteDialogOpen(false);
            setProductToDelete(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    productToDelete, toast, focusBarcodeIfCounting, currentUserId, currentWarehouseId, db, activeSection,
    setIsSyncing, setIsDeleteDialogOpen, setProductToDelete // State setters
]);

 const handleClearCurrentList = useCallback(async () => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId || !db) return;
    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);
    try {
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Lista Borrada" }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current) {
            if (activeSection === 'Contador' || activeSection === 'Contador Cámara') setIsSyncing(false);
            setIsDeleteListDialogOpen(false);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId, db, activeSection,
    clearCountingListForWarehouseInFirestore,
    setIsSyncing, setIsDeleteListDialogOpen // State setters
  ]);

 const handleExport = useCallback(() => {
     const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
     if (currentWarehouseList.length === 0) {
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ title: "Vacío", description: "No hay productos para exportar." }); });
        return;
    }
    try {
        if (typeof Papa === 'undefined') {
            requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error Exportación", description: "PapaParse no cargada." }); });
            return;
        }

        const dataToExport = currentWarehouseList.map(p => ({
            CodigoBarras: p.barcode,
            Descripcion: p.description,
            Proveedor: p.provider || 'N/A',
            Almacen: getWarehouseName(p.warehouseId),
            StockSistema: p.stock ?? 0,
            CantidadContada: p.count ?? 0,
            Diferencia: (p.count ?? 0) - (p.stock ?? 0),
            UltimaActualizacion: p.lastUpdated ? format(new Date(p.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
            FechaVencimiento: p.expirationDate && isValid(parseISO(p.expirationDate)) ? format(parseISO(p.expirationDate), 'yyyy-MM-dd') : 'N/A',
        }));

        const csv = Papa.unparse(dataToExport, { header: true });
        const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);

        let fileName = '';
        const providersInList = new Set(currentWarehouseList.map(p => p.provider).filter(p => p && p !== "Desconocido" && p !== "N/A"));
        const providerNameForFile = providersInList.size === 1 ? Array.from(providersInList)[0] : null;
        const timestamp = format(new Date(), 'yyyyMMdd', { locale: es });

        if (providerNameForFile) {
             const sanitizedProvider = providerNameForFile.replace(/[^a-zA-Z0-9]/g, '_');
             fileName = `conteo_${sanitizedProvider}_${timestamp}.csv`;
        } else {
             const warehouseName = getWarehouseName(currentWarehouseId).replace(/[^a-zA-Z0-9]/g, '_');
             fileName = `conteo_${warehouseName}_${timestamp}.csv`;
        }

        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ title: "Exportado" }); });
    } catch (error) {
        console.error("Error exportando inventario:", error);
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error Exportación" }); });
    }
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
 }, [countingList, currentWarehouseId, toast, getWarehouseName, focusBarcodeIfCounting]);


 const handleRefreshStock = useCallback(async () => {
    if (!currentUserId || !currentWarehouseId || !isMountedRef.current || !db) {
        requestAnimationFrame(() => toast({ title: "Error", description: "No se puede actualizar stock. Falta ID de usuario, almacén o conexión."}));
        return;
    }
    if (!catalogProducts || catalogProducts.length === 0) { // Use catalogProducts from state
        requestAnimationFrame(() => toast({ title: "Catálogo Vacío", description: "Carga el catálogo primero o asegúrate de que esté sincronizado." }));
        return;
    }
    if(isMountedRef.current) { setIsRefreshingStock(true); setIsSyncing(true); }
    let updatedProductCount = 0;

    try {
        const currentWarehouseItems = countingList.filter(item => item.warehouseId === currentWarehouseId);
        const productsToUpdateInFirestore: DisplayProduct[] = [];

        currentWarehouseItems.forEach(countingProduct => {
            const catalogProd = catalogProducts.find(cp => cp.barcode === countingProduct.barcode); // Find in state catalogProducts
            if (catalogProd) {
                if (countingProduct.description !== catalogProd.description ||
                    countingProduct.provider !== catalogProd.provider ||
                    countingProduct.stock !== (catalogProd.stock ?? 0) ||
                    countingProduct.expirationDate !== (catalogProd.expirationDate || null)
                   )
                {
                    updatedProductCount++;
                    const updatedItem: DisplayProduct = {
                        ...countingProduct,
                        description: catalogProd.description,
                        provider: catalogProd.provider,
                        stock: catalogProd.stock ?? 0,
                        expirationDate: catalogProd.expirationDate || null,
                        lastUpdated: new Date().toISOString(),
                    };
                    productsToUpdateInFirestore.push(updatedItem);
                }
            }
        });

        if (productsToUpdateInFirestore.length > 0 && db) {
            const batch = writeBatch(db);
            productsToUpdateInFirestore.forEach(itemToUpdate => {
                if (!itemToUpdate.barcode) return;
                const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), itemToUpdate.barcode);
                const { barcode, warehouseId, ...dataToSet } = itemToUpdate;
                // firestoreLastUpdated is handled by setCountingListItem if needed
                batch.set(docRef, dataToSet, { merge: true });
            });
            await batch.commit();
        }

        if(updatedProductCount > 0 && isMountedRef.current) {
            requestAnimationFrame(() => {
                 toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) en la lista.` });
            });
        } else if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Los productos en la lista ya están actualizados con el catálogo." }));
        }
    } catch (error: any) {
         if (!isMountedRef.current) return;
         requestAnimationFrame(() => {
           if (isMountedRef.current) {
             toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar la lista de conteo: ${error.message}` });
           }
         });
    } finally {
         if (isMountedRef.current) { setIsRefreshingStock(false); setIsSyncing(false); }
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId, countingList, catalogProducts, db,
    setIsRefreshingStock, setIsSyncing // State setters
]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
    if(isMountedRef.current) setOpenModifyDialog({ type, product });
 }, [setOpenModifyDialog]);

 const handleCloseModifyDialog = () => {
    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
 };


  // --- Catalog CRUD (IndexedDB as master) ---
  const handleAddOrUpdateCatalogProduct = useCallback(async (productData: ProductDetail) => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    // setIsSyncing(true); // Not syncing to Firestore for catalog
    setProcessingStatus("Guardando en catálogo local...");
    try {
        await addOrUpdateProductToIndexedDB(productData); // To IndexedDB
        await synchronizeAndLoadCatalog(); // This will refresh catalogProducts state from IndexedDB
        requestAnimationFrame(() => toast({ title: "Producto Guardado en Catálogo Local" }));
        if(isMountedRef.current) { setProcessingStatus("Producto guardado."); setIsEditDetailDialogOpen(false); setProductToEditDetail(null); }
    } catch (error: any) {
        if (isMountedRef.current) {
            setProcessingStatus(`Error al guardar en catálogo local: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: `No se pudo guardar: ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); /* setIsSyncing(false); */ setProcessingStatus("");}
    }
  }, [toast, synchronizeAndLoadCatalog, addOrUpdateProductToIndexedDB,
      setIsDbLoading, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail // State setters
  ]);

  const handleDeleteCatalogProduct = useCallback(async (barcodeToDelete: string) => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    // setIsSyncing(true); // Not syncing to Firestore for catalog
    setProcessingStatus("Eliminando de catálogo local...");
    try {
        await deleteProductFromIndexedDB(barcodeToDelete); // From IndexedDB
        await synchronizeAndLoadCatalog(); // Refresh catalogProducts
        requestAnimationFrame(() => toast({ title: "Producto Eliminado del Catálogo Local" }));
        if(isMountedRef.current) { setProcessingStatus("Producto eliminado."); setIsEditDetailDialogOpen(false); setProductToEditDetail(null); }
    } catch (error: any) {
        if (isMountedRef.current) {
            setProcessingStatus(`Error al eliminar del catálogo local: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar Local", description: `No se pudo eliminar: ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); /* setIsSyncing(false); */ setProcessingStatus("");}
    }
  }, [toast, synchronizeAndLoadCatalog, deleteProductFromIndexedDB,
      setIsDbLoading, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail // State setters
  ]);


 const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    // setIsSyncing(true); // Not syncing to Firestore
    setProcessingStatus("Borrando catálogo local...");
    try {
      await clearProductDatabase(); // From IndexedDB
      await synchronizeAndLoadCatalog(); // Refresh catalogProducts (will be empty)
      requestAnimationFrame(() => toast({ title: "Catálogo Local Borrado" }));
      if(isMountedRef.current) setProcessingStatus("Catálogo local borrado.");
    } catch (error: any) {
      if(isMountedRef.current) {
          setProcessingStatus(`Error al borrar catálogo local: ${error.message}`);
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo Local", description: error.message }));
      }
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); /* setIsSyncing(false); */ setIsClearCatalogConfirmOpen(false); setProcessingStatus(""); }
    }
  }, [toast, synchronizeAndLoadCatalog, clearProductDatabase,
      setIsDbLoading, setProcessingStatus, setIsClearCatalogConfirmOpen // State setters
  ]);


 const handleGoogleSheetLoadToCatalog = useCallback(async (sheetUrlOrId: string) => {
    if (!isMountedRef.current) return;
    if (!sheetUrlOrId) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido" }));
      return;
    }
    if (isMountedRef.current) {
        setIsDbLoading(true);
        // setIsSyncing(true); // Not syncing to Firestore
        setProcessingStatus("Cargando desde Google Sheet a catálogo local...");
    }
    try {
      const productsFromSheet = await fetchGoogleSheetData(sheetUrlOrId);
      if (productsFromSheet.length > 0) {
        await addProductsToIndexedDB(productsFromSheet); // To IndexedDB
        await synchronizeAndLoadCatalog(); // Refresh catalogProducts state from IndexedDB
        if (isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({ title: "Catálogo Local Actualizado desde Google Sheet", description: `${productsFromSheet.length} productos cargados/actualizados.` });
            });
            setProcessingStatus("Carga desde Google Sheet a local completa.");
        }
      } else {
        if (isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({ title: "Sin Productos", description: "No se encontraron productos en la Hoja de Google." });
            });
            setProcessingStatus("No se encontraron productos en la Hoja de Google.");
        }
      }
    } catch (error: any) {
      console.error("[handleGoogleSheetLoadToCatalog] Error:", error);
      if (isMountedRef.current) {
        requestAnimationFrame(() => {
            toast({ variant: "destructive", title: "Error de Carga GS (Local)", description: error.message || "Error desconocido." });
        });
        setProcessingStatus(`Error al cargar desde GS a local: ${error.message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        // setIsSyncing(false);
        setProcessingStatus("");
      }
    }
  }, [
    toast, synchronizeAndLoadCatalog, addProductsToIndexedDB,
    setIsDbLoading, setProcessingStatus // State setters
  ]);


 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct | ProductDetail) => {
    if (!product || !product.barcode || !isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede editar. Falta información." }));
        return;
    }
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        let productDataToEdit = catalogProducts.find(cp => cp.barcode === product.barcode);

        if (!productDataToEdit) {
            console.log(`[handleOpenEditDetailDialog] Producto '${product.barcode}' no en estado. Intentando IndexedDB...`);
            productDataToEdit = await getProductFromIndexedDB(product.barcode);
        }

        if (productDataToEdit) {
            startTransition(() => setProductToEditDetail(productDataToEdit));
        } else {
            const placeholderDetail: ProductDetail = {
                 barcode: product.barcode,
                 description: product.description || `Producto ${product.barcode}`,
                 provider: product.provider || "Desconocido",
                 stock: 'stock' in product ? (product.stock ?? 0) : 0,
                 expirationDate: 'expirationDate' in product ? (product.expirationDate || null) : null,
            };
            startTransition(() => setProductToEditDetail(placeholderDetail));
            if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Agregando Nuevo Producto al Catálogo Local", description: "Este producto se agregará al catálogo local." }));
        }
        if (isMountedRef.current) setIsEditDetailDialogOpen(true);
    } catch (error: any) {
         if (!isMountedRef.current) return;
         console.error("Error obteniendo detalles del producto para editar:", error);
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: `No se pudo cargar detalle del producto: ${error.message}` }));
    } finally {
         if (isMountedRef.current) setIsDbLoading(false);
    }
 }, [
    toast, catalogProducts, getProductFromIndexedDB,
    setIsDbLoading, setProductToEditDetail, setIsEditDetailDialogOpen // State setters
]);


 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
    if (!isMountedRef.current || !productToEditDetail) return;
    await handleAddOrUpdateCatalogProduct({ ...productToEditDetail, ...data });
 }, [handleAddOrUpdateCatalogProduct, productToEditDetail]);


 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Falta información o conexión para iniciar conteo por proveedor." }));
      return;
    }
    if (!productsToCount || productsToCount.length === 0) {
        requestAnimationFrame(() => toast({ title: "Vacío", description: "No hay productos para este proveedor." }));
        return;
    }

    if(isMountedRef.current) { setIsSyncing(true); setProcessingStatus("Iniciando conteo por proveedor..."); }
    try {
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);

        const batch = writeBatch(db);
        productsToCount.forEach(dbProduct => {
            if (!dbProduct || !dbProduct.barcode) return; // Skip if product or barcode is invalid
            const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), dbProduct.barcode);
            const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'lastUpdated' | 'firestoreLastUpdated'> = {
               description: dbProduct.description || `Producto ${dbProduct.barcode}`,
               provider: dbProduct.provider || "Desconocido",
               stock: dbProduct.stock ?? 0,
               expirationDate: dbProduct.expirationDate || null,
               count: 0, // Start count at 0
            };
            // No serverTimestamp here for DisplayProduct as it's handled by setCountingListItem
            batch.set(docRef, dataToSet);
        });
        await batch.commit();

        if (isMountedRef.current) {
            setActiveSection("Contador");
            requestAnimationFrame(() => {
                if (isMountedRef.current) setSearchTerm("");
            });
            requestAnimationFrame(() => toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para contar.` }));
            setProcessingStatus("Conteo por proveedor iniciado.");
        }
    } catch (error: any) {
        console.error("Error iniciando conteo por proveedor:", error);
        if (isMountedRef.current) {
            setProcessingStatus(`Error al iniciar conteo: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: `No se pudo iniciar el conteo por proveedor. ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsSyncing(false); setProcessingStatus(""); }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [
    toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, currentUserId, db,
    clearCountingListForWarehouseInFirestore,
    setIsSyncing, setProcessingStatus, setSearchTerm // State setters
  ]);


  const filteredCountingList = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    let listToFilter = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (showOnlyDiscrepancies) {
      listToFilter = listToFilter.filter(product => (product.count ?? 0) !== (product.stock ?? 0));
    }

    if (!lowerSearchTerm) return listToFilter;
    return listToFilter.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) ||
      (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
      (product.expirationDate || '').includes(lowerSearchTerm)
    );
  }, [countingList, searchTerm, currentWarehouseId, showOnlyDiscrepancies]);

  const handleSectionChange = useCallback((newSection: string) => {
    if(isMountedRef.current) {
      startTransition(() => {
        setActiveSection(newSection);
      });
      if (newSection === 'Contador') {
        requestAnimationFrame(focusBarcodeIfCounting);
      }
       if (newSection === 'Contador Cámara') {
        setIsCameraScanMode(true);
      } else {
        setIsCameraScanMode(false);
      }
    }
  }, [setActiveSection, focusBarcodeIfCounting, setIsCameraScanMode, startTransition]); // Added startTransition

  const toggleShowOnlyDiscrepancies = useCallback(() => {
    setShowOnlyDiscrepancies(prev => !prev);
  }, [setShowOnlyDiscrepancies]);


   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             startTransition(() => {
                setCurrentWarehouseId(newWarehouseId);
                requestAnimationFrame(() => {
                    if (isMountedRef.current) setSearchTerm("");
                });
             });
             if (currentUserId) {
                 setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newWarehouseId);
             }
         }
   }, [
    currentWarehouseId, currentUserId, setCurrentWarehouseId, setSearchTerm, startTransition // Added dependencies
  ]);

    const handleAddWarehouse = useCallback(async (name: string) => {
      if (!isMountedRef.current || !currentUserId || !name.trim() || !db) {
          requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede agregar el almacén. Falta información o conexión.' }));
          return;
      }
      const generatedId = `wh_${format(new Date(), 'yyyyMMdd_HHmmssSSS')}`;
      const newWarehouse: Warehouse = { id: generatedId, name: name.trim().toUpperCase() };

      const isDuplicateName = warehouses.some(warehouse => warehouse.name.toLowerCase() === newWarehouse.name.toLowerCase());
      if (isDuplicateName) {
          requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'El nombre del almacén ya existe.' }));
          return;
      }
      if(isMountedRef.current) setIsSyncing(true);
      try {
          await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
          requestAnimationFrame(() => toast({ title: "Almacén Agregado" }));
      } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo agregar el almacén: ${error.message}` }));
      } finally {
          if(isMountedRef.current) setIsSyncing(false);
      }
    }, [
        warehouses, currentUserId, toast, db,
        addOrUpdateWarehouseInFirestore, setIsSyncing // Added dependencies
    ]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) {
            requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede actualizar el almacén. Falta información o conexión.' }));
            return;
       }
       if(isMountedRef.current) setIsSyncing(true);
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, { ...warehouseToUpdate, name: warehouseToUpdate.name.toUpperCase() });
           requestAnimationFrame(() => toast({ title: "Almacén Actualizado" }));
       } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo actualizar el almacén: ${error.message}` }));
       } finally {
            if(isMountedRef.current) setIsSyncing(false);
       }
   }, [
    toast, currentUserId, db,
    addOrUpdateWarehouseInFirestore, setIsSyncing // Added dependencies
  ]);

   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
    if (!isMountedRef.current || !currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede eliminar el almacén. Falta información o conexión.' }));
        return;
    }
    if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
      requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Operación no permitida', description: "El Almacén Principal no se puede eliminar." }));
      return;
    }
    if(isMountedRef.current) setIsSyncing(true);
    try {
      await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
      requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
      // Logic to switch currentWarehouseId if the active one was deleted is handled by the Firestore listener
    } catch (error: any) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo eliminar el almacén.` }));
    } finally {
      if(isMountedRef.current) setIsSyncing(false);
    }
  }, [
    toast, currentUserId, db,
    deleteWarehouseFromFirestore, setIsSyncing // Added dependencies
  ]);


   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        const currentItemInList = countingList.find(p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId);
        if (!currentItemInList) {
            return type === 'stock' ? (openModifyDialog.product.stock ?? 0) : (openModifyDialog.product.count ?? 0);
        }
        return type === 'stock' ? (currentItemInList.stock ?? 0) : (currentItemInList.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]);


  const sectionItems = useMemo(() => [
    { name: 'Contador', icon: ClipboardList, label: `Contador (${getWarehouseName(currentWarehouseId)})`},
    { name: 'Contador Cámara', icon: Camera, label: 'Contador con Cámara' },
    { name: 'Catálogo de Productos', icon: PackageSearch, label: 'Catálogo de Productos' },
    { name: 'Almacenes', icon: Boxes, label: 'Almacenes' },
    { name: 'Consolidado', icon: Library, label: 'Consolidado de Inventario' },
  ], [getWarehouseName, currentWarehouseId]);

  const handleSignOut = () => {
    if(isMountedRef.current) {
        setIsAuthenticated(false);
        const userIdToClear = currentUserId || LOGIN_USER;
        setCurrentUserId(null);
        if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
            // Clear user-specific localStorage items
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${userIdToClear}`) ||
                    (key.startsWith(LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX) && key.includes(`_${userIdToClear}`)) ||
                    key.startsWith(`${LOCAL_STORAGE_WAREHOUSE_LIST_KEY_PREFIX}${userIdToClear}`)
                    ) {
                    localStorage.removeItem(key);
                }
            });
        }
        startTransition(() => {
            setCountingList([]);
            setCatalogProducts([]);
            setWarehouses([{ id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME }]);
            setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
            setActiveSection('Contador');
        });
        setIsInitialFetchDoneForUserWarehouses(false); // Reset flag for next login
        requestAnimationFrame(() => toast({title: "Sesión cerrada"}));
    }
  };

  const sidebarProps = {
    isMobileView: isMobile,
    isCollapsed: isSidebarCollapsed,
    activeSection,
    sectionItems,
    currentUserId,
    warehouses,
    currentWarehouseId,
    handleWarehouseChange,
    getWarehouseName,
    onSectionChange: (section: string) => {
      handleSectionChange(section);
      if (isMobile && mobileSheetOpen) setMobileSheetOpen(false);
    },
    onToggleCollapse: () => setIsSidebarCollapsed(!isSidebarCollapsed),
    onSignOut: handleSignOut,
  };


  const handleLogin = () => {
    if (loginUsername === LOGIN_USER && loginPassword === LOGIN_PASSWORD) {
        if (isMountedRef.current) {
            setCurrentUserId(LOGIN_USER);
            setIsAuthenticated(true);
            setIsInitialFetchDoneForUserWarehouses(false); // Reset flag for this new "session"
            setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, LOGIN_USER);
            requestAnimationFrame(() => toast({ title: "Inicio de sesión exitoso" }));
            setLoginUsername("");
            setLoginPassword("");
        }
    } else {
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Credenciales Incorrectas", description: "Usuario o contraseña no válidos." }));
        setLoginPassword("");
    }
  };

  const [isEditWarehouseDialogOpen, setIsEditWarehouseDialogOpen] = useState(false);
  const [warehouseToEdit, setWarehouseToEdit] = useState<Warehouse | null>(null);


  if (!isAuthenticated) {
    return (
        <div className="login-container">
            <div className="login-form">
                <div className="flex flex-col items-center mb-6">
                    <LockKeyhole className="h-12 w-12 text-primary mb-3" />
                    <h2 className="text-2xl font-bold text-center text-foreground">Iniciar Sesión</h2>
                </div>
                <div className="space-y-4">
                    <div>
                        <Label htmlFor="username">Usuario</Label>
                        <Input
                            id="username"
                            type="text"
                            placeholder="Nombre de usuario"
                            value={loginUsername}
                            onChange={(e) => setLoginUsername(e.target.value)}
                            className="mt-1"
                        />
                    </div>
                    <div>
                        <Label htmlFor="password">Contraseña</Label>
                        <Input
                            id="password"
                            type="password"
                            placeholder="Contraseña"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            className="mt-1"
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                        />
                    </div>
                    <Button onClick={handleLogin} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                        Ingresar
                    </Button>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <div
        className={cn(
          "fixed top-0 left-0 w-full h-1 z-[60] transition-all duration-300 ease-in-out",
          isSyncing ? "animate-syncing-pulse-colors" : "bg-muted/30"
        )}
        title={isSyncing ? "Sincronizando con la nube..." : "Conectado"}
      />

      {isMobile ? (
        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="fixed top-2 left-2 z-50 md:hidden bg-card/80 backdrop-blur-sm">
              <MenuIcon className="h-5 w-5" />
              <span className="sr-only">Abrir menú</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0 bg-sidebar text-sidebar-foreground">
             <SheetHeader className="p-4 border-b border-sidebar-border">
                <SheetTitle className="text-xl font-bold">StockCounter Pro</SheetTitle>
             </SheetHeader>
            <SidebarLayout {...sidebarProps} />
          </SheetContent>
        </Sheet>
      ) : (
        <aside className={cn(
            "flex-shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300 ease-in-out pt-1",
            isSidebarCollapsed ? "w-16" : "w-64"
        )}>
          <SidebarLayout {...sidebarProps} />
        </aside>
      )}


      <main className="flex-1 p-4 md:p-6 overflow-y-auto relative pt-5">
        {activeSection === 'Contador' && currentUserId && (
            <div id="contador-content-wrapper" className="space-y-4 h-full flex flex-col">
                <div className="mb-4 space-y-4">
                    <BarcodeEntry
                        barcode={barcode}
                        setBarcode={setBarcode}
                        onAddProduct={handleAddProduct}
                        onRefreshStock={handleRefreshStock}
                        isLoading={isDbLoading || isTransitionPending}
                        isRefreshingStock={isRefreshingStock}
                        inputRef={barcodeInputRef}
                    />
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Buscar en lista actual por descripción, código o proveedor..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full rounded-md bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 pl-8 shadow-sm"
                            aria-label="Buscar en lista actual"
                        />
                        {searchTerm && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setSearchTerm("")}
                                aria-label="Limpiar búsqueda"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
                <div className="flex-1 overflow-hidden">
                  <CountingListTable
                      countingList={filteredCountingList}
                      warehouseName={getWarehouseName(currentWarehouseId)}
                      isLoading={isDbLoading || isTransitionPending}
                      onDeleteRequest={handleDeleteRequest}
                      onOpenStockDialog={(product) => handleOpenModifyDialog(product, 'stock')}
                      onOpenQuantityDialog={(product) => handleOpenModifyDialog(product, 'count')}
                      onDecrement={handleDecrement}
                      onIncrement={handleIncrement}
                      onEditDetailRequest={handleOpenEditDetailDialog}
                  />
                </div>
                 <div className="mt-auto flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 pt-4">
                 <Button
                    onClick={toggleShowOnlyDiscrepancies}
                    variant="outline"
                    className="flex items-center gap-1 w-full sm:w-auto"
                    disabled={isDbLoading || isTransitionPending}
                    title={showOnlyDiscrepancies ? "Mostrar todos los productos" : "Mostrar solo productos con diferencias"}
                  >
                    <Filter className="h-4 w-4" /> {showOnlyDiscrepancies ? "Mostrar Todo" : "Solo Diferencias"}
                  </Button>
                 {isMobile ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full">
                        <MoreVertical className="h-4 w-4 mr-2" />
                        <span>Acciones</span>
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[calc(100vw-4rem)] sm:w-56">
                    <DropdownMenuItem
                        onSelect={handleExport}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                    >
                        <Download className="h-4 w-4 mr-2" /> Exportar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => {
                        if (countingList.filter(p => p.warehouseId === currentWarehouseId).length > 0) {
                            setIsDeleteListDialogOpen(true);
                        } else {
                            requestAnimationFrame(() => toast({ title: "Vacío", description: "La lista actual ya está vacía." }));
                        }
                        }}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                        className="text-destructive focus:text-destructive dark:focus:text-red-400"
                    >
                        <Trash className="h-4 w-4 mr-2" /> Borrar Lista
                    </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                ) : (
                <>
                    <Button
                    onClick={handleExport}
                    disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                    variant="outline"
                    className="flex items-center gap-1 w-full sm:w-auto"
                    >
                    <Download className="h-4 w-4" /> Exportar
                    </Button>
                    <Button
                    onClick={() => {
                        if (countingList.filter(p => p.warehouseId === currentWarehouseId).length > 0) {
                        setIsDeleteListDialogOpen(true);
                        } else {
                        requestAnimationFrame(() => toast({ title: "Vacío", description: "La lista actual ya está vacía." }));
                        }
                    }}
                    disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                    variant="destructive"
                    className="flex items-center gap-1 w-full sm:w-auto"
                    >
                    <Trash className="h-4 w-4" /> Borrar Lista
                    </Button>
                </>
                )}
            </div>
            </div>
        )}

        {activeSection === 'Contador Cámara' && currentUserId && (
          <div id="contador-camara-content" className="flex flex-col h-full space-y-2">
            <div className="h-2/5 md:h-1/2 border rounded-lg overflow-hidden relative bg-black">
                <BarcodeScannerCamera
                    onBarcodeScanned={handleBarcodeScannedFromCamera}
                    isScanningActive={activeSection === 'Contador Cámara'}
                    isDecodingActive={isActivelyScanningByButton}
                />
                {isCameraScanMode && !isActivelyScanningByButton && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm z-10 p-4 text-center">
                        <ScanLine className="h-12 w-12 text-primary mb-3" />
                        <p className="text-white text-lg font-semibold">Escaneo Pausado</p>
                        <p className="text-muted-foreground text-sm">Mantén presionado el botón de abajo para escanear.</p>
                    </div>
                )}
            </div>
            {isCameraScanMode && (
                 <Button
                    onMouseDown={handleScanButtonPress}
                    onMouseUp={handleScanButtonRelease}
                    onTouchStart={handleScanButtonPress}
                    onTouchEnd={handleScanButtonRelease}
                    variant="secondary"
                    className="w-full py-3 text-lg font-semibold"
                    title="Mantener presionado para escanear"
                >
                    <Scan className="mr-2 h-6 w-6"/> Escanear
                </Button>
            )}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-1">
                <Button
                    onClick={handleRefreshStock}
                    variant="outline"
                    className="h-10 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 flex-grow sm:flex-none"
                    disabled={isDbLoading || isRefreshingStock || isTransitionPending}
                >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingStock ? 'animate-spin' : ''}`} /> Actualizar Stock
                </Button>
                <div className="relative flex-grow">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Buscar en lista..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full rounded-md bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 pl-8 shadow-sm"
                    />
                     {searchTerm && (
                        <Button variant="ghost" size="icon" className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 p-0" onClick={() => setSearchTerm("")}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                <CountingListTable
                    countingList={filteredCountingList}
                    warehouseName={getWarehouseName(currentWarehouseId)}
                    isLoading={isDbLoading || isTransitionPending}
                    onDeleteRequest={handleDeleteRequest}
                    onOpenStockDialog={(product) => handleOpenModifyDialog(product, 'stock')}
                    onOpenQuantityDialog={(product) => handleOpenModifyDialog(product, 'count')}
                    onDecrement={handleDecrement}
                    onIncrement={handleIncrement}
                    onEditDetailRequest={handleOpenEditDetailDialog}
                />
            </div>
            <div className="mt-auto flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 pt-2">
                 {isMobile ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full">
                        <MoreVertical className="h-4 w-4 mr-2" />
                        <span>Acciones</span>
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[calc(100vw-4rem)] sm:w-56">
                    <DropdownMenuItem
                        onSelect={handleExport}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                    >
                        <Download className="h-4 w-4 mr-2" /> Exportar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={() => {
                        if (countingList.filter(p => p.warehouseId === currentWarehouseId).length > 0) {
                            setIsDeleteListDialogOpen(true);
                        } else {
                            requestAnimationFrame(() => toast({ title: "Vacío", description: "La lista actual ya está vacía." }));
                        }
                        }}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                        className="text-destructive focus:text-destructive dark:focus:text-red-400"
                    >
                        <Trash className="h-4 w-4 mr-2" /> Borrar Lista
                    </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                ) : (
                <>
                    <Button
                    onClick={handleExport}
                    disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                    variant="outline"
                    className="flex items-center gap-1 w-full sm:w-auto"
                    >
                    <Download className="h-4 w-4" /> Exportar
                    </Button>
                    <Button
                    onClick={() => {
                        if (countingList.filter(p => p.warehouseId === currentWarehouseId).length > 0) {
                        setIsDeleteListDialogOpen(true);
                        } else {
                        requestAnimationFrame(() => toast({ title: "Vacío", description: "La lista actual ya está vacía." }));
                        }
                    }}
                    disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}
                    variant="destructive"
                    className="flex items-center gap-1 w-full sm:w-auto"
                    >
                    <Trash className="h-4 w-4" /> Borrar Lista
                    </Button>
                </>
                )}
            </div>
          </div>
        )}

         {activeSection === 'Catálogo de Productos' && isAuthenticated && currentUserId && (
            <div id="database-content">
               <ProductDatabaseComponent
                  userId={currentUserId}
                  catalogProducts={catalogProducts}
                  isLoadingCatalog={isDbLoading}
                  processingStatus={processingStatus}
                  setProcessingStatus={setProcessingStatus}
                  onLoadFromGoogleSheet={handleGoogleSheetLoadToCatalog}
                  onAddOrUpdateProduct={handleAddOrUpdateCatalogProduct}
                  onDeleteProduct={handleDeleteCatalogProduct}
                  onClearCatalogRequest={() => setIsClearCatalogConfirmOpen(true)}
                  onStartCountByProvider={handleStartCountByProvider}
                  onEditProductRequest={handleOpenEditDetailDialog}
               />
            </div>
         )}

          {activeSection === 'Almacenes' && currentUserId && (
             <div id="warehouses-content">
                 <WarehouseManagement
                    warehouses={warehouses}
                    currentWarehouseId={currentWarehouseId}
                    onAddWarehouse={handleAddWarehouse}
                    onUpdateWarehouse={handleUpdateWarehouse}
                    onDeleteWarehouse={handleDeleteWarehouse}
                    onSelectWarehouse={handleWarehouseChange}
                    isLoading={isSyncing || isTransitionPending}
                 />
             </div>
           )}
           {activeSection === 'Consolidado' && currentUserId && (
             <div id="consolidated-report-content" className="h-full">
                <ConsolidatedView
                    catalogProducts={catalogProducts}
                    warehouses={warehouses}
                    currentUserId={currentUserId}
                />
             </div>
            )}
      </main>

      <ModifyValueDialog
          isOpen={!!openModifyDialog}
          setIsOpen={(open) => { if(!open) handleCloseModifyDialog()}}
          type={openModifyDialog?.type || 'count'}
          product={openModifyDialog?.product || null}
          warehouseName={getWarehouseName(currentWarehouseId)}
          currentValue={getCurrentValueForDialog(openModifyDialog?.type || 'count')}
          onIncrement={handleIncrement}
          onDecrement={handleDecrement}
          onSet={handleSetProductValue}
          onClose={handleCloseModifyDialog}
          isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
          isOpen={isConfirmQuantityDialogOpen}
          onOpenChange={(open) => {
            if(isMountedRef.current) setIsConfirmQuantityDialogOpen(open);
            if (!open) { if(isMountedRef.current){ setConfirmQuantityProductBarcode(null); setConfirmQuantityAction(null); setConfirmQuantityNewValue(null); } requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }
          }}
          title="Confirmar Modificación"
          description={
             (() => {
               if (confirmQuantityNewValue === null || !confirmQuantityProductBarcode) return "¿Continuar con la modificación?";
               const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
               const stock = product?.stock ?? 0;
               const description = product?.description ?? confirmQuantityProductBarcode;
                if (stock > 0 && confirmQuantityNewValue > stock && (product?.count ?? 0) <= stock) {
                   return `La cantidad contada (${confirmQuantityNewValue}) ahora SUPERA el stock del sistema (${stock}) para "${description}". ¿Confirmar?`;
               }
                return `Está a punto de modificar la cantidad contada para "${description}" a ${confirmQuantityNewValue}. ¿Continuar?`;
             })()
          }
          onConfirm={handleConfirmQuantityChange}
          onCancel={() => { if(isMountedRef.current){ setIsConfirmQuantityDialogOpen(false); setConfirmQuantityProductBarcode(null); setConfirmQuantityAction(null); setConfirmQuantityNewValue(null); } requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
          isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
         isOpen={isDeleteDialogOpen}
         onOpenChange={(open) => { if(isMountedRef.current) setIsDeleteDialogOpen(open); if (!open) { if(isMountedRef.current) setProductToDelete(null); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
         title="Confirmar Eliminación"
         description={ productToDelete ? `¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) de la lista actual?` : `¿Seguro que deseas eliminar este producto?`}
         onConfirm={confirmDelete}
         onCancel={() => { if(isMountedRef.current) setIsDeleteDialogOpen(false); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
         isDestructive={true}
         isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => { if(isMountedRef.current) setIsDeleteListDialogOpen(open); if (!open) { requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})?`}
          onConfirm={handleClearCurrentList}
          onCancel={() => { if(isMountedRef.current) setIsDeleteListDialogOpen(false); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
          isDestructive={true}
          isProcessing={isTransitionPending || isSyncing}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(open); if (!open) { requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
            title="Confirmar Borrado Catálogo"
            description={
                 <div className="space-y-2">
                    <div className="flex items-center gap-2 text-destructive">
                         <AlertTriangle className="h-5 w-5"/>
                         <span className="font-semibold">¡Acción Irreversible!</span>
                    </div>
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos del catálogo. Esta acción no se puede deshacer.</p>
                 </div>
            }
            confirmText="Sí, Borrar Catálogo"
            onConfirm={handleClearCatalog}
            onCancel={() => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(false); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
            isDestructive={true}
            isProcessing={isDbLoading || isTransitionPending || isSyncing}
        />

      {productToEditDetail && (
        <EditProductDialog
          isOpen={isEditDetailDialogOpen}
          setIsOpen={(open) => {
            if(isMountedRef.current) setIsEditDetailDialogOpen(open);
            if (!open) {
              if(isMountedRef.current) setProductToEditDetail(null);
              requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
            }
          }}
          selectedDetail={productToEditDetail}
          onSubmit={handleEditDetailSubmit}
          onDelete={handleDeleteCatalogProduct}
          isProcessing={isDbLoading || isTransitionPending || isSyncing}
          context="database"
        />
      )}

      {warehouseToEdit && (
        <EditWarehouseDialog
          isOpen={isEditWarehouseDialogOpen}
          setIsOpen={(open) => {
              if(!isMountedRef.current) return;
              setIsEditWarehouseDialogOpen(open);
              if(!open) setWarehouseToEdit(null);
          }}
          warehouse={warehouseToEdit}
          onSave={handleUpdateWarehouse}
          isProcessing={isSyncing}
        />
      )}
    </div>
  );
}

    