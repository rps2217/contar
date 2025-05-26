
// src/app/page.tsx
"use client";

import type { DisplayProduct, ProductDetail, Warehouse, CountingHistoryEntry } from '@/types/product';
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

import { WarehouseManagement } from "@/components/warehouse-management";
import { EditWarehouseDialog } from "@/components/edit-warehouse-dialog";
import { ConsolidatedView } from '@/components/consolidated-view';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';


import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock,
  BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide,
  LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert,
  Filter, Download, Edit, Camera, Library, X, Check, ScanLine, Scan
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
  clearProductDatabase,
  addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database'; // Using IndexedDB for product catalog

// Firestore functions
import {
  subscribeToWarehouses,
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  setCountingListItem,
  deleteCountingListItem,
  clearCountingListForWarehouseInFirestore,
  subscribeToCountingList,
  getAllProductsFromCatalog,
  addOrUpdateProductInCatalog,
  deleteProductFromCatalog,
  addProductsToCatalog,
  clearProductCatalogInFirestore,
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
import { useLocalStorage } from '@/hooks/use-local-storage';
import Papa from 'papaparse';


import {
    LOCAL_STORAGE_USER_ID_KEY,
    LOCAL_STORAGE_ACTIVE_SECTION_KEY,
    LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY,
    LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX,
    LOGIN_USER,
    LOGIN_PASSWORD,
    LAST_SCANNED_BARCODE_TIMEOUT_MS,
    DEFAULT_WAREHOUSE_ID,
    DEFAULT_WAREHOUSE_NAME,
    LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX, // Added back for local persistence
  } from '@/lib/constants';
import { writeBatch, doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera';


// Define this outside the component if it doesn't depend on component's scope
const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
];

// --- Google Sheet Data Fetching Logic (moved from ProductDatabaseComponent) ---
const extractSpreadsheetIdAndGid = (input: string): { spreadsheetId: string | null; gid: string } => {
  if (!input) return { spreadsheetId: null, gid: '0' };
  let spreadsheetId: string | null = null;
  const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/.*)?/;
  const idMatch = input.match(sheetUrlPattern);
  if (idMatch && idMatch[1]) {
      spreadsheetId = idMatch[1];
  } else if (!input.includes('/') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
      // Assume it's an ID if it doesn't look like a URL and matches typical ID patterns
      spreadsheetId = input;
  }

  const gidMatch = input.match(/[#&]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  return { spreadsheetId, gid };
};

async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);

    if (!spreadsheetId) {
        console.warn("[fetchGoogleSheetData] Could not extract spreadsheet ID from input:", sheetUrlOrId);
        throw new Error("URL/ID de Hoja de Google inválido. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }

    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log(`[fetchGoogleSheetData] Fetching Google Sheet data from: ${csvExportUrl}`);

    let response: Response;
    try {
        // Add cache-busting query parameter
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" }); // Attempt to bypass cache
    } catch (error: any) {
        // Network error or CORS issue often manifests here
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL/ID.";
        if (error.message?.includes('Failed to fetch')) {
            // More specific message for common fetch failures
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
        
        console.error("[fetchGoogleSheetData] Google Sheet fetch error details:", { status, statusText, errorBody, csvExportUrl });
        throw new Error(userMessage);
    }

    const csvText = await response.text();

    return new Promise((resolve, reject) => {
        if (typeof Papa === 'undefined') {
            console.error("[fetchGoogleSheetData] PapaParse (Papa) is not defined/loaded.");
            reject(new Error("La librería PapaParse (Papa) no está cargada."));
            return;
        }

        Papa.parse<string[]>(csvText, {
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length > 0) {
                     results.errors.forEach(err => console.warn(`[fetchGoogleSheetData] PapaParse error: ${err.message} on row ${err.row}. Code: ${err.code}. Type: ${err.type}`));
                     // Optionally reject or resolve with partial data based on error severity
                }
                const csvData = results.data;
                const products: ProductDetail[] = [];

                if (csvData.length <= 1) { // Only header or empty
                    console.log("[fetchGoogleSheetData] CSV data has only header or is empty.");
                    resolve(products); // Resolve with empty array if no data rows
                    return;
                }
                
                // Column mapping: 1st for barcode, 2nd for description, 6th for stock, 10th for provider
                const BARCODE_COLUMN_INDEX = 0;
                const DESCRIPTION_COLUMN_INDEX = 1;
                const EXPIRATION_DATE_COLUMN_INDEX = 2; // As per previous logic
                const STOCK_COLUMN_INDEX = 5;
                const PROVIDER_COLUMN_INDEX = 9;

                for (let i = 1; i < csvData.length; i++) { // Start from 1 to skip header row
                    const values = csvData[i];
                    if (!values || values.length === 0 || values.every(v => !v?.trim())) continue; // Skip empty or effectively empty rows

                    const barcode = values[BARCODE_COLUMN_INDEX]?.trim();
                    if (!barcode) { 
                        console.warn(`[fetchGoogleSheetData] Fila ${i + 1} omitida: Código de barras vacío o faltante.`);
                        continue; // Essential field, skip if missing
                    }

                    const description = values[DESCRIPTION_COLUMN_INDEX]?.trim();
                    const stockStr = values[STOCK_COLUMN_INDEX]?.trim();
                    const provider = values[PROVIDER_COLUMN_INDEX]?.trim();
                    const expirationDateStr = values[EXPIRATION_DATE_COLUMN_INDEX]?.trim();

                    const finalDescription = description || `Producto ${barcode}`; // Fallback for description
                    const finalProvider = provider || "Desconocido"; // Fallback for provider

                    let stock = 0;
                    if (stockStr) {
                        const parsedStock = parseInt(stockStr, 10);
                        if (!isNaN(parsedStock) && parsedStock >= 0) {
                            stock = parsedStock;
                        } else {
                             console.warn(`[fetchGoogleSheetData] Valor de stock inválido "${stockStr}" para código ${barcode} en fila ${i + 1}. Usando 0.`);
                        }
                    }
                    
                    // expirationDate will be null if string is empty, otherwise the string
                    const expirationDate: string | null = expirationDateStr ? expirationDateStr : null;

                    products.push({ barcode, description: finalDescription, provider: finalProvider, stock, expirationDate });
                }
                resolve(products);
            },
            error: (error: any) => {
                console.error("[fetchGoogleSheetData] PapaParse CSV parsing error:", error);
                reject(new Error(`Error al analizar el archivo CSV desde Google Sheet: ${error.message}`));
            }
        });
    });
}


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
  const [isDbLoading, setIsDbLoading] = useState(true); // Unified loading state for catalog and other initial data
  const [isSyncing, setIsSyncing] = useState(false); // For Firestore operations
  const [processingStatus, setProcessingStatus] = useState<string>(""); // For Google Sheet loading

  // --- Warehouse State ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST); // Start with predefined for UI consistency
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  
  // --- Product Catalog State (Firestore as master, IndexedDB as cache) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]); // Holds products from Firestore/IndexedDB

  // --- Counting List State (Firestore as master, localStorage as temporary fallback) ---
  const [barcode, setBarcode] = useState("");
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState(""); // For filtering counting list
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
  
  // --- Edit Product Dialog State (for catalog) ---
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
  const [isClearCatalogConfirmOpen, setIsClearCatalogConfirmOpen] = useState(false);

  // --- Refs for managing initial data fetches ---
  const isInitialFetchDoneForUserWarehouses = useRef<Record<string, boolean>>({});
  const isInitialCatalogSyncDoneForUser = useRef<Record<string, boolean>>({});

  // --- Camera Scan Mode ---
  const [isCameraScanMode, setIsCameraScanMode] = useState(false);
  const [isActivelyScanningByButton, setIsActivelyScanningByButton] = useState(false);

  const toggleCameraScanMode = useCallback(() => {
    setIsCameraScanMode(prev => !prev);
    if (!isCameraScanMode) { // When turning on camera scan mode
        setActiveSection('Contador Cámara'); // Switch to camera section
    } else { // When turning off camera scan mode
        setActiveSection('Contador'); // Switch back to manual counter section
    }
  }, [isCameraScanMode, setActiveSection]);

  const handleScanButtonPress = useCallback(() => setIsActivelyScanningByButton(true), []);
  const handleScanButtonRelease = useCallback(() => setIsActivelyScanningByButton(false), []);


  const toggleShowOnlyDiscrepancies = useCallback(() => {
    setShowOnlyDiscrepancies(prev => !prev);
  }, [setShowOnlyDiscrepancies]);


  // --- Focus Management ---
  const focusBarcodeIfCounting = useCallback(() => {
    if (isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara') && barcodeInputRef.current) {
        // Only focus if not in camera scan mode OR if in camera mode but the input is part of the UI for that mode
        if (activeSection === 'Contador' || (activeSection === 'Contador Cámara' && !isCameraScanMode )) {
            requestAnimationFrame(() => {
                if (isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara') && barcodeInputRef.current) {
                     if (document.activeElement !== barcodeInputRef.current) {
                        barcodeInputRef.current.focus();
                     }
                }
            });
            setTimeout(() => {
                if (isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara') && barcodeInputRef.current) {
                    if (document.activeElement !== barcodeInputRef.current) {
                        barcodeInputRef.current.focus();
                    }
                }
            }, 100); 
        }
    }
  }, [activeSection, isCameraScanMode]); // isCameraScanMode added

  // --- Lifecycle: Mount/Unmount ---
  useEffect(() => {
    isMountedRef.current = true;
    // Check for existing login
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId === LOGIN_USER) { // Assuming LOGIN_USER is "rps"
        setCurrentUserId(LOGIN_USER); // Set current user ID
        setIsAuthenticated(true); // Mark as authenticated
    } else {
        setCurrentUserId(null); // Ensure no user ID if not "rps"
        setIsAuthenticated(false); // Mark as not authenticated
        if(typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY); // Clean up if not "rps"
    }

    requestAnimationFrame(() => {
      if (isMountedRef.current) focusBarcodeIfCounting();
    });

    return () => {
      isMountedRef.current = false;
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
    };
  }, [focusBarcodeIfCounting, setCurrentUserId]);


  // --- Hybrid Catalog Management (Firestore as master, IndexedDB as cache) ---
  const synchronizeAndLoadCatalog = useCallback(async (userIdToSync: string) => {
    if (!userIdToSync || !isMountedRef.current || !db) {
        console.warn("[SyncCatalog] Skipping: No userIdToSync, component not mounted, or Firestore DB not initialized.");
        if(isMountedRef.current) setIsDbLoading(false);
        return;
    }
    console.log("[SyncCatalog] Starting catalog synchronization for user:", userIdToSync);
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        console.log("[SyncCatalog] Attempting to fetch catalog from Firestore for user:", userIdToSync);
        const firestoreProducts = await getAllProductsFromCatalog(userIdToSync);
        
        if (isMountedRef.current) {
            console.log(`[SyncCatalog] Fetched ${firestoreProducts.length} products from Firestore.`);
            console.log("[SyncCatalog] First 5 Firestore products (if any):", JSON.parse(JSON.stringify(firestoreProducts.slice(0, 5).map(p => ({b: p.barcode, d:p.description?.substring(0,15)})))));

            await clearProductDatabase(); // Clear local IndexedDB cache
            await addProductsToIndexedDB(firestoreProducts); // Populate local IndexedDB cache with Firestore data
            
            const sortedFirestoreProducts = firestoreProducts
                .filter(p => p && p.barcode) // Ensure product and barcode exist
                .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
            setCatalogProducts(sortedFirestoreProducts);

            if (!isInitialCatalogSyncDoneForUser.current[userIdToSync]) {
                requestAnimationFrame(() => toast({ title: "Catálogo Sincronizado", description: "El catálogo local se actualizó desde la nube."}));
                isInitialCatalogSyncDoneForUser.current[userIdToSync] = true;
            }
        }
    } catch (error: any) {
        console.error("[SyncCatalog] Error fetching catalog from Firestore, loading from local IndexedDB:", error.message, error.stack);
        if (isMountedRef.current) {
            if (!isInitialCatalogSyncDoneForUser.current[userIdToSync]) {
                 requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Catálogo)", description: "Usando catálogo local. No se pudo conectar a la nube."}));
                 isInitialCatalogSyncDoneForUser.current[userIdToSync] = true;
            }
            try {
                const localProducts = await getAllProductsFromIndexedDB();
                console.log(`[SyncCatalog] Fetched ${localProducts.length} products from IndexedDB.`);
                console.log("[SyncCatalog] First 5 IndexedDB products (if any):", JSON.parse(JSON.stringify(localProducts.slice(0, 5).map(p => ({b: p.barcode, d:p.description?.substring(0,15)})))));
                
                const sortedLocalProducts = localProducts
                    .filter(p => p && p.barcode) // Ensure product and barcode exist
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
  }, [toast]); 

  useEffect(() => {
    if (currentUserId && isAuthenticated) { // Only sync if authenticated and userId exists
      synchronizeAndLoadCatalog(currentUserId);
    } else {
      // Not authenticated or no user ID, clear catalog and set loading to false
      setCatalogProducts([]); 
      if (isMountedRef.current) setIsDbLoading(false); 
    }
  }, [currentUserId, isAuthenticated, synchronizeAndLoadCatalog]);


  // --- Warehouse Management (Firestore as master) ---
  useEffect(() => {
    if (!currentUserId || !db || !isAuthenticated) { // Also check isAuthenticated
        console.warn("[Warehouses] Skipping Firestore subscription: No currentUserId, Firestore DB not initialized, or not authenticated.");
        if (isMountedRef.current) {
            // Fallback to local predefined warehouses if not authenticated or no connection
            const localDefaultWarehouses = [...PREDEFINED_WAREHOUSES_LIST];
            setWarehouses(localDefaultWarehouses);
            const storedWarehouseId = currentUserId ? getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
            setCurrentWarehouseId(localDefaultWarehouses.some(w => w.id === storedWarehouseId) ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
        }
        return;
    }

    console.log("[Warehouses] Subscribing to warehouses for user:", currentUserId);
    let isInitialFetchForUser = !isInitialFetchDoneForUserWarehouses.current[currentUserId];

    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehouses) => {
        if (!isMountedRef.current) return;
        
        let finalWarehousesToSet = [...fetchedWarehouses];
        
        if (isInitialFetchForUser && db && currentUserId) { // Ensure db and currentUserId are valid
            isInitialFetchForUser = false; // Prevent re-running this block for this user in this session
            isInitialFetchDoneForUserWarehouses.current[currentUserId!] = true;

            const warehousesToAddBatch: Warehouse[] = [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predefined => {
                if (!finalWarehousesToSet.some(fw => fw.id === predefined.id)) {
                    warehousesToAddBatch.push(predefined);
                }
            });

            if (warehousesToAddBatch.length > 0) {
                console.log("[Warehouses] Adding predefined warehouses to Firestore:", warehousesToAddBatch.map(w=>w.name));
                if(isMountedRef.current) setIsSyncing(true);
                try {
                    const batch = writeBatch(db); // db should be initialized if we reach here
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                    console.log("[Warehouses] Predefined warehouses added successfully. Listener will update list.");
                } catch (err) {
                    console.error(`[Warehouses] Failed to add predefined warehouses for user ${currentUserId}:`, err);
                    if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                     finalWarehousesToSet = [...finalWarehousesToSet, ...warehousesToAddBatch].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
                } finally {
                    if(isMountedRef.current) setIsSyncing(false);
                }
            }
        }
        
        if (finalWarehousesToSet.length === 0 && isMountedRef.current) {
            finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST];
            console.warn("[Warehouses] No warehouses from Firestore, using local predefined list for UI.");
        }
        
        if(isMountedRef.current) setWarehouses(finalWarehousesToSet);

        const storedWarehouseIdKey = `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId!}`; // currentUserId should be valid here
        const storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
        
        let currentSelectionIsValid = finalWarehousesToSet.some(w => w.id === storedWarehouseId);

        if (!currentSelectionIsValid) {
            const mainExistsInFinalList = finalWarehousesToSet.find(w => w.id === DEFAULT_WAREHOUSE_ID);
            const newCurrentId = mainExistsInFinalList ? DEFAULT_WAREHOUSE_ID : (finalWarehousesToSet[0]?.id || DEFAULT_WAREHOUSE_ID);
            if(isMountedRef.current) setCurrentWarehouseId(newCurrentId);
            setLocalStorageItem(storedWarehouseIdKey, newCurrentId);
            console.log(`[Warehouses] Current warehouse selection '${storedWarehouseId}' invalid or not found, changed to '${newCurrentId}'.`);
        } else {
            if(isMountedRef.current) setCurrentWarehouseId(storedWarehouseId);
        }
    }, (error) => { 
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
        if (currentUserId) { // Only log if userId was set
          console.log("[Warehouses] Unsubscribing from warehouses for user:", currentUserId);
        }
        unsubscribe();
    };
  }, [currentUserId, toast, isAuthenticated]); // Added isAuthenticated

  // --- Counting List (Firestore as master, localStorage for temporary UI persistence and fallback) ---
  useEffect(() => {
    const localKey = currentUserId && currentWarehouseId ? `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}` : null;

    if (!currentUserId || !currentWarehouseId || !db || !isAuthenticated) { // Also check isAuthenticated
        console.warn(`[CountingList] Skipping Firestore subscription: No currentUserId ('${currentUserId}'), currentWarehouseId ('${currentWarehouseId}'), Firestore DB not init, or not authenticated.`);
        if (localKey && isMountedRef.current) {
            const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
            startTransition(() => { setCountingList(localList); });
        } else if (isMountedRef.current) {
             startTransition(() => { setCountingList([]); }); // Clear list if no local key
        }
        return () => {};
    }

    console.log(`[CountingList] Subscribing to counting list for user '${currentUserId}', warehouse '${currentWarehouseId}'.`);
    if (isMountedRef.current) setIsSyncing(true);
    
    const unsubscribeFirestore = subscribeToCountingList(
      currentUserId, 
      currentWarehouseId, 
      (productsFromFirestore) => { 
        if (isMountedRef.current) {
            startTransition(() => { setCountingList(productsFromFirestore); });
            if (localKey) setLocalStorageItem(localKey, productsFromFirestore); // Update localStorage as a recent fallback
            console.log(`[CountingList] Received ${productsFromFirestore.length} items from Firestore for warehouse '${currentWarehouseId}'.`);
            if(isSyncing) setIsSyncing(false); 
        }
      }, 
      (error) => { 
        if (isMountedRef.current) {
            console.warn(`[CountingList] Firestore subscription error for warehouse '${currentWarehouseId}'. Error: ${error.message}. Loading from localStorage as fallback.`);
            setIsSyncing(false); 
            if (localKey) {
                const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
                startTransition(() => { setCountingList(localList); });
            } else {
                 startTransition(() => { setCountingList([]); });
            }
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Conteo)", description: "Usando lista de conteo local."}));
        }
      }
    );

    return () => {
        console.log(`[CountingList] Unsubscribing from counting list for warehouse '${currentWarehouseId}'.`);
        unsubscribeFirestore();
        if (isMountedRef.current && isSyncing) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, toast, isAuthenticated]); // Added isAuthenticated, isSyncing removed


  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
    if (!warehouseId) return 'N/A';
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : `Almacén (${warehouseId.substring(0,6)}...)`;
  }, [warehouses]);

  const showDiscrepancyToastIfNeeded = useCallback((product: DisplayProduct, newCountVal?: number) => {
    const countToCheck = newCountVal !== undefined ? newCountVal : (product.count ?? 0);
    const stockToCheck = product.stock ?? 0;

    if (stockToCheck > 0 && countToCheck !== stockToCheck) {
        // Solo mostrar el toast si NO estamos en la sección 'Contador' o 'Contador Cámara'
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
        return true; // Importante: seguir retornando true para indicar que hay una discrepancia
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

    if(isMountedRef.current) setIsSyncing(true);
    try {
        const existingProductInList = countingList.find((p) => p.barcode === trimmedBarcode); // No need to check warehouseId here as countingList is already for currentWarehouseId via onSnapshot

        if (existingProductInList) {
            const newCount = (existingProductInList.count ?? 0) + 1;
            const productDataForFirestore: Partial<DisplayProduct> & { firestoreLastUpdated: any } = { // Use Partial for updates
                count: newCount,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp(),
            };
            await setCountingListItem(currentUserId, currentWarehouseId, existingProductInList.barcode, productDataForFirestore, true); // merge: true
            playBeep(880, 100);
        } else {
            let newProductBase: Omit<DisplayProduct, 'barcode' | 'warehouseId'>; // Ensure all fields for Firestore
            
            console.log(`[handleAddProduct] Buscando código: "'${trimmedBarcode}'" (longitud: ${trimmedBarcode.length})`);
            const catalogProd = catalogProducts.find(cp => cp.barcode === trimmedBarcode); // Use catalogProducts state
            console.log(`[handleAddProduct] Resultado para '${trimmedBarcode}' desde catalogProducts:`, JSON.parse(JSON.stringify(catalogProd || {})));

            if (catalogProd && catalogProd.barcode) {
                 newProductBase = {
                    description: catalogProd.description || `Producto ${trimmedBarcode}`,
                    provider: catalogProd.provider || "Desconocido",
                    stock: catalogProd.stock ?? 0,
                    expirationDate: catalogProd.expirationDate || null,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(660, 150);
            } else {
                 newProductBase = {
                    description: `Producto desconocido ${trimmedBarcode}`,
                    provider: "Desconocido",
                    stock: 0,
                    count: 1,
                    expirationDate: null,
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(440, 300);
                if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')){
                    requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Producto Desconocido", description: `Agregado temporalmente. Edita en 'Catálogo'.`}); });
                }
            }
            const dataForFirestore: DisplayProduct = {
                barcode: trimmedBarcode,
                warehouseId: currentWarehouseId, // Not stored in doc, but good to have for full DisplayProduct type
                ...newProductBase,
                firestoreLastUpdated: serverTimestamp(),
            };
             console.log("[handleAddProduct] Objeto a enviar a setCountingListItem (nuevo):", JSON.parse(JSON.stringify(dataForFirestore)));
             if (!dataForFirestore.barcode || dataForFirestore.barcode.trim() === "") {
                console.error("[handleAddProduct] Intento de guardar producto sin código de barras:", dataForFirestore);
                toast({variant: "destructive", title: "Error Interno", description: "No se pudo agregar producto sin código."});
                setIsSyncing(false);
                requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
                return;
             }
            await setCountingListItem(currentUserId, currentWarehouseId, dataForFirestore); // No merge, it's a new doc
        }
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
  }, [barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, catalogProducts, focusBarcodeIfCounting, activeSection]);


 const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;

    const productInList = countingList.find(p => p.barcode === barcodeToUpdate);
    if (!productInList) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto no encontrado en la lista actual.`}));
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
    
    if(isMountedRef.current) setIsSyncing(true);
    try {
        if (type === 'count') {
            const updatedProductData: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
                count: calculatedNewValue,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, productInList.barcode, updatedProductData, true); // Pass true for merge
            if (showDiscrepancyToastIfNeeded(productInList, calculatedNewValue)) {
              // Toast is handled by showDiscrepancyToastIfNeeded if not in counter section
            }
        } else if (type === 'stock') {
            const masterProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
            if (masterProduct && currentUserId) { // ensure currentUserId is valid
                const updatedMasterProduct: ProductDetail = { ...masterProduct, stock: calculatedNewValue };
                await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); 
                await synchronizeAndLoadCatalog(currentUserId); // Refresh catalog state and IndexedDB cache
                
                const updatedCountingItemStock: Partial<DisplayProduct> & { firestoreLastUpdated: any } = { 
                    stock: calculatedNewValue, 
                    lastUpdated: new Date().toISOString(),
                    firestoreLastUpdated: serverTimestamp()
                };
                await setCountingListItem(currentUserId, currentWarehouseId, productInList.barcode, updatedCountingItemStock, true);
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
  }, [currentWarehouseId, currentUserId, toast, countingList, catalogProducts, focusBarcodeIfCounting, activeSection, synchronizeAndLoadCatalog, showDiscrepancyToastIfNeeded]);


const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue: boolean = false) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    const productInList = countingList.find(p => p.barcode === barcodeToUpdate);
    if (!productInList) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Producto no encontrado en la lista." }));
      if(isMountedRef.current) setOpenModifyDialog(null); // Close dialog if product disappears
      return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    // If not summing, and new value is same as original, and confirm dialog is not open for this, just close and focus
    if (type === 'count' && !sumValue && newValue === originalValue && !isConfirmQuantityDialogOpen) {
        if(isMountedRef.current) setOpenModifyDialog(null);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    const finalNewValue = Math.max(0, calculatedValue); // Ensure value is not negative
    const needsConfirmation = type === 'count' && productInList.stock !== undefined && finalNewValue > productInList.stock && (!sumValue || originalValue <= productInList.stock);

    // If confirmation is needed and we are in a counter section, show dialog
    if (needsConfirmation && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) {
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction('set'); // Action is 'set' because we are directly setting a value
            setConfirmQuantityNewValue(finalNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100);
        return; // Exit to wait for user confirmation
    }
    
    // Proceed with update if no confirmation needed or not in counter section
    if(isMountedRef.current) setIsSyncing(true);
    try {
        if (type === 'count') {
            const updatedProductForFirestore: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
                count: finalNewValue,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, productInList.barcode, updatedProductForFirestore, true); // Merge update
             if (showDiscrepancyToastIfNeeded(productInList, finalNewValue)) {
                // Toast handled by showDiscrepancyToastIfNeeded if not in counter section
            }
        } else if (type === 'stock') {
            // This logic is for updating the master catalog stock
            const masterProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
            if (masterProduct && currentUserId) { // Ensure currentUserId
                const updatedMasterProduct: ProductDetail = { ...masterProduct, stock: finalNewValue };
                await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); 
                await synchronizeAndLoadCatalog(currentUserId); // Refresh catalog and IndexedDB

                // Also update the stock in the current counting list item in Firestore if it exists
                const updatedCountingItemStock: Partial<DisplayProduct> & { firestoreLastUpdated: any } = { 
                    stock: finalNewValue,
                    lastUpdated: new Date().toISOString(),
                    firestoreLastUpdated: serverTimestamp()
                };
                await setCountingListItem(currentUserId, currentWarehouseId, productInList.barcode, updatedCountingItemStock, true);
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
}, [toast, countingList, catalogProducts, focusBarcodeIfCounting, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen, activeSection, synchronizeAndLoadCatalog, showDiscrepancyToastIfNeeded]);


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

     const productInList = countingList.find(p => p.barcode === confirmQuantityProductBarcode);
     if (!productInList) {
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
         return;
     }

    const finalConfirmedCount = Math.max(0, confirmQuantityNewValue);
    const updatedProductForFirestore: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
        count: finalConfirmedCount,
        lastUpdated: new Date().toISOString(),
        firestoreLastUpdated: serverTimestamp()
    };

    if(isMountedRef.current) setIsSyncing(true);
    try {
        await setCountingListItem(currentUserId, currentWarehouseId, productInList.barcode, updatedProductForFirestore, true);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Cantidad Modificada" }));
    } catch (error) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
    } finally {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsConfirmQuantityDialogOpen(false);
            setConfirmQuantityProductBarcode(null);
            setConfirmQuantityAction(null);
            setConfirmQuantityNewValue(null);
            setOpenModifyDialog(null); // Close modify dialog if it was source of confirmation
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
    const {barcode: barcodeForToast, description: descriptionForToast } = productToDelete;
    
    if(isMountedRef.current) setIsSyncing(true);
    try {
        await deleteCountingListItem(currentUserId, currentWarehouseId, barcodeForToast);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" se eliminó de la lista actual.` }));
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
    if(isMountedRef.current) setIsSyncing(true);
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
    if(isMountedRef.current) { setIsRefreshingStock(true); setIsSyncing(true); }
    let updatedProductCount = 0;
    
    try {
        const currentWarehouseItems = countingList.filter(item => item.warehouseId === currentWarehouseId);
        const productsToUpdateInFirestore: Partial<DisplayProduct>[] = [];

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
                        // Only push fields that need updating to Firestore for this item
                        barcode: countingProduct.barcode, // Needed for doc ID
                        description: catalogProd.description,
                        provider: catalogProd.provider,
                        stock: catalogProd.stock ?? 0,
                        expirationDate: catalogProd.expirationDate || null,
                        lastUpdated: new Date().toISOString(),
                        firestoreLastUpdated: serverTimestamp(),
                    });
                }
            }
        });
        
        if (productsToUpdateInFirestore.length > 0) {
            const batch = writeBatch(db); 
            productsToUpdateInFirestore.forEach(itemToUpdate => {
                if (!itemToUpdate.barcode) return; // Should not happen if logic is correct
                const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), itemToUpdate.barcode);
                const { barcode, warehouseId, ...dataToSet } = itemToUpdate; // Exclude barcode/warehouseId from data being set
                batch.set(docRef, dataToSet, { merge: true }); 
            });
            await batch.commit();
        }

        if(updatedProductCount > 0 && isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) en la lista.` }));
        } else if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Los productos en la lista ya están actualizados." }));
        }
    } catch (error) {
         console.error(`Error refreshing stock for warehouse ${currentWarehouseId}:`, error);
         if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Actualizar" }));
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
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        let productDataToEdit = catalogProducts.find(p => p.barcode === product.barcode);
        
        if (!productDataToEdit && isMountedRef.current) {
            console.log(`[EditDetail] Producto ${product.barcode} no encontrado en estado catalogProducts, buscando en IndexedDB como fallback...`);
            productDataToEdit = await getProductFromIndexedDB(product.barcode);
        }

        if (productDataToEdit) {
            setProductToEditDetail(productDataToEdit);
        } else {
            const placeholderDetail: ProductDetail = {
                 barcode: product.barcode,
                 description: product.description || `Producto ${product.barcode}`,
                 provider: product.provider || "Desconocido",
                 stock: 'stock' in product ? (product.stock ?? 0) : 0,
                 expirationDate: 'expirationDate' in product ? product.expirationDate : null,
            };
            setProductToEditDetail(placeholderDetail);
            if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Agregando Nuevo Producto", description: "Este producto se agregará al catálogo maestro." }));
        }
        if (isMountedRef.current) setIsEditDetailDialogOpen(true);
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
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); }
    try {
        const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, 
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || null,
        };
        await addOrUpdateProductInCatalog(currentUserId, updatedProductData);
        await synchronizeAndLoadCatalog(currentUserId);

        const productInCountingList = countingList.find(p => p.barcode === updatedProductData.barcode);
        if (productInCountingList && currentWarehouseId) { // ensure currentWarehouseId is valid
            const updatedCountingItemData: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
                description: updatedProductData.description,
                provider: updatedProductData.provider,
                stock: updatedProductData.stock ?? 0,
                expirationDate: updatedProductData.expirationDate,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, productInCountingList.barcode, updatedCountingItemData, true);
        }
        
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto Actualizado en Catálogo" }));
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

    if(isMountedRef.current) setIsSyncing(true);
    try {
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        
        const batch = writeBatch(db);
        productsToCount.forEach(dbProduct => {
            const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), dbProduct.barcode);
            const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId'> & { firestoreLastUpdated: any } = {
               description: dbProduct.description,
               provider: dbProduct.provider,
               stock: dbProduct.stock ?? 0,
               expirationDate: dbProduct.expirationDate || null,
               count: 0,
               lastUpdated: new Date().toISOString(),
               firestoreLastUpdated: serverTimestamp(),
            };
            batch.set(docRef, dataToSet); 
        });
        await batch.commit();

        if (isMountedRef.current) {
            setActiveSection("Contador");
            setSearchTerm("");
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
    // Get the list for the current warehouse from Firestore-backed 'countingList' state
    let listToFilter = countingList; // countingList is already filtered by onSnapshot for the currentWarehouseId implicitly

    if (showOnlyDiscrepancies) {
      listToFilter = listToFilter.filter(product => (product.count ?? 0) !== (product.stock ?? 0));
    }

    if (!lowerSearchTerm) return listToFilter;
    return listToFilter.filter(product =>
      (product.description || '').toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) ||
      (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
      (product.expirationDate || '').includes(lowerSearchTerm)
    );
  }, [countingList, searchTerm, showOnlyDiscrepancies]); // currentWarehouseId removed as countingList is already specific

  const handleSectionChange = useCallback((newSection: string) => {
    if(isMountedRef.current) {
      setActiveSection(newSection);
      if (newSection === 'Contador Cámara') {
        setIsCameraScanMode(true); // Activate camera mode
      } else {
        setIsCameraScanMode(false); // Deactivate for other sections
      }
    }
  }, [setActiveSection, setIsCameraScanMode]); // Added setIsCameraScanMode


   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             startTransition(() => {
                setCurrentWarehouseId(newWarehouseId);
                setSearchTerm("");
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
      if(isMountedRef.current) setIsSyncing(true);
      try {
          await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
          handleWarehouseChange(newWarehouse.id); 
          requestAnimationFrame(() => toast({title: "Almacén Agregado", description: `Cambiado a: ${newWarehouse.name}`}));
      } catch (error) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo agregar el almacén.' }));
      } finally {
          if(isMountedRef.current) setIsSyncing(false);
      }
    }, [warehouses, currentUserId, handleWarehouseChange, toast]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) return;
       if(isMountedRef.current) setIsSyncing(true);
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, warehouseToUpdate);
           if(isMountedRef.current) requestAnimationFrame(() => toast({ title: `Almacén "${warehouseToUpdate.name}" Actualizado` }));
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
    if(isMountedRef.current) setIsSyncing(true);
    try {
      await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
      if (isMountedRef.current) requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
    } catch (error) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo eliminar el almacén.' }));
    } finally {
      if(isMountedRef.current) setIsSyncing(false);
    }
  }, [toast, currentUserId]);


   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        // countingList is already for current warehouse due to Firestore subscription
        const currentItem = countingList.find(p => p.barcode === openModifyDialog.product!.barcode);
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList]); // currentWarehouseId removed

   // Function to handle catalog loading from Google Sheet
   const handleGoogleSheetLoadToCatalog = useCallback(async (sheetUrlOrId: string) => {
        if (!currentUserId) {
          toast({ variant: "destructive", title: "Error", description: "Debe iniciar sesión para cargar el catálogo." });
          return;
        }
        if (!sheetUrlOrId) {
          toast({ variant: "destructive", title: "URL/ID Requerido", description: "Por favor, ingrese la URL o ID de la Hoja de Google." });
          return;
        }

        if (isMountedRef.current) {
            setIsDbLoading(true);
            setIsSyncing(true);
            setProcessingStatus("Cargando datos desde Google Sheet...");
        }

        try {
          const productsFromSheet = await fetchGoogleSheetData(sheetUrlOrId);
          if (productsFromSheet.length > 0) {
            await addProductsToCatalog(currentUserId, productsFromSheet);
            await synchronizeAndLoadCatalog(currentUserId);
            if (isMountedRef.current) {
                requestAnimationFrame(() => {
                    toast({ title: "Catálogo Actualizado", description: `${productsFromSheet.length} productos cargados desde Google Sheet.` });
                });
                setProcessingStatus("Carga desde Google Sheet completada.");
            }
          } else {
            if (isMountedRef.current) {
                requestAnimationFrame(() => {
                    toast({ title: "Sin Productos", description: "No se encontraron productos en la Hoja de Google o el formato es incorrecto." });
                });
                setProcessingStatus("No se encontraron productos en la hoja.");
            }
          }
        } catch (error: any) {
          console.error("[handleGoogleSheetLoadToCatalog] Error:", error);
          if (isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({ variant: "destructive", title: "Error de Carga GS", description: error.message || "Ocurrió un error desconocido." });
            });
            setProcessingStatus(`Error: ${error.message}`);
          }
        } finally {
          if (isMountedRef.current) {
            setIsDbLoading(false);
            setIsSyncing(false);
            // No longer set processingStatus to "" here immediately, let it show final status
          }
        }
    }, [currentUserId, toast, synchronizeAndLoadCatalog, addProductsToCatalog]);

   const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current || !currentUserId) return;
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); }
    try {
      await clearProductCatalogInFirestore(currentUserId); 
      await synchronizeAndLoadCatalog(currentUserId); 
      if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Catálogo Borrado" }));
    } catch (error: any) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: `No se pudieron borrar datos: ${error.message}` }));
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); setIsClearCatalogConfirmOpen(false); setIsSyncing(false); }
      requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [toast, currentUserId, focusBarcodeIfCounting, synchronizeAndLoadCatalog]);


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
        setCurrentUserId(null); 
        setCountingList([]);
        setCatalogProducts([]); 
        setWarehouses(PREDEFINED_WAREHOUSES_LIST); 
        setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
        if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX) || 
                    key.startsWith(LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX)) { // Include counting list keys
                    localStorage.removeItem(key);
                }
            });
        }
        isInitialFetchDoneForUserWarehouses.current = {}; 
        isInitialCatalogSyncDoneForUser.current = {};
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
            isInitialFetchDoneForUserWarehouses.current[LOGIN_USER] = false; 
            isInitialCatalogSyncDoneForUser.current[LOGIN_USER] = false;
            requestAnimationFrame(() => toast({ title: "Inicio de sesión exitoso" }));
            setLoginUsername("");
            setLoginPassword("");
        }
    } else {
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de inicio de sesión" }));
        setLoginPassword("");
    }
  };

  const handleBarcodeScannedFromCamera = useCallback((scannedBarcode: string) => {
    if (!isMountedRef.current) return;
    if (isCameraScanMode && isActivelyScanningByButton) { // Process only if actively scanning
        // Set the barcode state to trigger handleAddProduct, similar to manual entry
        setBarcode(scannedBarcode); 
        // Call handleAddProduct directly if setBarcode doesn't trigger it reliably enough or quickly enough
        // For direct call:
        // handleAddProduct(scannedBarcode);
        // requestAnimationFrame(() => { if(isMountedRef.current) setBarcode(""); }); // Clear for next scan visually
    }
  }, [isCameraScanMode, isActivelyScanningByButton, setBarcode, handleAddProduct]); // setBarcode, handleAddProduct as deps

  // Effect to process barcode when it changes (e.g., from camera scan)
  useEffect(() => {
    if (barcode && (activeSection === 'Contador Cámara' && isCameraScanMode && isActivelyScanningByButton) ) {
        handleAddProduct(barcode);
        // Clear barcode state for next scan AFTER processing
        // Note: This might cause a quick flash in an input field if one were visible.
        // If BarcodeEntry is not visible in camera mode, this visual clear might not be necessary
        // or could be handled differently.
        requestAnimationFrame(() => { if (isMountedRef.current) setBarcode(""); });
    }
  }, [barcode, activeSection, isCameraScanMode, isActivelyScanningByButton, handleAddProduct]);


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
    <div className="flex h-screen bg-background text-foreground">
      <SidebarLayout {...sidebarProps} />

      <main className="flex-1 p-4 md:p-6 overflow-y-auto relative"> 
         {isSyncing && (
          <div className="absolute top-4 right-4 p-2 z-50" title="Sincronizando con la nube...">
            <RefreshCw className="h-5 w-5 text-primary animate-spin" />
          </div>
        )}

        {activeSection === 'Contador' && currentUserId && (
          <div id="contador-content" className="space-y-4 h-full flex flex-col">
             <div className="mb-4 space-y-4">
                <div className="flex items-center gap-2">
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
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={toggleCameraScanMode}
                        className="h-10 w-10 bg-rose-100 border-rose-300 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-800/70"
                        title="Activar Escáner de Cámara"
                        aria-label="Activar Escáner de Cámara"
                    >
                        <Camera className="h-5 w-5" />
                    </Button>
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder="Buscar en lista actual por descripción, código o proveedor..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full rounded-md bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 pl-8 shadow-sm focus:ring-primary focus:border-primary"
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
          <div id="contador-camara-content" className="flex flex-col h-full space-y-3">
            <div className="relative flex-grow min-h-[200px] md:min-h-[300px] border rounded-lg overflow-hidden shadow-md">
                <BarcodeScannerCamera
                  onBarcodeScanned={handleBarcodeScannedFromCamera}
                  isScanningActive={activeSection === 'Contador Cámara'}
                  isDecodingActive={isActivelyScanningByButton}
                />
                {isCameraScanMode && !isActivelyScanningByButton && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm z-10">
                        <ScanLine className="h-16 w-16 text-white/70 mb-4" />
                        <p className="text-white text-lg font-medium">Escaneo Pausado</p>
                        <p className="text-gray-300 text-sm">Mantén presionado el botón para escanear</p>
                    </div>
                )}
            </div>
            {isCameraScanMode && (
                <Button
                    onMouseDown={handleScanButtonPress}
                    onMouseUp={handleScanButtonRelease}
                    onTouchStart={handleScanButtonPress}
                    onTouchEnd={handleScanButtonRelease}
                    className={cn(
                        "w-full py-3 text-lg font-semibold rounded-md shadow-lg transition-colors",
                        isActivelyScanningByButton
                            ? "bg-green-600 hover:bg-green-700 text-white"
                            : "bg-primary hover:bg-primary/90 text-primary-foreground"
                    )}
                    aria-label={isActivelyScanningByButton ? "Escaneando..." : "Mantener para escanear"}
                >
                    <Scan className="mr-2 h-6 w-6" />
                    {isActivelyScanningByButton ? "Escaneando..." : "Mantener para Escanear"}
                </Button>
            )}
            <div className="flex items-center gap-2">
                <Button
                    onClick={handleRefreshStock}
                    variant="outline"
                    className="h-10 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 flex-shrink-0"
                    disabled={isDbLoading || isRefreshingStock || isTransitionPending || isActivelyScanningByButton}
                >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingStock ? 'animate-spin' : ''}`} /> Actualizar Stock
                </Button>
                <div className="relative flex-grow">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Buscar en lista escaneada..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full rounded-md bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 pl-8 shadow-sm"
                        disabled={isActivelyScanningByButton}
                    />
                     {searchTerm && (
                        <Button variant="ghost" size="icon" className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 p-0" onClick={() => setSearchTerm("")}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
             <div className="flex-1 overflow-hidden min-h-[150px]"> {/* Ensure table has some min height */}
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
                 <Button onClick={toggleShowOnlyDiscrepancies} variant="outline" className="w-full sm:w-auto" disabled={isDbLoading || isTransitionPending || isActivelyScanningByButton}>
                    <Filter className="mr-2 h-4 w-4" /> {showOnlyDiscrepancies ? "Mostrar Todo" : "Solo Diferencias"}
                 </Button>
                {isMobile ? ( <DropdownMenu> {/* ... Dropdown para móvil ... */} </DropdownMenu> ) : ( <> {/* ... Botones para escritorio ... */} </> )}
            </div>
          </div>
        )}

         {activeSection === 'Catálogo de Productos' && currentUserId && (
            <div id="database-content">
               <ProductDatabase
                  userId={currentUserId}
                  onStartCountByProvider={handleStartCountByProvider}
                  catalogProducts={catalogProducts} 
                  isLoadingCatalog={isDbLoading} 
                  onAddOrUpdateProduct={async (productData: ProductDetail) => { 
                      if (!currentUserId) return;
                      if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); }
                      try {
                          await addOrUpdateProductInCatalog(currentUserId, productData);
                          await synchronizeAndLoadCatalog(currentUserId); 
                          if(isMountedRef.current) requestAnimationFrame(() => toast({title: productData.barcode ? "Producto Actualizado" : "Producto Agregado"}));
                      } catch (error: any) {
                          if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo guardar: ${error.message}` }));
                      } finally {
                          if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); }
                      }
                  }}
                  onDeleteProduct={async (barcodeToDelete) => { 
                    if (!currentUserId || !db) return;
                    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); }
                    try {
                        await deleteProductFromCatalog(currentUserId, barcodeToDelete);
                        await synchronizeAndLoadCatalog(currentUserId); 
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
                  onClearCatalogRequest={() => { if (isMountedRef.current) setIsClearCatalogConfirmOpen(true); }}
                  processingStatus={processingStatus}
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
               const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode);
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
          setIsOpen={(open) => { if(isMountedRef.current) setIsEditDetailDialogOpen(open); if (!open) { if(isMountedRef.current) setProductToEditDetail(null); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
          selectedDetail={productToEditDetail}
          setSelectedDetail={(detail) => {if(isMountedRef.current) setProductToEditDetail(detail);}}
          onSubmit={handleEditDetailSubmit}
          onDelete={ async (barcodeToDelete) => {
                if (!isMountedRef.current || !currentUserId) return;
                if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); }
                try {
                    await deleteProductFromCatalog(currentUserId, barcodeToDelete);
                    await synchronizeAndLoadCatalog(currentUserId); 
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

    