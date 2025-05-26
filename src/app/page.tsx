
// src/app/page.tsx
"use client";

import type { DisplayProduct, ProductDetail, Warehouse } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem, debounce } from "@/lib/utils";
import {
    AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle as UIDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductDatabase } from "@/components/product-database";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
import { WarehouseManagement } from "@/components/warehouse-management";
import { EditWarehouseDialog } from "@/components/edit-warehouse-dialog";
import { ConsolidatedView } from '@/components/consolidated-view';

import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock,
  BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide,
  LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert,
  Filter, Download, Edit, Camera, Library, X, Check
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo, useTransition } from "react";
import { playBeep } from '@/lib/helpers';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { EditProductDialog } from '@/components/edit-product-dialog';

// IndexedDB functions
import {
  getProductFromDB as getProductFromIndexedDB,
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  clearProductDatabase as clearProductDatabaseInIndexedDB, // Renamed for clarity
  addProductsToDB as addProductsToIndexedDB, // Renamed for clarity
} from '@/lib/database'; // Using IndexedDB for product catalog and local history

// Firestore functions
import {
  subscribeToWarehouses,
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  setCountingListItem, // For countingList sync with Firestore
  deleteCountingListItem, // For countingList sync
  clearCountingListForWarehouseInFirestore, // For countingList sync
  subscribeToCountingList, // For countingList sync
  getAllProductsFromCatalog, // For catalog sync (Firestore)
  addOrUpdateProductInCatalog, // For catalog sync (Firestore)
  deleteProductFromCatalog, // For catalog sync (Firestore)
  addProductsToCatalog, // For catalog sync (Firestore)
  clearProductCatalogInFirestore, // For catalog sync (Firestore)
} from '@/lib/firestore-service';
import { SidebarLayout } from '@/components/sidebar-layout';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from '@/hooks/use-mobile';
import { CounterSection } from '@/components/counter-section';
import { useLocalStorage } from '@/hooks/use-local-storage';
// import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera'; // Temporarily removed

import {
    LOCAL_STORAGE_USER_ID_KEY,
    LOCAL_STORAGE_ACTIVE_SECTION_KEY,
    LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY,
    LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX,
    LOGIN_USER,
    LOGIN_PASSWORD,
    LAST_SCANNED_BARCODE_TIMEOUT_MS,
    LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX,
    DEFAULT_WAREHOUSE_ID,
    DEFAULT_WAREHOUSE_NAME,
  } from '@/lib/constants';
import { writeBatch, doc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Papa from 'papaparse';


const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
];

// Helper function to extract Spreadsheet ID and GID from URL or ID string
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

// Function to fetch and parse Google Sheet data
async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);

    if (!spreadsheetId) {
        console.warn("Could not extract spreadsheet ID from input:", sheetUrlOrId);
        throw new Error("URL/ID de Hoja de Google inválido. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }

    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log(`Fetching Google Sheet data from: ${csvExportUrl}`);

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
        throw new Error(userMessage);
    }

    if (!response.ok) {
        const status = response.status;
        const statusText = response.statusText;
        let errorBody = "No se pudo leer el cuerpo del error.";
        try { errorBody = await response.text(); } catch { /* no-op */ }

        let userMessage = `Error ${status} al obtener datos. `;
        if (status === 400) userMessage += "Solicitud incorrecta. Verifique la URL y el GID de la hoja.";
        else if (status === 403) userMessage += "Acceso denegado. Asegúrese de que la hoja de cálculo tenga permisos de 'cualquiera con el enlace puede ver'.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL/ID y el ID de la hoja (gid).";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL/ID. Detalle del servidor: ${errorBody.substring(0, 200)}`;
        
        console.error("Google Sheet fetch error details:", { status, statusText, errorBody, csvExportUrl });
        throw new Error(userMessage);
    }

    const csvText = await response.text();

    return new Promise((resolve, reject) => {
        if (typeof Papa === 'undefined') {
            reject(new Error("La librería PapaParse (Papa) no está cargada."));
            return;
        }

        Papa.parse<string[]>(csvText, {
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length > 0) {
                     results.errors.forEach(err => console.warn(`PapaParse error: ${err.message} on row ${err.row}. Code: ${err.code}. Type: ${err.type}`));
                }
                const csvData = results.data;
                const products: ProductDetail[] = [];

                if (csvData.length <= 1) { 
                    resolve(products);
                    return;
                }
                
                const BARCODE_COLUMN_INDEX = 0;
                const DESCRIPTION_COLUMN_INDEX = 1;
                const EXPIRATION_DATE_COLUMN_INDEX = 2; 
                const STOCK_COLUMN_INDEX = 5;
                const PROVIDER_COLUMN_INDEX = 9;

                for (let i = 1; i < csvData.length; i++) { 
                    const values = csvData[i];
                    if (!values || values.length === 0 || values.every(v => !v?.trim())) continue; 

                    const barcode = values[BARCODE_COLUMN_INDEX]?.trim();
                    if (!barcode) { 
                        console.warn(`Fila ${i + 1} omitida: Código de barras vacío o faltante.`);
                        continue;
                    }

                    const description = values[DESCRIPTION_COLUMN_INDEX]?.trim();
                    const stockStr = values[STOCK_COLUMN_INDEX]?.trim();
                    const provider = values[PROVIDER_COLUMN_INDEX]?.trim();
                    const expirationDateStr = values[EXPIRATION_DATE_COLUMN_INDEX]?.trim();

                    const finalDescription = description || `Producto ${barcode}`; 
                    const finalProvider = provider || "Desconocido"; 

                    let stock = 0;
                    if (stockStr) {
                        const parsedStock = parseInt(stockStr, 10);
                        if (!isNaN(parsedStock) && parsedStock >= 0) {
                            stock = parsedStock;
                        } else {
                             console.warn(`Valor de stock inválido "${stockStr}" para código ${barcode} en fila ${i + 1}. Usando 0.`);
                        }
                    }
                    
                    const expirationDate: string | null = expirationDateStr ? expirationDateStr : null;

                    products.push({ barcode, description: finalDescription, provider: finalProvider, stock, expirationDate });
                }
                resolve(products);
            },
            error: (error: any) => {
                reject(new Error(`Error al analizar el archivo CSV: ${error.message}`));
            }
        });
    });
}


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
  const [currentUserId, setCurrentUserId] = useLocalStorage<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
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
  const [processingStatus, setProcessingStatus] = useState<string>(""); // For Google Sheet load status

  // --- Warehouse State ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  
  // --- Product Catalog State (from Firestore, cached in IndexedDB) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]);

  // --- Counting List State ---
  const [barcode, setBarcode] = useState("");
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState(""); 
  const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);
  const [openModifyDialog, setOpenModifyDialog] = useState<{ type: 'count' | 'stock', product: DisplayProduct | null } | null>(null);
  const [isConfirmQuantityDialogOpen, setIsConfirmQuantityDialogOpen] = useState(false);
  const [confirmQuantityAction, setConfirmQuantityAction] = useState<'increment' | 'decrement' | 'set' | null>(null);
  const [confirmQuantityProductBarcode, setConfirmQuantityProductBarcode] = useState<string | null>(null);
  const [confirmQuantityNewValue, setConfirmQuantityNewValue] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleteListDialogOpen, setIsDeleteListDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  
  // --- Edit Product Dialog State (for catalog) ---
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
  const [isClearCatalogConfirmOpen, setIsClearCatalogConfirmOpen] = useState(false);

  // --- Refs for managing initial data fetches ---
  const isInitialFetchDoneForUserWarehouses = useRef<Record<string, boolean>>({});

  const toggleShowOnlyDiscrepancies = useCallback(() => {
    setShowOnlyDiscrepancies(prev => !prev);
  }, [setShowOnlyDiscrepancies]);


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

  // --- Lifecycle: Mount/Unmount ---
  useEffect(() => {
    isMountedRef.current = true;
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId === LOGIN_USER) { 
        setCurrentUserId(LOGIN_USER); // For UI display
        setIsAuthenticated(true);
    } else {
        setCurrentUserId(null);
        setIsAuthenticated(false);
        if(typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY); 
    }

    requestAnimationFrame(() => {
      if (isMountedRef.current) focusBarcodeIfCounting();
    });

    return () => {
      isMountedRef.current = false;
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
    };
  }, [focusBarcodeIfCounting, setCurrentUserId]); // Added setCurrentUserId


  // --- Hybrid Catalog Management (Firestore as master, IndexedDB as cache) ---
  const synchronizeAndLoadCatalog = useCallback(async () => {
    if (!currentUserId || !isMountedRef.current || !db) { // Added db check
        console.warn("[SyncCatalog] Skipping: No currentUserId, component not mounted, or Firestore DB not initialized.");
        setIsDbLoading(false);
        return;
    }
    console.log("[SyncCatalog] Starting catalog synchronization for user:", currentUserId);
    setIsDbLoading(true);
    try {
        console.log("[SyncCatalog] Attempting to fetch catalog from Firestore for user:", currentUserId);
        const firestoreProducts = await getAllProductsFromCatalog(currentUserId);
        
        if (isMountedRef.current) {
            console.log(`[SyncCatalog] Fetched ${firestoreProducts.length} products from Firestore.`);
            console.log("[SyncCatalog] First 5 Firestore products (if any):", firestoreProducts.slice(0, 5).map(p => ({b: p.barcode, d:p.description})));

            await clearProductDatabaseInIndexedDB(); // Clear local cache
            await addProductsToIndexedDB(firestoreProducts); // Populate local cache with Firestore data
            
            const sortedFirestoreProducts = firestoreProducts
                .filter(p => p && p.barcode)
                .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
            setCatalogProducts(sortedFirestoreProducts);

            requestAnimationFrame(() => toast({ title: "Catálogo Sincronizado", description: "El catálogo local se actualizó desde la nube."}));
        }
    } catch (error: any) {
        console.error("[SyncCatalog] Error fetching catalog from Firestore, loading from local IndexedDB:", error.message, error.stack);
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Catálogo)", description: "Usando catálogo local. No se pudo conectar a la nube."}));
            try {
                const localProducts = await getAllProductsFromIndexedDB();
                console.log(`[SyncCatalog] Fetched ${localProducts.length} products from IndexedDB.`);
                console.log("[SyncCatalog] First 5 IndexedDB products (if any):", localProducts.slice(0, 5).map(p => ({b: p.barcode, d:p.description})));
                
                const sortedLocalProducts = localProducts
                    .filter(p => p && p.barcode)
                    .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
                setCatalogProducts(sortedLocalProducts);
            } catch (indexedDbError: any) {
                console.error("[SyncCatalog] Critical error: Failed to load catalog from IndexedDB as fallback:", indexedDbError.message, indexedDbError.stack);
                setCatalogProducts([]);
                 requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo cargar el catálogo local."}));
            }
        }
    } finally {
        if (isMountedRef.current) setIsDbLoading(false);
        console.log("[SyncCatalog] Catalog synchronization finished.");
    }
  }, [currentUserId, toast]); // Removed setCatalogProducts from deps

  useEffect(() => {
    if (currentUserId && isAuthenticated) { // Only sync if authenticated
      synchronizeAndLoadCatalog();
    } else {
      setCatalogProducts([]); // Clear catalog if no user or not authenticated
      setIsDbLoading(false); 
    }
  }, [currentUserId, isAuthenticated, synchronizeAndLoadCatalog]);


  // --- Warehouse Management (Firestore as master) ---
  useEffect(() => {
    if (!currentUserId || !db) {
        console.warn("[Warehouses] Skipping Firestore subscription: No currentUserId or Firestore DB not initialized.");
        if (isMountedRef.current) {
            const localDefaultWarehouses = [...PREDEFINED_WAREHOUSES_LIST];
            setWarehouses(localDefaultWarehouses);
            const storedWarehouseId = currentUserId ? getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
            setCurrentWarehouseId(localDefaultWarehouses.some(w => w.id === storedWarehouseId) ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
        }
        return;
    }

    console.log("[Warehouses] Subscribing to warehouses for user:", currentUserId);
    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehouses) => {
        if (!isMountedRef.current) return;
        
        let finalWarehousesToSet = [...fetchedWarehouses];
        
        if (!isInitialFetchDoneForUserWarehouses.current[currentUserId!] && db && currentUserId) {
            isInitialFetchDoneForUserWarehouses.current[currentUserId!] = true; // Mark as done for this user in this session
            const warehousesToAddBatch: Warehouse[] = [];
            
            PREDEFINED_WAREHOUSES_LIST.forEach(predefined => {
                if (!fetchedWarehouses.some(fw => fw.id === predefined.id)) {
                    warehousesToAddBatch.push(predefined);
                }
            });

            if (warehousesToAddBatch.length > 0) {
                console.log("[Warehouses] Adding predefined warehouses to Firestore:", warehousesToAddBatch.map(w=>w.name));
                setIsSyncing(true);
                try {
                    const batch = writeBatch(db);
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                    console.log("[Warehouses] Predefined warehouses added successfully.");
                    // Firestore listener will pick up these changes and update finalWarehousesToSet
                } catch (err) {
                    console.error(`[Warehouses] Failed to add predefined warehouses for user ${currentUserId}:`, err);
                    if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                    // If batch fails, manually merge for UI consistency in this session
                    finalWarehousesToSet = [...fetchedWarehouses, ...warehousesToAddBatch].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
                } finally {
                    if(isMountedRef.current) setIsSyncing(false);
                }
            }
        }
        
        // If after everything, finalWarehousesToSet is empty (e.g., Firestore error, or new user and batch failed),
        // ensure at least the default list is shown for UI operation.
        if (finalWarehousesToSet.length === 0) {
            finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST];
            console.warn("[Warehouses] No warehouses fetched or created in Firestore, using local predefined list for UI.");
        }
        
        setWarehouses(finalWarehousesToSet);
        const storedWarehouseIdKey = `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId!}`;
        const storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
        
        let currentSelectionIsValid = finalWarehousesToSet.some(w => w.id === storedWarehouseId);

        if (!currentSelectionIsValid) {
            const mainExistsInFinalList = finalWarehousesToSet.find(w => w.id === DEFAULT_WAREHOUSE_ID);
            const newCurrentId = mainExistsInFinalList ? DEFAULT_WAREHOUSE_ID : (finalWarehousesToSet[0]?.id || DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(newCurrentId);
            setLocalStorageItem(storedWarehouseIdKey, newCurrentId);
            console.log(`[Warehouses] Current warehouse selection '${storedWarehouseId}' invalid, changed to '${newCurrentId}'.`);
        } else {
            setCurrentWarehouseId(storedWarehouseId);
        }
    }, (error) => { // Firestore subscription error callback
        console.error("[Warehouses] Firestore subscription error:", error);
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Red (Almacenes)", description: "No se pudo conectar para obtener almacenes."}));
            const localDefaultWarehouses = [...PREDEFINED_WAREHOUSES_LIST];
            setWarehouses(localDefaultWarehouses);
            const storedWarehouseId = currentUserId ? getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
            setCurrentWarehouseId(localDefaultWarehouses.some(w => w.id === storedWarehouseId) ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
        }
    });
    return () => {
        console.log("[Warehouses] Unsubscribing from warehouses for user:", currentUserId);
        unsubscribe();
    };
  }, [currentUserId, toast]); // Removed setCurrentWarehouseId, setWarehouses as they are updated by the callback

  // --- Counting List (Firestore as master, localStorage as fallback/quick load) ---
  useEffect(() => {
    if (!currentUserId || !currentWarehouseId || !db) {
        console.warn(`[CountingList] Skipping Firestore subscription: No currentUserId ('${currentUserId}'), currentWarehouseId ('${currentWarehouseId}'), or Firestore DB not initialized.`);
        const localKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId || 'anonymous'}`;
        const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
        if (isMountedRef.current) {
           startTransition(() => {
             setCountingList(localList); // Always show full local list for the key
           });
        }
        return () => {};
    }

    console.log(`[CountingList] Subscribing to counting list for user '${currentUserId}', warehouse '${currentWarehouseId}'.`);
    setIsSyncing(true); // Indicate sync start before subscription
    const unsubscribeFirestore = subscribeToCountingList(currentUserId, currentWarehouseId, 
      (productsFromFirestore) => { // Success callback
        if (isMountedRef.current) {
            startTransition(() => {
                setCountingList(productsFromFirestore);
            });
            const localKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
            setLocalStorageItem(localKey, productsFromFirestore); // Update localStorage cache
            console.log(`[CountingList] Received ${productsFromFirestore.length} items from Firestore for warehouse '${currentWarehouseId}'.`);
            if(isSyncing) setIsSyncing(false); // Sync complete
        }
      }, 
      () => { // Error callback for subscribeToCountingList
        if (isMountedRef.current) {
            console.warn(`[CountingList] Firestore subscription error for warehouse '${currentWarehouseId}'. Loading from localStorage.`);
            setIsSyncing(false); 
            const localKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
            const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
             startTransition(() => {
                setCountingList(localList);
             });
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Conteo)", description: "Usando lista de conteo local."}));
        }
      }
    );

    return () => {
        console.log(`[CountingList] Unsubscribing from counting list for warehouse '${currentWarehouseId}'.`);
        unsubscribeFirestore();
        if (isMountedRef.current && isSyncing) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, toast, isSyncing]);


  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
    if (!warehouseId) return 'N/A';
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : `Almacén (${warehouseId.substring(0,6)}...)`;
  }, [warehouses]);

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


 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    if (!isMountedRef.current) return;
    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "default", title: "Código vacío" }); });
      requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
      return;
    }
    if (!currentWarehouseId || !currentUserId) {
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén o no hay usuario activo." }); });
        return;
    }

     if (trimmedBarcode === lastScannedBarcode) {
         requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
         return;
     }
     if(isMountedRef.current) {
        if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
        setLastScannedBarcode(trimmedBarcode);
        lastScannedTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setLastScannedBarcode(null); }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }

    const existingProductInList = countingList.find((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);
    
    setIsSyncing(true);
    try {
        let productDataForFirestore: DisplayProduct;
        if (existingProductInList) {
            const newCount = (existingProductInList.count ?? 0) + 1;
            productDataForFirestore = {
                ...existingProductInList,
                count: newCount,
                lastUpdated: new Date().toISOString(),
            };
            playBeep(880, 100);
        } else {
            let newProductForList: DisplayProduct;
            const barcodeToLookup = trimmedBarcode;
            console.log(`[handleAddProduct] Buscando código: "'${barcodeToLookup}'" (longitud: ${barcodeToLookup.length})`);
            
            let catalogProd = catalogProducts.find(cp => cp.barcode === barcodeToLookup);
            if (!catalogProd && isMountedRef.current) { // Fallback to IndexedDB if not in state
                console.log(`[handleAddProduct] No encontrado en estado catalogProducts (Firestore cache), buscando en IndexedDB como fallback...`);
                catalogProd = await getProductFromIndexedDB(barcodeToLookup);
            }
            console.log(`[handleAddProduct] Resultado de búsqueda de catálogo para '${barcodeToLookup}':`, JSON.parse(JSON.stringify(catalogProd || {})));

            if (catalogProd && catalogProd.barcode) {
                newProductForList = {
                    barcode: catalogProd.barcode,
                    description: catalogProd.description || `Producto ${catalogProd.barcode}`,
                    provider: catalogProd.provider || "Desconocido",
                    stock: catalogProd.stock ?? 0,
                    expirationDate: catalogProd.expirationDate || null,
                    warehouseId: currentWarehouseId,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(660, 150);
            } else {
                newProductForList = {
                    barcode: trimmedBarcode,
                    description: `Producto desconocido ${trimmedBarcode}`,
                    provider: "Desconocido",
                    warehouseId: currentWarehouseId,
                    stock: 0,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                    expirationDate: null,
                };
                playBeep(440, 300);
                if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')){
                    requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Producto Desconocido", description: `Agregado temporalmente. Edita en 'Catálogo'.`}); });
                }
            }
            productDataForFirestore = newProductForList;
        }
        await setCountingListItem(currentUserId, currentWarehouseId, productDataForFirestore);
        // UI se actualiza via onSnapshot
    } catch (error) {
        console.error("Error adding/updating product in Firestore counting list:", error);
        playBeep(440, 300);
        if (isMountedRef.current) {
          requestAnimationFrame(() => {
            if (isMountedRef.current) {
              toast({ variant: "destructive", title: "Error de Sincronización", description: "No se pudo guardar el producto en la nube." });
            }
          });
        }
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
    }

    requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
  }, [barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, catalogProducts, focusBarcodeIfCounting, activeSection, getProductFromIndexedDB]);


 const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;

    const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
    if (!productInList) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto no encontrado.`}));
         return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    const calculatedNewValue = Math.max(0, originalValue + change);
    const needsConfirmation = type === 'count' && productInList.stock !== undefined && calculatedNewValue > productInList.stock && originalValue <= productInList.stock;

    if (needsConfirmation && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) {
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
            setConfirmQuantityNewValue(calculatedNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100);
        return; 
    }
    
    setIsSyncing(true);
    try {
        if (type === 'count') {
            const updatedProductForFirestore: DisplayProduct = {
                ...productInList,
                count: calculatedNewValue,
                lastUpdated: new Date().toISOString()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
        } else if (type === 'stock') {
            // Modifying stock here now means modifying it in the Firestore Catalog
            const masterProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
            if (masterProduct) {
                const updatedMasterProduct: ProductDetail = { ...masterProduct, stock: calculatedNewValue };
                await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); // Update Firestore Catalog
                // No direct IndexedDB update here, synchronizeAndLoadCatalog will handle it
                await synchronizeAndLoadCatalog(); // Refresh catalog state and IndexedDB cache
                
                // Also update the stock in the current counting list item if it's there
                const updatedCountingItem: DisplayProduct = { ...productInList, stock: calculatedNewValue, lastUpdated: new Date().toISOString() };
                await setCountingListItem(currentUserId, currentWarehouseId, updatedCountingItem); // Update counting list item in Firestore
                requestAnimationFrame(() => toast({ title: "Stock Actualizado en Catálogo" }));
            } else {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "Producto no encontrado en catálogo maestro para actualizar stock."}));
            }
        }
    } catch (error) {
        console.error("Error modifying product value:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
    }
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
  }, [currentWarehouseId, currentUserId, toast, countingList, catalogProducts, focusBarcodeIfCounting, activeSection, synchronizeAndLoadCatalog]);


const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
    if (!productInList) return;

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    if (type === 'count' && !sumValue && newValue === originalValue && !isConfirmQuantityDialogOpen) {
        if(isMountedRef.current) setOpenModifyDialog(null);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    const finalNewValue = Math.max(0, calculatedValue);
    const needsConfirmation = type === 'count' && productInList.stock !== undefined && finalNewValue > productInList.stock && (!sumValue || originalValue <= productInList.stock);

    if (needsConfirmation && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) {
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction('set');
            setConfirmQuantityNewValue(finalNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100);
        return; 
    }
    
    setIsSyncing(true);
    try {
        if (type === 'count') {
            const updatedProductForFirestore: DisplayProduct = {
                ...productInList,
                count: finalNewValue,
                lastUpdated: new Date().toISOString()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
        } else if (type === 'stock') {
             // Modifying stock here now means modifying it in the Firestore Catalog
            const masterProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
            if (masterProduct) {
                const updatedMasterProduct: ProductDetail = { ...masterProduct, stock: finalNewValue };
                await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); // Update Firestore Catalog
                await synchronizeAndLoadCatalog(); // Refresh catalog state and IndexedDB cache

                // Also update the stock in the current counting list item if it's there
                const updatedCountingItem: DisplayProduct = { ...productInList, stock: finalNewValue, lastUpdated: new Date().toISOString() };
                await setCountingListItem(currentUserId, currentWarehouseId, updatedCountingItem); // Update counting list item in Firestore
                requestAnimationFrame(() => toast({ title: "Stock Actualizado en Catálogo" }));
            } else {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "Producto no en catálogo maestro."}));
            }
        }
    } catch (error) {
        console.error("Error setting product value:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
    }

    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
}, [toast, countingList, catalogProducts, focusBarcodeIfCounting, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen, activeSection, synchronizeAndLoadCatalog]);


  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, 1);
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1);
  }, [modifyProductValue]);


 const handleConfirmQuantityChange = useCallback(async () => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null || !currentUserId || !currentWarehouseId) {
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
    const updatedProductForFirestore: DisplayProduct = {
        ...productInList,
        count: finalConfirmedCount,
        lastUpdated: new Date().toISOString()
    };

    setIsSyncing(true);
    try {
        await setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
    } catch (error) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
    } finally {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsConfirmQuantityDialogOpen(false);
            setConfirmQuantityProductBarcode(null);
            setConfirmQuantityAction(null);
            setConfirmQuantityNewValue(null);
            setOpenModifyDialog(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [currentWarehouseId, currentUserId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, countingList, focusBarcodeIfCounting]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
    if(isMountedRef.current) setProductToDelete(product);
    if(isMountedRef.current) setIsDeleteDialogOpen(true);
  }, []);

 const confirmDelete = useCallback(async () => {
    if (!isMountedRef.current || !productToDelete || !currentUserId || !currentWarehouseId) return;
    const {barcode: barcodeForToast, description: descriptionForToast, warehouseId: warehouseIdForToast} = productToDelete;
    
    setIsSyncing(true);
    try {
        await deleteCountingListItem(currentUserId, currentWarehouseId, barcodeForToast);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" se eliminó de ${getWarehouseName(warehouseIdForToast)}.` }));
    } catch (error) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
    } finally {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsDeleteDialogOpen(false);
            setProductToDelete(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [productToDelete, toast, focusBarcodeIfCounting, currentUserId, currentWarehouseId, getWarehouseName]);

 const handleClearCurrentList = useCallback(async () => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return;
    setIsSyncing(true);
    try {
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Lista Borrada" }));
    } catch (error) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
    } finally {
        if(isMountedRef.current) {
            setIsSyncing(false);
            setIsDeleteListDialogOpen(false);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId]);

 const handleExport = useCallback(() => {
     const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
     if (currentWarehouseList.length === 0) {
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ title: "Vacío", description: "No hay productos para exportar." }); });
        return;
    }
    try {
        if (typeof Papa === 'undefined') {
            requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error de Exportación", description: "La librería PapaParse no está cargada." }); });
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
        console.error("Error exporting inventory:", error);
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error de Exportación" }); });
    }
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
 }, [countingList, currentWarehouseId, toast, getWarehouseName, focusBarcodeIfCounting]);


 const handleRefreshStock = useCallback(async () => {
    if (!currentWarehouseId || !isMountedRef.current || !currentUserId || !db) return;
    if (!catalogProducts || catalogProducts.length === 0) {
        requestAnimationFrame(() => toast({ title: "Catálogo Vacío", description: "No hay productos en el catálogo para referenciar." }));
        return;
    }
    setIsRefreshingStock(true);
    setIsSyncing(true);
    let updatedProductCount = 0;
    const productsToUpdateInFirestore: DisplayProduct[] = [];

    try {
        const currentWarehouseItems = countingList.filter(item => item.warehouseId === currentWarehouseId);
        currentWarehouseItems.forEach(countingProduct => {
            const catalogProd = catalogProducts.find(cp => cp.barcode === countingProduct.barcode);
            if (catalogProd) {
                if (countingProduct.description !== catalogProd.description ||
                    countingProduct.provider !== catalogProd.provider ||
                    countingProduct.stock !== (catalogProd.stock ?? 0) ||
                    countingProduct.expirationDate !== (catalogProd.expirationDate || null)
                   )
                {
                    updatedProductCount++;
                    productsToUpdateInFirestore.push({
                        ...countingProduct, // Mantiene la cantidad contada
                        description: catalogProd.description,
                        provider: catalogProd.provider,
                        stock: catalogProd.stock ?? 0,
                        expirationDate: catalogProd.expirationDate || null,
                        lastUpdated: new Date().toISOString(),
                    });
                }
            }
        });
        
        if (productsToUpdateInFirestore.length > 0) {
            const batch = writeBatch(db); 
            productsToUpdateInFirestore.forEach(prod => {
                const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), prod.barcode);
                const { barcode, warehouseId, ...dataToSet } = prod; 
                batch.set(docRef, dataToSet, { merge: true }); // merge:true es importante para no sobrescribir firestoreLastUpdated si no se incluye
            });
            await batch.commit();
        }
        if(updatedProductCount > 0) {
            requestAnimationFrame(() => toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) en la lista.` }));
        } else {
            requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Los productos en la lista ya están actualizados." }));
        }
    } catch (error) {
         console.error(`Error refreshing stock for warehouse ${currentWarehouseId}:`, error);
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Actualizar" }));
    } finally {
         if (isMountedRef.current) { setIsRefreshingStock(false); setIsSyncing(false); }
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId, countingList, catalogProducts]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
    if(isMountedRef.current) setOpenModifyDialog({ type, product });
 }, []);

 const handleCloseModifyDialog = () => {
    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
 };


 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct | ProductDetail) => {
    if (!product || !product.barcode || !isMountedRef.current || !currentUserId) return;
    setIsDbLoading(true);
    try {
        // Prioritize data from Firestore cache (catalogProducts state)
        let productDataToEdit = catalogProducts.find(p => p.barcode === product.barcode);
        if (!productDataToEdit) {
            console.log(`[EditDetail] Producto ${product.barcode} no encontrado en estado (Firestore catalog), buscando en IndexedDB como fallback...`);
            productDataToEdit = await getProductFromIndexedDB(product.barcode);
        }

        if (productDataToEdit) {
            setProductToEditDetail(productDataToEdit);
        } else {
            // If still not found, create a placeholder from the counting list item or a new blank item
            const placeholderDetail: ProductDetail = {
                 barcode: product.barcode,
                 description: product.description || `Producto ${product.barcode}`,
                 provider: product.provider || "Desconocido",
                 stock: 'stock' in product ? (product.stock ?? 0) : 0, // Use stock from counting list if available
                 expirationDate: 'expirationDate' in product ? product.expirationDate : null,
            };
            setProductToEditDetail(placeholderDetail);
            requestAnimationFrame(() => toast({ variant: "default", title: "Agregando Nuevo Producto", description: "Este producto se agregará al catálogo maestro." }));
        }
        setIsEditDetailDialogOpen(true);
    } catch (error: any) {
         if (!isMountedRef.current) return;
         console.error("Error fetching product details for edit:", error);
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo cargar detalle: ${error.message}` }));
    } finally {
         if (isMountedRef.current) setIsDbLoading(false);
    }
 }, [toast, currentUserId, catalogProducts, getProductFromIndexedDB]);


 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
    if (!isMountedRef.current || !productToEditDetail || !currentUserId) return;
    setIsDbLoading(true);
    setIsSyncing(true);
    try {
        const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, 
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || null,
        };
        await addOrUpdateProductInCatalog(currentUserId, updatedProductData); // Save to Firestore Catalog
        // synchronizeAndLoadCatalog will handle updating IndexedDB cache and catalogProducts state
        await synchronizeAndLoadCatalog(); 

        // Also, update the item in the current counting list if it exists there
        const productInCountingList = countingList.find(p => p.barcode === updatedProductData.barcode && p.warehouseId === currentWarehouseId);
        if (productInCountingList) {
            const updatedCountingItem: DisplayProduct = {
                ...productInCountingList,
                description: updatedProductData.description,
                provider: updatedProductData.provider,
                stock: updatedProductData.stock ?? 0,
                expirationDate: updatedProductData.expirationDate,
                lastUpdated: new Date().toISOString()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, updatedCountingItem); // Update in Firestore counting list
        }
        
        requestAnimationFrame(() => toast({ title: "Producto Actualizado en Catálogo" }));
        if(isMountedRef.current){ setIsEditDetailDialogOpen(false); setProductToEditDetail(null); }
    } catch (error: any) {
         if (!isMountedRef.current) return;
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Actualizar Catálogo", description: `No se pudo actualizar: ${error.message}` }));
    } finally {
         if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); }
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [toast, productToEditDetail, focusBarcodeIfCounting, currentUserId, countingList, currentWarehouseId, synchronizeAndLoadCatalog]);


 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) return;
    if (!productsToCount || productsToCount.length === 0) {
        requestAnimationFrame(() => toast({ title: "Vacío", description: "No hay productos para este proveedor." }));
        return;
    }
    const productsWithWarehouseContext: DisplayProduct[] = productsToCount.map(dbProduct => ({
       barcode: dbProduct.barcode,
       description: dbProduct.description,
       provider: dbProduct.provider,
       stock: dbProduct.stock ?? 0,
       expirationDate: dbProduct.expirationDate || null,
       warehouseId: currentWarehouseId,
       count: 0, 
       lastUpdated: new Date().toISOString(),
    }));

    setIsSyncing(true);
    try {
        // Clear existing list in Firestore for this warehouse first
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        
        const batch = writeBatch(db);
        productsWithWarehouseContext.forEach(prod => {
            const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), prod.barcode);
            const { barcode, warehouseId, ...dataToSet } = prod; 
            batch.set(docRef, dataToSet); 
        });
        await batch.commit();

        if (isMountedRef.current) {
            setActiveSection("Contador");
            setSearchTerm(""); // Clear search term when starting a new count
            requestAnimationFrame(() => toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` }));
        }
    } catch (error) {
        console.error("Error starting count by provider:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: "No se pudo iniciar el conteo por proveedor." }));
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, currentUserId]);


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
      setActiveSection(newSection);
    }
  }, [setActiveSection]);


   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             startTransition(() => {
                setCurrentWarehouseId(newWarehouseId);
                setSearchTerm(""); // Clear search term when changing warehouse
             });
             if (currentUserId) {
                 setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newWarehouseId);
             }
         }
   }, [currentWarehouseId, startTransition, currentUserId]);

    const handleAddWarehouse = useCallback(async (name: string) => {
      if (!isMountedRef.current || !currentUserId || !name.trim() || !db) return;
      const generatedId = `wh_${format(new Date(), 'yyyyMMdd_HHmmssSSS')}`;
      const newWarehouse: Warehouse = { id: generatedId, name: name.trim() };
      const isDuplicateName = warehouses.some(warehouse => warehouse.name.toLowerCase() === newWarehouse.name.toLowerCase());
      if (isDuplicateName) {
          requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'Nombre de almacén ya existe.' }));
          return;
      }
      setIsSyncing(true);
      try {
          await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
          requestAnimationFrame(() => toast({title: "Almacén Agregado", description: `Cambiado a: ${newWarehouse.name}`}));
          handleWarehouseChange(newWarehouse.id); 
      } catch (error) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo agregar el almacén.' }));
      } finally {
          if(isMountedRef.current) setIsSyncing(false);
      }
    }, [warehouses, currentUserId, handleWarehouseChange, toast]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) return;
       setIsSyncing(true);
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, warehouseToUpdate);
           requestAnimationFrame(() => toast({ title: `Almacén "${warehouseToUpdate.name}" Actualizado` }));
       } catch (error) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo actualizar el almacén.' }));
       } finally {
            if(isMountedRef.current) setIsSyncing(false);
       }
   }, [toast, currentUserId]);

   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
    if (!isMountedRef.current || !currentUserId || !db || warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
      if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
        requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Operación no permitida', description: "Almacén Principal no se puede eliminar." }));
      }
      return;
    }
    setIsSyncing(true);
    try {
      await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
      // The onSnapshot listener for warehouses will handle UI update and currentWarehouseId adjustment
      requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
    } catch (error) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo eliminar el almacén.' }));
    } finally {
      if(isMountedRef.current) setIsSyncing(false);
    }
  }, [toast, currentUserId]);


   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        const currentItem = countingList.find(
          p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId
        );
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]);

   const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current || !currentUserId) return;
    setIsDbLoading(true);
    setIsSyncing(true);
    try {
      await clearProductCatalogInFirestore(currentUserId); // Clear Firestore Catalog
      await synchronizeAndLoadCatalog(); // This will clear IndexedDB and reload catalogProducts state
      requestAnimationFrame(() => toast({ title: "Catálogo Borrado" }));
    } catch (error: any) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: `No se pudieron borrar datos: ${error.message}` }));
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); setIsClearCatalogConfirmOpen(false); setIsSyncing(false); }
      requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [toast, currentUserId, focusBarcodeIfCounting, synchronizeAndLoadCatalog]);


  const sectionItems = useMemo(() => [
    { name: 'Contador', icon: ClipboardList, label: `Contador (${getWarehouseName(currentWarehouseId)})`},
    { name: 'Catálogo de Productos', icon: PackageSearch, label: 'Catálogo de Productos' },
    { name: 'Almacenes', icon: Boxes, label: 'Almacenes' },
    { name: 'Consolidado', icon: Library, label: 'Consolidado de Inventario' },
  ], [getWarehouseName, currentWarehouseId]);

  const handleSignOut = () => {
    if(isMountedRef.current) {
        setIsAuthenticated(false);
        setCurrentUserId(null); 
        setCountingList([]);
        setCatalogProducts([]); 
        setWarehouses(PREDEFINED_WAREHOUSES_LIST); 
        setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
        if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
            // Clear current warehouse ID for anonymous/logged out state
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX)) {
                    localStorage.removeItem(key);
                }
            });
        }
        isInitialFetchDoneForUserWarehouses.current = {}; // Reset initial fetch flags
        requestAnimationFrame(() => toast({title: "Sesión cerrada"}));
    }
  };

  const sidebarProps = {
    isMobileView: isMobile,
    isCollapsed: isSidebarCollapsed,
    activeSection,
    sectionItems,
    currentUserId: currentUserId || "", 
    warehouses,
    currentWarehouseId,
    handleWarehouseChange,
    getWarehouseName,
    onSectionChange: (section: string) => {
      handleSectionChange(section);
      if (isMobile) setMobileSheetOpen(false);
    },
    onToggleCollapse: () => setIsSidebarCollapsed(!isSidebarCollapsed),
    onSignOut: handleSignOut,
  };


  const handleLogin = () => {
    if (loginUsername === LOGIN_USER && loginPassword === LOGIN_PASSWORD) {
        if (isMountedRef.current) {
            setCurrentUserId(LOGIN_USER); 
            setIsAuthenticated(true);
            setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, LOGIN_USER);
            isInitialFetchDoneForUserWarehouses.current[LOGIN_USER] = false; // Reset for new login
            requestAnimationFrame(() => toast({ title: "Inicio de sesión exitoso" }));
            setLoginUsername("");
            setLoginPassword("");
        }
    } else {
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de inicio de sesión" }));
        setLoginPassword("");
    }
  };


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
                        <label htmlFor="username" className="block text-sm font-medium text-foreground">Usuario</label>
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
                        <label htmlFor="password" className="block text-sm font-medium text-foreground">Contraseña</label>
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
    <div className="flex flex-col md:flex-row h-screen bg-background text-foreground">
      <div className="md:hidden p-4 border-b flex items-center justify-between bg-sidebar sticky top-0 z-20">
        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Abrir menú">
              <MenuIcon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[280px] sm:w-[320px] bg-sidebar flex flex-col">
             <SheetHeader className="sr-only"><SheetTitle>Menú Principal</SheetTitle></SheetHeader>
            <SidebarLayout {...sidebarProps} />
          </SheetContent>
        </Sheet>
        <h2 className="text-xl font-bold truncate ml-4">StockCounter Pro</h2>
        <div className="w-8"></div> 
      </div>

      <aside className={cn(
        "hidden md:flex flex-shrink-0 border-r bg-sidebar flex-col transition-all duration-300 ease-in-out",
        isSidebarCollapsed ? "w-20" : "w-60 lg:w-64" 
      )}>
        <SidebarLayout {...sidebarProps} />
      </aside>

      <main className="flex-1 p-4 md:p-6 overflow-y-auto relative"> 
         {isSyncing && (
          <div className="absolute top-4 right-4 p-2 z-50" title="Sincronizando con la nube...">
            <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />
          </div>
        )}

        {activeSection === 'Contador' && currentUserId && (
          <div id="contador-content" className="space-y-4 h-full flex flex-col">
             <div className="flex items-center gap-2 mb-4">
              <div className="flex-grow">
                <BarcodeEntry
                    barcode={barcode}
                    setBarcode={setBarcode}
                    onAddProduct={handleAddProduct}
                    onRefreshStock={handleRefreshStock}
                    isLoading={isDbLoading || isTransitionPending}
                    isRefreshingStock={isRefreshingStock}
                    inputRef={barcodeInputRef}
                />
              </div>
            </div>
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Buscar en lista actual por descripción, código o proveedor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-md bg-background border-input pl-8 shadow-sm focus:ring-primary focus:border-primary"
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

         {activeSection === 'Catálogo de Productos' && currentUserId && (
            <div id="database-content">
               <ProductDatabase
                  userId={currentUserId}
                  onStartCountByProvider={handleStartCountByProvider}
                  isLoadingCatalog={isDbLoading}
                  catalogProducts={catalogProducts}
                  onAddOrUpdateProduct={async (productData: ProductDetail) => { // Wrapper for add/update
                      if (!currentUserId) return;
                      setIsDbLoading(true); setIsSyncing(true);
                      try {
                          await addOrUpdateProductInCatalog(currentUserId, productData);
                          await synchronizeAndLoadCatalog(); // Refresh catalog from Firestore
                          requestAnimationFrame(() => toast({title: productData.barcode ? "Producto Actualizado" : "Producto Agregado"}));
                      } catch (error: any) {
                          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo guardar: ${error.message}` }));
                      } finally {
                          if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); }
                      }
                  }}
                  onDeleteProduct={async (barcodeToDelete) => { 
                    if (!currentUserId || !db) return;
                    setIsDbLoading(true); setIsSyncing(true);
                    try {
                        await deleteProductFromCatalog(currentUserId, barcodeToDelete);
                        await synchronizeAndLoadCatalog(); // Refresh catalog from Firestore
                        if (isMountedRef.current) {
                          requestAnimationFrame(() => toast({title: "Producto eliminado del catálogo"}));
                        }
                    } catch (error: any) {
                          if (!isMountedRef.current) return;
                          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
                    } finally {
                          if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); }
                    }
                  }}
                  onLoadFromGoogleSheet={handleGoogleSheetLoadToCatalog}
                  onClearCatalogRequest={() => setIsClearCatalogConfirmOpen(true)}
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
                    isLoading={isDbLoading || isTransitionPending || isSyncing}
                  />
             </div>
           )}
           {activeSection === 'Consolidado' && currentUserId && (
             <div id="consolidated-report-content" className="h-full">
                <ConsolidatedView
                    catalogProducts={catalogProducts} // Pass catalogProducts from state
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
            setIsConfirmQuantityDialogOpen(open);
            if (!open) { setConfirmQuantityProductBarcode(null); setConfirmQuantityAction(null); setConfirmQuantityNewValue(null); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }
          }}
          title="Confirmar Modificación"
          description={
             (() => {
               if (confirmQuantityNewValue === null || !confirmQuantityProductBarcode) return "¿Continuar con la modificación?";
               const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
               const stock = product?.stock ?? 0;
               const description = product?.description ?? confirmQuantityProductBarcode;
               if (stock > 0 && confirmQuantityNewValue > stock) {
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
         onOpenChange={(open) => { setIsDeleteDialogOpen(open); if (!open) { setProductToDelete(null); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
         title="Confirmar Eliminación"
         description={ productToDelete ? `¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) de la lista actual (${getWarehouseName(productToDelete?.warehouseId)})?` : `¿Seguro que deseas eliminar este producto?`}
         onConfirm={confirmDelete}
         onCancel={() => { if(isMountedRef.current) setIsDeleteDialogOpen(false); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
         isDestructive={true}
         isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => { setIsDeleteListDialogOpen(open); if (!open) { requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})?`}
          onConfirm={handleClearCurrentList}
          onCancel={() => { if(isMountedRef.current) setIsDeleteListDialogOpen(false); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
          isDestructive={true}
          isProcessing={isTransitionPending || isSyncing}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => { setIsClearCatalogConfirmOpen(open); if (!open) { requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
            title="Confirmar Borrado Catálogo"
            description={
                 <div className="space-y-2">
                    <div className="flex items-center gap-2 text-destructive">
                         <AlertTriangle className="h-5 w-5"/>
                         <span className="font-semibold">¡Acción Irreversible!</span>
                    </div>
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos del catálogo maestro y su caché local.</p>
                    <p>Esta acción no se puede deshacer.</p>
                 </div>
            }
            confirmText="Sí, Borrar Catálogo"
            onConfirm={handleClearCatalog}
            onCancel={() => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(false); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
            isDestructive={true}
            isProcessing={isDbLoading || isTransitionPending || isSyncing}
        />

      {productToEditDetail && currentUserId && (
        <EditProductDialog
          isOpen={isEditDetailDialogOpen}
          setIsOpen={(open) => { setIsEditDetailDialogOpen(open); if (!open) { setProductToEditDetail(null); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
          selectedDetail={productToEditDetail}
          setSelectedDetail={setProductToEditDetail}
          onSubmit={handleEditDetailSubmit}
          onDelete={ async (barcodeToDelete) => {
                if (!isMountedRef.current || !currentUserId) return;
                setIsDbLoading(true); setIsSyncing(true);
                try {
                    await deleteProductFromCatalog(currentUserId, barcodeToDelete);
                    await synchronizeAndLoadCatalog(); // Refresh catalog
                    if (isMountedRef.current) {
                      requestAnimationFrame(() => toast({title: "Producto eliminado del catálogo"}));
                      setIsEditDetailDialogOpen(false); setProductToEditDetail(null);
                    }
                } catch (error: any) {
                      if (!isMountedRef.current) return;
                      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
                } finally {
                      if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); }
                      requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
                }
            }}
          isProcessing={isDbLoading || isTransitionPending || isSyncing}
          context="database" 
        />
      )}
    </div>
  );
}

