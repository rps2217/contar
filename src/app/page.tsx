
// src/app/page.tsx
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
import { CountingListTable } from '@/components/counting-list-table';


import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock,
  BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide,
  LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert,
  Filter, Download, Edit, Library, X, Camera, ScanLine, Scan
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo, useTransition } from "react";
import { playBeep } from '@/lib/helpers';

// IndexedDB functions for Product Catalog (CACHE) and local history
import {
  getProductFromDB as getProductFromIndexedDB,
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  clearProductDatabase,
  addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database'; // Using IndexedDB for product catalog

// Firestore functions (Warehouses, CountingList, ProductCatalog)
import {
  subscribeToWarehouses,
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  setCountingListItem,
  deleteCountingListItem,
  subscribeToCountingList,
  clearCountingListForWarehouseInFirestore,
  getAllProductsFromCatalog,
  addOrUpdateProductInCatalog,
  deleteProductFromCatalog,
  addProductsToCatalog, // <<--- ENSURE THIS IS IMPORTED
  clearProductCatalogInFirestore,
  getProductFromCatalog,
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
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { EditProductDialog } from '@/components/edit-product-dialog';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { WarehouseManagement } from '@/components/warehouse-management';
import { EditWarehouseDialog } from '@/components/edit-warehouse-dialog';
import { ProductDatabase as ProductDatabaseComponent } from '@/components/product-database';
// import { CounterSection } from '@/components/counter-section'; // CounterSection's JSX is directly in Home
import { ConsolidatedView } from '@/components/consolidated-view';
import { BarcodeEntry } from '@/components/barcode-entry';
import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera';

// Firebase db instance for Firestore operations
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
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
    LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX,
    GOOGLE_SHEET_URL_LOCALSTORAGE_KEY,
  } from '@/lib/constants';
import { useLocalStorage } from '@/hooks/use-local-storage';


const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
];


// --- Google Sheet Data Fetching Logic (moved from ProductDatabaseComponent to Home) ---
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

async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
  const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);

  if (!spreadsheetId) {
    console.warn("[fetchGoogleSheetData] Could not extract spreadsheet ID from input:", sheetUrlOrId);
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
    console.error("[fetchGoogleSheetData] Network error:", error);
    throw new Error(userMessage);
  }

  if (!response.ok) {
    const status = response.status;
    const statusText = response.statusText;
    let errorBody = "No se pudo leer el cuerpo del error.";
    try { errorBody = await response.text(); } catch { /* no-op */ }

    let userMessage = `Error ${status} al obtener datos. `;
    if (status === 400) userMessage += "Solicitud incorrecta.";
    else if (status === 403) userMessage += "Acceso denegado. Asegúrese de que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.";
    else if (status === 404) userMessage += "Hoja no encontrada.";
    else userMessage += ` ${statusText}. Detalle: ${errorBody.substring(0, 200)}`;
    
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
        }
        const csvData = results.data;
        const products: ProductDetail[] = [];

        if (csvData.length <= 1) {
          resolve(products);
          return;
        }
        
        const BARCODE_COLUMN_INDEX = 0;
        const DESCRIPTION_COLUMN_INDEX = 1;
        const STOCK_COLUMN_INDEX = 5; 
        const PROVIDER_COLUMN_INDEX = 9;
        const EXPIRATION_DATE_COLUMN_INDEX = 2;

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
            if (!isNaN(parsedStock) && parsedStock >= 0) stock = parsedStock;
            else console.warn(`[fetchGoogleSheetData] Valor de stock inválido "${stockStr}" para código ${barcode} en fila ${i + 1}. Usando 0.`);
          }
          
          const expirationDate: string | null = (expirationDateStr && expirationDateStr.trim() !== "") ? expirationDateStr.trim() : null;

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
  const [isDbLoading, setIsDbLoading] = useState(true); // Global loading for DB operations (catalog, history)
  const [isSyncing, setIsSyncing] = useState(false); // Specific for Firestore write operations
  const [processingStatus, setProcessingStatus] = useState<string>("");

  // --- Warehouse State (Firestore as primary, localStorage for current selection) ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>([{ id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME }]);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  
  // --- Product Catalog State (Firestore as MASTER, IndexedDB as CACHE, UI state reflects this) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]); 

  // --- Counting List State (Firestore as MASTER, localStorage as CACHE for current user/warehouse) ---
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

  // Refs for initial data fetch flags
  const isInitialFetchDoneForUserWarehouses = useRef<Record<string, boolean>>({});


  // --- Camera Scan Mode ---
  const [isCameraScanMode, setIsCameraScanMode] = useState(false);
  const [isActivelyScanningByButton, setIsActivelyScanningByButton] = useState(false);

  const handleScanButtonPress = useCallback(() => setIsActivelyScanningByButton(true), []);
  const handleScanButtonRelease = useCallback(() => setIsActivelyScanningByButton(false), []);

  const toggleCameraScanMode = useCallback(() => {
    setIsCameraScanMode(prev => {
        if (!prev) { // Entering camera mode
            setIsActivelyScanningByButton(false); 
            setSearchTerm(""); 
        }
        return !prev;
    });
  }, []);

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

  useEffect(() => {
    isMountedRef.current = true;
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId === LOGIN_USER) { 
        setCurrentUserId(LOGIN_USER);
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
  }, [focusBarcodeIfCounting]);


  // Catalog Management (Firestore as MASTER, IndexedDB as CACHE)
  const synchronizeAndLoadCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (!currentUserId) { 
        if(isMountedRef.current) { 
            setCatalogProducts([]); 
            setIsDbLoading(false); 
            console.log("[SyncCatalog] No current user, catalog cleared.");
        }
        return;
    }

    if(isMountedRef.current) { setIsDbLoading(true); setProcessingStatus("Sincronizando catálogo..."); }
    console.log("[SyncCatalog] Starting catalog synchronization for user:", currentUserId);

    try {
        if (db && currentUserId) { 
            console.log("[SyncCatalog] Attempting to fetch catalog from Firestore.");
            const productsFromFirestore = await getAllProductsFromCatalog(currentUserId);
            console.log(`[SyncCatalog] Fetched ${productsFromFirestore.length} products from Firestore. First 5:`, productsFromFirestore.slice(0,5));
            
            if (isMountedRef.current) {
                const sortedFirestoreProducts = productsFromFirestore
                    .filter(p => p && p.barcode) 
                    .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
                
                setCatalogProducts(sortedFirestoreProducts);
                console.log("[SyncCatalog] Catalog state updated from Firestore.");
                
                await clearProductDatabase(); 
                console.log("[SyncCatalog] IndexedDB (product catalog) cleared.");
                await addProductsToIndexedDB(sortedFirestoreProducts);
                console.log("[SyncCatalog] IndexedDB repopulated from Firestore catalog.");

                requestAnimationFrame(() => toast({ title: "Catálogo Sincronizado", description: "Catálogo actualizado desde la nube."}));
                setProcessingStatus("Catálogo sincronizado desde la nube.");
            }
        } else {
            console.warn("[SyncCatalog] Firestore not available or no user. Falling back to IndexedDB.");
            const localProducts = await getAllProductsFromIndexedDB();
            console.log(`[SyncCatalog] Fetched ${localProducts.length} products from IndexedDB. First 5:`, localProducts.slice(0,5));
            if (isMountedRef.current) {
                const sortedLocalProducts = localProducts
                    .filter(p => p && p.barcode)
                    .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
                setCatalogProducts(sortedLocalProducts);
                requestAnimationFrame(() => toast({ title: "Catálogo Cargado (Local)", description: "Mostrando catálogo desde base de datos local."}));
                setProcessingStatus("Catálogo cargado desde base de datos local.");
            }
        }
    } catch (error: any) {
        console.error("[SyncCatalog] Error during catalog synchronization:", error.message, error.stack);
        if (isMountedRef.current) {
            setProcessingStatus(`Error al sincronizar catálogo: ${error.message}`);
            try {
                console.warn("[SyncCatalog] Firestore catalog sync failed, attempting to load from IndexedDB as fallback.");
                const localProducts = await getAllProductsFromIndexedDB();
                 const sortedLocalProducts = localProducts
                    .filter(p => p && p.barcode)
                    .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
                setCatalogProducts(sortedLocalProducts);
                requestAnimationFrame(() => toast({ variant: "default", title: "Catálogo Local Cargado", description: "No se pudo sincronizar catálogo, usando datos locales."}));
            } catch (indexedDbError: any) {
                console.error("[SyncCatalog] Error fetching catalog from IndexedDB after Firestore failure:", indexedDbError.message);
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudo cargar el catálogo."}));
                setCatalogProducts([]);
            }
        }
    } finally {
        if (isMountedRef.current) {
            setIsDbLoading(false);
            console.log("[SyncCatalog] Catalog synchronization finished.");
        }
    }
  }, [
    currentUserId, toast,
    clearProductDatabase, addProductsToIndexedDB, getAllProductsFromIndexedDB, // IndexedDB fns
    getAllProductsFromCatalog, // Firestore fn for catalog
    setCatalogProducts, setIsDbLoading, setProcessingStatus 
  ]);

  useEffect(() => {
    if (isAuthenticated && currentUserId) { 
      synchronizeAndLoadCatalog();
    } else {
      setCatalogProducts([]); 
      if (isMountedRef.current) setIsDbLoading(false); 
    }
  }, [isAuthenticated, currentUserId, synchronizeAndLoadCatalog]);


  // Warehouse Management (Firestore as primary)
  useEffect(() => {
    if (!currentUserId || !db || !isAuthenticated) {
        if (isMountedRef.current) {
            const localDefaultWarehouses = PREDEFINED_WAREHOUSES_LIST.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
            setWarehouses(localDefaultWarehouses);
            
            const storedWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${LOGIN_USER}`; 
            const storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(localDefaultWarehouses.some(w => w.id === storedWarehouseId) ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
        }
        return;
    }

    let isInitialFetchForUser = !isInitialFetchDoneForUserWarehouses.current[currentUserId];

    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehouses) => {
        if (!isMountedRef.current) return;
        
        let finalWarehousesToSet = [...fetchedWarehouses];
        
        if (isInitialFetchForUser && fetchedWarehouses.length === 0 && db && currentUserId) {
            isInitialFetchForUser = false; 
            isInitialFetchDoneForUserWarehouses.current[currentUserId] = true; 

            if(isMountedRef.current) setIsSyncing(true);
            try {
                const batch = writeBatch(db);
                PREDEFINED_WAREHOUSES_LIST.forEach(wh => {
                    const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                    batch.set(warehouseDocRef, wh);
                });
                await batch.commit();
                 // Firestore listener (subscribeToWarehouses) will eventually pick up these new warehouses
                 // No need to set finalWarehousesToSet here with predefined list, as listener will update it.
            } catch (err) {
                console.error(`[Warehouses] Failed to add predefined warehouses for user ${currentUserId}:`, err);
                if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                // If batch fails, ensure local state still has predefined ones as a fallback if fetched is empty
                 if (finalWarehousesToSet.length === 0) {
                     finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
                 }
            } finally {
                if(isMountedRef.current) setIsSyncing(false);
            }
        } else if (isInitialFetchForUser) {
             isInitialFetchForUser = false; 
             isInitialFetchDoneForUserWarehouses.current[currentUserId] = true;
        }
        
        if (finalWarehousesToSet.some(w => w.id === DEFAULT_WAREHOUSE_ID)) {
            finalWarehousesToSet = [
                finalWarehousesToSet.find(w => w.id === DEFAULT_WAREHOUSE_ID)!,
                ...finalWarehousesToSet.filter(w => w.id !== DEFAULT_WAREHOUSE_ID)
            ];
        } else if (finalWarehousesToSet.length === 0 && PREDEFINED_WAREHOUSES_LIST.some(pw => pw.id === DEFAULT_WAREHOUSE_ID)) {
             finalWarehousesToSet.unshift({id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME});
        } else if (finalWarehousesToSet.length === 0 && isMountedRef.current && !db) { 
            finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
        }


        finalWarehousesToSet = finalWarehousesToSet.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); 

        if(isMountedRef.current) setWarehouses(finalWarehousesToSet);

        const storedWarehouseIdKey = `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`;
        let storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
        
        let currentSelectionIsValid = finalWarehousesToSet.some(w => w.id === storedWarehouseId);

        if (!currentSelectionIsValid) {
            const mainExistsInFinalList = finalWarehousesToSet.find(w => w.id === DEFAULT_WAREHOUSE_ID);
            const newCurrentId = mainExistsInFinalList ? DEFAULT_WAREHOUSE_ID : (finalWarehousesToSet[0]?.id || DEFAULT_WAREHOUSE_ID);
            if(isMountedRef.current && currentWarehouseId !== newCurrentId) setCurrentWarehouseId(newCurrentId);
            setLocalStorageItem(storedWarehouseIdKey, newCurrentId);
        } else {
             if(isMountedRef.current && currentWarehouseId !== storedWarehouseId) setCurrentWarehouseId(storedWarehouseId);
        }
    }, (error) => { 
        console.error("[Warehouses] Firestore subscription error:", error);
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Red (Almacenes)", description: "No se pudo conectar para obtener almacenes."}));
            let localFallbackWarehouses = [...PREDEFINED_WAREHOUSES_LIST].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
            setWarehouses(localFallbackWarehouses);
            const storedWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${LOGIN_USER}`;
            const storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(localFallbackWarehouses.some(w => w.id === storedWarehouseId) ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
        }
    });
    return () => {
        unsubscribe();
    };
  }, [currentUserId, toast, isAuthenticated]); 


  // Counting List (Firestore as MASTER, localStorage as CACHE for current user/warehouse)
  useEffect(() => {
    if (!currentUserId || !currentWarehouseId || !isAuthenticated || !db) {
        const localKey = currentUserId && currentWarehouseId ? `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}` : null;
        if (localKey && isMountedRef.current) {
            const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
            startTransition(() => { setCountingList(localList); });
            console.log(`[CountingList] No Firestore. Loaded ${localList.length} items from localStorage for ${currentWarehouseId}.`);
        } else if (isMountedRef.current) {
             startTransition(() => { setCountingList([]); });
             console.log(`[CountingList] No Firestore. Cleared counting list.`);
        }
        if (isMountedRef.current && isSyncing) setIsSyncing(false);
        return () => {}; 
    }
    
    if(isMountedRef.current) setIsSyncing(true); 
    console.log(`[CountingList] Subscribing to Firestore for warehouse '${currentWarehouseId}', user '${currentUserId}'`);
    
    const localKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
    
    const unsubscribeFirestore = subscribeToCountingList(
      currentUserId, 
      currentWarehouseId, 
      (productsFromFirestore) => { 
        if (isMountedRef.current) {
            startTransition(() => { setCountingList(productsFromFirestore); });
            setLocalStorageItem(localKey, productsFromFirestore); 
            console.log(`[CountingList] Firestore update: ${productsFromFirestore.length} items for ${currentWarehouseId}. Synced to localStorage.`);
            if (isSyncing) setIsSyncing(false); 
        }
      }, 
      (error) => { 
        if (isMountedRef.current) {
            console.warn(`[CountingList] Firestore subscription error for warehouse '${currentWarehouseId}'. Error: ${error.message}. Using localStorage as fallback.`);
            if (isSyncing) setIsSyncing(false); 
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Conteo)", description: "No se pudo conectar. Usando datos locales si existen."}));
            const localListFromStorage = getLocalStorageItem<DisplayProduct[]>(localKey, []); // Attempt to load from localStorage on error
            startTransition(() => { setCountingList(localListFromStorage); });
        }
      }
    );

    return () => {
        console.log(`[CountingList] Unsubscribing from Firestore for warehouse '${currentWarehouseId}', user '${currentUserId}'`);
        unsubscribeFirestore();
        if (isMountedRef.current && isSyncing) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, toast, isAuthenticated, db]); // Added db dependency


  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
    if (!warehouseId) return 'N/A';
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : `Almacén (${warehouseId.substring(0,6)}...)`;
  }, [warehouses]);

  const showDiscrepancyToastIfNeeded = useCallback((product: DisplayProduct, newCountVal?: number) => {
    const countToCheck = newCountVal !== undefined ? newCountVal : (product.count ?? 0);
    const stockToCheck = product.stock ?? 0;

    if (stockToCheck > 0 && countToCheck !== stockToCheck) {
        if (isMountedRef.current && activeSection !== 'Contador') { 
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


 const handleAddProduct = useCallback(async (scannedBarcode?: string) => {
    if (!isMountedRef.current) return;
    const rawBarcode = scannedBarcode ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "default", title: "Código vacío" }); });
      requestAnimationFrame(() => { if (isMountedRef.current && !scannedBarcode) { setBarcode(""); focusBarcodeIfCounting(); }});
      return;
    }
    if (!currentWarehouseId || !currentUserId) {
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén o no hay usuario activo." }); });
        return;
    }

     if (trimmedBarcode === lastScannedBarcode && !scannedBarcode) { 
         requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
         return;
     }
     if(isMountedRef.current) {
        if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
        setLastScannedBarcode(trimmedBarcode);
        lastScannedTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setLastScannedBarcode(null); }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }

    if(isMountedRef.current && db) setIsSyncing(true); 
    let dataForFirestore: DisplayProduct | null = null; 
    
    const existingProductInList = countingList.find((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    try {
        if (existingProductInList) {
            dataForFirestore = {
                ...existingProductInList,
                count: (existingProductInList.count ?? 0) + 1,
                lastUpdated: new Date().toISOString(), 
            };
            playBeep(880, 100);
        } else {
            const barcodeToLookup = trimmedBarcode;
            console.log(`[handleAddProduct] Buscando código: "'${barcodeToLookup}'" (longitud: ${barcodeToLookup.length})`);
            
            let catalogProd: ProductDetail | undefined = catalogProducts.find(cp => cp.barcode === barcodeToLookup);
            
            if (!catalogProd && isMountedRef.current) {
                console.log(`[handleAddProduct] Código '${barcodeToLookup}' no encontrado en catalogProducts (estado). Intentando IndexedDB como fallback...`);
                catalogProd = await getProductFromIndexedDB(barcodeToLookup); 
            }
            console.log(`[handleAddProduct] Resultado para '${barcodeToLookup}':`, JSON.parse(JSON.stringify(catalogProd || {})));

            let baseProductData: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'count' | 'lastUpdated' | 'firestoreLastUpdated'>;
            if (catalogProd && catalogProd.barcode) { 
                 baseProductData = {
                    description: catalogProd.description || `Producto ${trimmedBarcode}`,
                    provider: catalogProd.provider || "Desconocido",
                    stock: catalogProd.stock ?? 0,
                    expirationDate: catalogProd.expirationDate || null,
                };
                playBeep(660, 150);
            } else {
                 baseProductData = {
                    description: `Producto desconocido ${trimmedBarcode}`,
                    provider: "Desconocido",
                    stock: 0,
                    expirationDate: null,
                };
                playBeep(440, 300);
                if(isMountedRef.current && activeSection === 'Contador'){ 
                    requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Producto Desconocido", description: `Agregado temporalmente. Edita en 'Catálogo'.`}); });
                }
            }
            dataForFirestore = {
                ...baseProductData,
                barcode: trimmedBarcode,
                warehouseId: currentWarehouseId, 
                count: 1,
                lastUpdated: new Date().toISOString(), 
            };
        }
        console.log("[handleAddProduct] Objeto a enviar a setCountingListItem:", JSON.parse(JSON.stringify(dataForFirestore || {})));

        if (dataForFirestore && currentUserId && currentWarehouseId && db) { 
             if (!dataForFirestore.barcode || dataForFirestore.barcode.trim() === "") {
                playBeep(220, 500); 
                console.error("[handleAddProduct] Error: Attempting to save product with invalid barcode to Firestore:", dataForFirestore);
                requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error Interno", description: "Código de barras inválido al agregar."}); });
                if (isMountedRef.current) setIsSyncing(false);
                return;
            }
            await setCountingListItem(currentUserId, currentWarehouseId, dataForFirestore);
            // UI update will come from Firestore listener
        } else if (!db && isMountedRef.current && dataForFirestore) { 
            startTransition(() => {
                const updatedList = existingProductInList 
                    ? countingList.map(p => p.barcode === dataForFirestore!.barcode && p.warehouseId === currentWarehouseId ? dataForFirestore! : p) 
                    : [...countingList, dataForFirestore!].sort((a,b) => (new Date(b.lastUpdated || 0)).getTime() - (new Date(a.lastUpdated || 0)).getTime());
                setCountingList(updatedList); 
                if (currentUserId && currentWarehouseId) { 
                    setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, updatedList);
                }
            });
             requestAnimationFrame(() => toast({ title: "Guardado Localmente (Offline)", description: "El cambio se guardó localmente. Se sincronizará cuando haya conexión." }));
        }
    } catch (error: any) {
        playBeep(220, 500); 
        console.error("Error fetching or adding product:", error);
        if (isMountedRef.current) {
          requestAnimationFrame(() => {
            if (isMountedRef.current) {
              toast({ variant: "destructive", title: "Error de Sincronización", description: `No se pudo guardar el producto. ${error.message}` });
            }
          });
        }
    } finally {
        if (isMountedRef.current && db) { 
             setIsSyncing(false);
        }
    }

    if (!scannedBarcode && isMountedRef.current) { 
        requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
    } else if (scannedBarcode && isMountedRef.current) { 
        requestAnimationFrame(() => { focusBarcodeIfCounting(); });
    }
  }, [
    barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, 
    focusBarcodeIfCounting, activeSection, catalogProducts, 
    setBarcode, setIsSyncing, setLastScannedBarcode, startTransition, 
    setCountingList, getProductFromIndexedDB,
  ]);
  

  const handleBarcodeScannedFromCamera = useCallback((scannedBarcode: string) => {
    if (isMountedRef.current && activeSection === 'Contador Cámara' && isActivelyScanningByButton) {
      handleAddProduct(scannedBarcode);
    }
  }, [activeSection, isActivelyScanningByButton, handleAddProduct]); 


 const modifyProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar: falta información de usuario/almacén."}));
        return;
    }
    
    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto no encontrado en la lista actual.`}));
         return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    const calculatedNewValue = Math.max(0, originalValue + change); 
    
    const needsConfirmation = type === 'count' && 
                          productInList.stock !== undefined && 
                          productInList.stock !== 0 && 
                          calculatedNewValue > productInList.stock && 
                          originalValue <= productInList.stock; 


    if (needsConfirmation) { 
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement'); 
            setConfirmQuantityNewValue(calculatedNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100); 
        return; 
    }
    
    if(isMountedRef.current && db) setIsSyncing(true);
    try {
        let updatedProductDataForFirestore: DisplayProduct;

        if (type === 'count') {
             updatedProductDataForFirestore = {
                ...productInList,
                count: calculatedNewValue,
                lastUpdated: new Date().toISOString(),
            };
            if (db) { 
                await setCountingListItem(currentUserId, currentWarehouseId, updatedProductDataForFirestore);
                 // UI update will come from Firestore listener
            } else { 
                startTransition(() => {
                    const updatedList = countingList.map(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId ? updatedProductDataForFirestore : p).sort((a,b) => (new Date(b.lastUpdated || 0)).getTime() - (new Date(a.lastUpdated || 0)).getTime());
                    setCountingList(updatedList);
                    setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, updatedList);
                });
                requestAnimationFrame(() => toast({ title: "Guardado Localmente (Offline)" }));
            }
        } else { // type === 'stock'
            if (!db || !currentUserId) { // Added !currentUserId check
                if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar stock del catálogo sin conexión o usuario."}));
                if(isMountedRef.current) setIsSyncing(false);
                return;
            }
            let catalogProdToUpdate = catalogProducts.find(cp => cp.barcode === productBarcode);
            if (!catalogProdToUpdate && isMountedRef.current) { 
                catalogProdToUpdate = await getProductFromIndexedDB(productBarcode);
            }

            if (catalogProdToUpdate) {
                const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: calculatedNewValue };
                await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); // Update Firestore catalog
                await addOrUpdateProductToIndexedDB(updatedMasterProduct); // Update IndexedDB cache
                await synchronizeAndLoadCatalog(); // Refresh catalogProducts state from Firestore
            } else {
                console.warn(`[modifyProductValue] Producto ${productBarcode} no encontrado en catálogo para actualizar stock maestro.`);
            }
            updatedProductDataForFirestore = { 
                ...productInList,
                stock: calculatedNewValue, 
                lastUpdated: new Date().toISOString(),
            };
            if (db) await setCountingListItem(currentUserId, currentWarehouseId, updatedProductDataForFirestore);
        }
        
        if (type === 'count' && activeSection !== 'Contador') { 
            showDiscrepancyToastIfNeeded(productInList, calculatedNewValue);
        }
    } catch (error: any) {
        console.error("Error modifying product value:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current && db) { 
             setIsSyncing(false);
        }
    }
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
  }, [
    currentWarehouseId, currentUserId, toast, countingList, activeSection,
    synchronizeAndLoadCatalog, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting,
    catalogProducts, getProductFromIndexedDB, addOrUpdateProductToIndexedDB,
    setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction,
    setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen, startTransition, setCountingList,
    addOrUpdateProductInCatalog,
  ]);


const handleSetProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', newValue: number, sumValue: boolean = false) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar: falta información de usuario/almacén."}));
        return;
    }
    
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Producto no encontrado en la lista." }));
      if(isMountedRef.current) setOpenModifyDialog(null);
      return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    if (type === 'count' && !sumValue && newValue === originalValue && !isConfirmQuantityDialogOpen) { 
        if(isMountedRef.current) setOpenModifyDialog(null);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    const finalNewValue = Math.max(0, calculatedValue); 

    const needsConfirmation = type === 'count' && 
                            productInList.stock !== undefined && 
                            productInList.stock !== 0 && 
                            finalNewValue > productInList.stock && 
                            (!sumValue || originalValue <= productInList.stock); 


    if (needsConfirmation && !isConfirmQuantityDialogOpen) { 
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction('set'); 
            setConfirmQuantityNewValue(finalNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100);
        return; 
    }
    
    if(isMountedRef.current && db) setIsSyncing(true);
    try {
        let updatedProductDataForFirestore: DisplayProduct;
        if (type === 'count') {
            updatedProductDataForFirestore = {
                ...productInList,
                count: finalNewValue,
                lastUpdated: new Date().toISOString(),
            };
            if (db) {
                await setCountingListItem(currentUserId, currentWarehouseId, updatedProductDataForFirestore);
            } else {
                startTransition(() => {
                    const updatedList = countingList.map(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId ? updatedProductDataForFirestore : p).sort((a,b) => (new Date(b.lastUpdated || 0)).getTime() - (new Date(a.lastUpdated || 0)).getTime());
                    setCountingList(updatedList);
                    setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, updatedList);
                });
                requestAnimationFrame(() => toast({ title: "Guardado Localmente (Offline)" }));
            }
        } else { // type === 'stock'
            if (!db || !currentUserId) { // Added !currentUserId check
                if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar stock del catálogo sin conexión o usuario."}));
                if(isMountedRef.current) setIsSyncing(false);
                return;
            }
            let catalogProdToUpdate = catalogProducts.find(cp => cp.barcode === productBarcode);
            if (!catalogProdToUpdate && isMountedRef.current) {
                catalogProdToUpdate = await getProductFromIndexedDB(productBarcode);
            }

            if (catalogProdToUpdate) {
                const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: finalNewValue };
                await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); 
                await addOrUpdateProductToIndexedDB(updatedMasterProduct); 
                await synchronizeAndLoadCatalog(); 
            } else {
                 console.warn(`[handleSetProductValue] Producto ${productBarcode} no encontrado en catálogo para actualizar stock maestro.`);
            }
             updatedProductDataForFirestore = {
                ...productInList,
                stock: finalNewValue, 
                lastUpdated: new Date().toISOString(),
            };
            if (db) await setCountingListItem(currentUserId, currentWarehouseId, updatedProductDataForFirestore);
        }
        
        if (type === 'count' && activeSection !== 'Contador') {
            showDiscrepancyToastIfNeeded(productInList, finalNewValue);
        } else if (type === 'stock') {
             requestAnimationFrame(() => toast({ title: "Stock Actualizado" }));
        }
    } catch (error: any) {
        console.error("Error setting product value:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current && db) {
             setIsSyncing(false);
        }
    }

    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
}, [
    toast, countingList, focusBarcodeIfCounting, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen,
    activeSection, synchronizeAndLoadCatalog, showDiscrepancyToastIfNeeded, catalogProducts,
    getProductFromIndexedDB, addOrUpdateProductToIndexedDB, // Ensure addOrUpdateProductToIndexedDB is here
    setIsSyncing, setOpenModifyDialog, setConfirmQuantityProductBarcode, setConfirmQuantityAction,
    setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen, startTransition, setCountingList,
    addOrUpdateProductInCatalog,
]);


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
    
    if(isMountedRef.current && db) setIsSyncing(true);
    try {
        const updatedProductForFirestore: DisplayProduct = {
            ...productInList,
            count: finalConfirmedCount,
            lastUpdated: new Date().toISOString(),
        };
        if (db) {
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
        } else {
             startTransition(() => {
                const updatedList = countingList.map(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId ? updatedProductForFirestore : p).sort((a,b) => (new Date(b.lastUpdated || 0)).getTime() - (new Date(a.lastUpdated || 0)).getTime());
                setCountingList(updatedList);
                setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, updatedList);
            });
        }
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Cantidad Modificada" }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current){
            if (db) setIsSyncing(false);
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
    toast, countingList, focusBarcodeIfCounting,
    setIsSyncing, setIsConfirmQuantityDialogOpen, setConfirmQuantityProductBarcode, setConfirmQuantityAction, 
    setConfirmQuantityNewValue, setOpenModifyDialog, startTransition, setCountingList
]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
    if(isMountedRef.current) setProductToDelete(product);
    if(isMountedRef.current) setIsDeleteDialogOpen(true);
  }, [setProductToDelete, setIsDeleteDialogOpen]);

 const confirmDelete = useCallback(async () => {
    if (!isMountedRef.current || !productToDelete || !currentUserId || !currentWarehouseId) return;
    const {barcode: barcodeForToast, description: descriptionForToast } = productToDelete;
    
    if(isMountedRef.current && db) setIsSyncing(true);
    try {
        if (db) {
            await deleteCountingListItem(currentUserId, currentWarehouseId, barcodeForToast);
        } else {
            startTransition(() => {
                const updatedList = countingList.filter(p => !(p.barcode === barcodeForToast && p.warehouseId === currentWarehouseId));
                setCountingList(updatedList);
                setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, updatedList);
            });
        }
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó de la lista actual.` }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current){
            if (db) setIsSyncing(false);
            setIsDeleteDialogOpen(false);
            setProductToDelete(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    productToDelete, toast, focusBarcodeIfCounting, currentUserId, currentWarehouseId, countingList,
    setIsSyncing, setIsDeleteDialogOpen, setProductToDelete, startTransition, setCountingList
]);

 const handleClearCurrentList = useCallback(async () => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return;
    if(isMountedRef.current && db) setIsSyncing(true);
    try {
        if (db) {
            await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        } else {
             startTransition(() => {
                setCountingList([]);
                setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, []);
            });
        }
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Lista Borrada" }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current) {
            if (db) setIsSyncing(false);
            setIsDeleteListDialogOpen(false);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId,
    setIsSyncing, setIsDeleteListDialogOpen, startTransition, setCountingList,
    clearCountingListForWarehouseInFirestore, 
  ]);

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
    if (!currentUserId || !currentWarehouseId || !isMountedRef.current) return;
    if (!db) { 
        requestAnimationFrame(() => toast({ title: "Modo Offline", description: "No se puede actualizar stock desde la nube sin conexión."}));
        return;
    }
    if (!catalogProducts || catalogProducts.length === 0) {
        requestAnimationFrame(() => toast({ title: "Catálogo Vacío", description: "No hay productos en el catálogo para referenciar." }));
        return;
    }
    if(isMountedRef.current) { setIsRefreshingStock(true); setIsSyncing(true); }
    let updatedProductCount = 0;
    
    try {
        const currentWarehouseItems = countingList.filter(item => item.warehouseId === currentWarehouseId);
        const productsToUpdateInFirestore: DisplayProduct[] = [];

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
                        ...countingProduct,
                        description: catalogProd.description,
                        provider: catalogProd.provider,
                        stock: catalogProd.stock ?? 0,
                        expirationDate: catalogProd.expirationDate || null,
                        lastUpdated: new Date().toISOString(), 
                    });
                }
            }
        });
        
        if (productsToUpdateInFirestore.length > 0 && db && currentUserId) { // Added currentUserId check
            const batch = writeBatch(db); 
            productsToUpdateInFirestore.forEach(itemToUpdate => {
                if (!itemToUpdate.barcode) return; 
                const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), itemToUpdate.barcode);
                const { barcode, warehouseId, ...dataToSet } = { ...itemToUpdate, firestoreLastUpdated: serverTimestamp() };
                batch.set(docRef, dataToSet, { merge: true }); 
            });
            await batch.commit();
        }


        if(updatedProductCount > 0 && isMountedRef.current) {
            if(db) requestAnimationFrame(() => toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) en la lista.` }));
        } else if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Los productos en la lista ya están actualizados con el catálogo." }));
        }
    } catch (error: any) {
         if (!isMountedRef.current) return;
         requestAnimationFrame(() => {
           if (isMountedRef.current) { 
             toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
           }
         });
    } finally {
         if (isMountedRef.current) { setIsRefreshingStock(false); setIsSyncing(false); }
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId, countingList, catalogProducts,
    setIsRefreshingStock, setIsSyncing 
]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
    if(isMountedRef.current) setOpenModifyDialog({ type, product });
 }, [setOpenModifyDialog]);

 const handleCloseModifyDialog = () => {
    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
 };

  const handleAddOrUpdateCatalogProduct = useCallback(async (productData: ProductDetail) => {
    if (!isMountedRef.current || !currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede guardar en catálogo sin conexión o usuario."}));
        return;
    }
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); setProcessingStatus("Guardando en catálogo..."); }
    try {
        await addOrUpdateProductInCatalog(currentUserId, productData); 
        await addOrUpdateProductToIndexedDB(productData); 
        await synchronizeAndLoadCatalog(); 
        if(isMountedRef.current) { 
            requestAnimationFrame(() => toast({title: "Producto Guardado en Catálogo"}));
            setProcessingStatus("Producto guardado en catálogo.");
            setIsEditDetailDialogOpen(false); 
            setProductToEditDetail(null); 
        }
    } catch (error: any) {
         if (!isMountedRef.current) return;
         setProcessingStatus(`Error al guardar: ${error.message}`);
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo guardar: ${error.message}` }));
    } finally {
         if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); }
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [
    currentUserId, toast, focusBarcodeIfCounting, synchronizeAndLoadCatalog,
    addOrUpdateProductInCatalog, addOrUpdateProductToIndexedDB,
    setIsDbLoading, setIsSyncing, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail 
  ]);

  const handleDeleteCatalogProduct = useCallback(async (barcodeToDelete: string) => {
    if (!isMountedRef.current || !currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede eliminar del catálogo sin conexión o usuario."}));
        return;
    }
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); setProcessingStatus("Eliminando de catálogo..."); }
    try {
        await deleteProductFromCatalog(currentUserId, barcodeToDelete); 
        await deleteProductFromIndexedDB(barcodeToDelete); 
        await synchronizeAndLoadCatalog(); 
        if(isMountedRef.current) { 
            requestAnimationFrame(() => toast({title: "Producto Eliminado del Catálogo"}));
            setProcessingStatus("Producto eliminado del catálogo.");
            setIsEditDetailDialogOpen(false); 
            setProductToEditDetail(null); 
        }
    } catch (error: any) {
        if (!isMountedRef.current) return;
        setProcessingStatus(`Error al eliminar: ${error.message}`);
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [
    currentUserId, toast, focusBarcodeIfCounting, synchronizeAndLoadCatalog,
    deleteProductFromCatalog, deleteProductFromIndexedDB, 
    setIsDbLoading, setIsSyncing, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail 
  ]);

  const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current || !currentUserId || !db) {
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede borrar el catálogo sin conexión o usuario."}));
        return;
    }
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); setProcessingStatus("Borrando catálogo..."); } 
    try {
      await clearProductCatalogInFirestore(currentUserId); 
      await clearProductDatabase(); 
      await synchronizeAndLoadCatalog(); 
      if(isMountedRef.current) {
          requestAnimationFrame(() => toast({ title: "Catálogo Borrado" }));
          setProcessingStatus("Catálogo borrado.");
      }
    } catch (error: any) {
      if(isMountedRef.current) {
          setProcessingStatus(`Error al borrar: ${error.message}`);
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: `No se pudieron borrar datos: ${error.message}` }));
      }
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); setIsClearCatalogConfirmOpen(false); }
      requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [
    currentUserId, toast, focusBarcodeIfCounting, synchronizeAndLoadCatalog,
    clearProductCatalogInFirestore, clearProductDatabase, 
    setIsDbLoading, setIsSyncing, setProcessingStatus, setIsClearCatalogConfirmOpen 
  ]);

  const handleGoogleSheetLoadToCatalog = useCallback(async (sheetUrlOrId: string) => {
    if (!isAuthenticated || !currentUserId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Debe iniciar sesión y estar conectado para cargar el catálogo." }));
      return;
    }
    if (!sheetUrlOrId) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido", description: "Por favor, ingrese la URL o ID de la Hoja de Google." }));
      return;
    }

    if (isMountedRef.current) {
        setIsDbLoading(true);
        setIsSyncing(true);
        setProcessingStatus("Cargando datos desde Google Sheet...");
    }

    try {
      const productsFromSheet = await fetchGoogleSheetData(sheetUrlOrId);
      if (productsFromSheet.length > 0 && currentUserId) {
        await addProductsToCatalog(currentUserId, productsFromSheet); // Save to Firestore
        await synchronizeAndLoadCatalog(); // Refresh catalog from Firestore, which updates IndexedDB
        if (isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({ title: "Catálogo Actualizado", description: `${productsFromSheet.length} productos cargados desde Google Sheet.` });
            });
            setProcessingStatus("Carga desde Google Sheet completada.");
        }
      } else if (!currentUserId) {
        throw new Error("Usuario no autenticado para guardar el catálogo.");
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
      }
    }
  }, [
    isAuthenticated, currentUserId, toast, synchronizeAndLoadCatalog, addProductsToCatalog,
    setIsDbLoading, setIsSyncing, setProcessingStatus
  ]);


 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct | ProductDetail) => {
    if (!product || !product.barcode || !isMountedRef.current || !currentUserId) return;
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        let productDataToEdit: ProductDetail | undefined;
        if (db) { 
            productDataToEdit = await getProductFromCatalog(currentUserId, product.barcode);
        }
        
        if (!productDataToEdit && isMountedRef.current) { 
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
                 expirationDate: 'expirationDate' in product ? (product.expirationDate || null) : null,
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
 }, [
    toast, currentUserId,
    getProductFromCatalog, getProductFromIndexedDB, 
    setProductToEditDetail, setIsEditDetailDialogOpen, setIsDbLoading 
]);


 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
    if (!isMountedRef.current || !productToEditDetail || !currentUserId) return;
    await handleAddOrUpdateCatalogProduct({ ...productToEditDetail, ...data }); 
 }, [handleAddOrUpdateCatalogProduct, productToEditDetail, currentUserId]);


 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Falta información de usuario/almacén o conexión a DB." }));
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
            const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), dbProduct.barcode);
            const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'lastUpdated'> & { firestoreLastUpdated: any } = {
               description: dbProduct.description,
               provider: dbProduct.provider,
               stock: dbProduct.stock ?? 0,
               expirationDate: dbProduct.expirationDate || null,
               count: 0, 
               firestoreLastUpdated: serverTimestamp(),
            };
            batch.set(docRef, dataToSet); 
        });
        await batch.commit();
        
        if (isMountedRef.current) {
            setActiveSection("Contador"); 
            requestAnimationFrame(() => { 
                if (isMountedRef.current) setSearchTerm(""); 
            });
            requestAnimationFrame(() => toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos con conteo 0.` }));
            setProcessingStatus("Conteo por proveedor iniciado.");
        }
    } catch (error: any) {
        console.error("Error starting count by provider:", error);
        if (isMountedRef.current) {
            setProcessingStatus(`Error: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: `No se pudo iniciar el conteo por proveedor. ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsSyncing(false); setProcessingStatus(""); }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [
    toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, currentUserId,
    clearCountingListForWarehouseInFirestore, 
    setIsSyncing, setSearchTerm, setProcessingStatus
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
          if (isMountedRef.current && !isCameraScanMode) setIsCameraScanMode(true); 
      } else {
          if (isMountedRef.current && isCameraScanMode) setIsCameraScanMode(false); 
      }
    }
  }, [setActiveSection, focusBarcodeIfCounting, isCameraScanMode, setIsCameraScanMode]); 

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
    currentWarehouseId, startTransition, currentUserId, setCurrentWarehouseId, setSearchTerm 
  ]);

    const handleAddWarehouse = useCallback(async (name: string) => {
      if (!isMountedRef.current || !currentUserId || !name.trim() || !db) {
          requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede agregar: falta información o conexión a DB.' }));
          return;
      }
      const generatedId = `wh_${format(new Date(), 'yyyyMMdd_HHmmssSSS')}`;
      const newWarehouse: Warehouse = { id: generatedId, name: name.trim().toUpperCase() }; 
      
      const isDuplicateName = warehouses.some(warehouse => warehouse.name.toLowerCase() === newWarehouse.name.toLowerCase());
      if (isDuplicateName) {
          requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'Nombre de almacén ya existe.' }));
          return;
      }
      if(isMountedRef.current) setIsSyncing(true);
      try {
          await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
          requestAnimationFrame(() => toast({title: "Almacén Agregado", description: `Almacén "${newWarehouse.name}" creado.`}));
      } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo agregar el almacén. ${error.message}` }));
      } finally {
          if(isMountedRef.current) setIsSyncing(false);
      }
    }, [
        warehouses, currentUserId, toast, 
        addOrUpdateWarehouseInFirestore, 
        setIsSyncing 
    ]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) {
            requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede actualizar: falta información o conexión a DB.' }));
            return;
       }
       if(isMountedRef.current) setIsSyncing(true);
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, { ...warehouseToUpdate, name: warehouseToUpdate.name.toUpperCase() }); 
           if(isMountedRef.current) requestAnimationFrame(() => toast({ title: `Almacén "${warehouseToUpdate.name.toUpperCase()}" Actualizado` }));
       } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo actualizar el almacén. ${error.message}` }));
       } finally {
            if(isMountedRef.current) setIsSyncing(false);
       }
   }, [
    toast, currentUserId, 
    addOrUpdateWarehouseInFirestore, 
    setIsSyncing 
  ]);

   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
    if (!isMountedRef.current || !currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede eliminar: falta información o conexión a DB.' }));
        return;
    }
    if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
      requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Operación no permitida', description: "Almacén Principal no se puede eliminar." }));
      return;
    }
    const warehouseBeingDeleted = warehouses.find(w => w.id === warehouseIdToDelete);
    if(isMountedRef.current) setIsSyncing(true);
    try {
      await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
      if(isMountedRef.current && warehouseBeingDeleted) requestAnimationFrame(() => toast({ title: "Almacén Eliminado", description: `"${warehouseBeingDeleted.name}" eliminado.`}));
      // Logic to switch to default warehouse if current one is deleted is handled in the subscribeToWarehouses effect
    } catch (error: any) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo eliminar el almacén. ${error.message}` }));
    } finally {
      if(isMountedRef.current) setIsSyncing(false);
    }
  }, [
    toast, currentUserId, warehouses,
    deleteWarehouseFromFirestore, 
    setIsSyncing 
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
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${userIdToClear}`) || 
                    (key.startsWith(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}`) && key.endsWith(`_${userIdToClear}`))) {
                    localStorage.removeItem(key);
                }
            });
        }
        startTransition(() => {
            setCountingList([]);
            setCatalogProducts([]); 
            setWarehouses([{ id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME }]); 
            setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
        });
        isInitialFetchDoneForUserWarehouses.current = {}; 
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
            isInitialFetchDoneForUserWarehouses.current = {}; 
            setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, LOGIN_USER);
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
    <div className="flex h-screen bg-background text-foreground">
      <div
        className={cn(
          "fixed top-0 left-0 w-full h-1 z-[60] transition-all duration-300 ease-in-out", 
          isSyncing ? "bg-primary animate-pulse" : "bg-muted/30" 
        )}
        title={isSyncing ? "Sincronizando con la nube..." : "Conectado"}
      />

      {isMobile ? (
        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="fixed top-4 left-4 z-50 md:hidden bg-card/80 backdrop-blur-sm">
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
          <div id="contador-content" className="space-y-4 h-full flex flex-col">
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
          <div id="contador-camara-content" className="flex flex-col h-full space-y-4">
            <div className="h-1/2 md:h-2/5 border rounded-lg overflow-hidden relative">
                <BarcodeScannerCamera
                    onBarcodeScanned={handleBarcodeScannedFromCamera}
                    isScanningActive={activeSection === 'Contador Cámara'} 
                    isDecodingActive={isActivelyScanningByButton} 
                />
                {activeSection === 'Contador Cámara' && !isActivelyScanningByButton && ( 
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm text-white p-4 rounded-lg">
                        <ScanLine className="h-16 w-16 mb-4 text-primary" />
                        <p className="text-lg font-semibold">Escaneo Pausado</p>
                        <p className="text-sm text-center">Mantén presionado el botón de abajo para escanear.</p>
                    </div>
                )}
            </div>

             {activeSection === 'Contador Cámara' && ( 
                <div className="flex justify-center py-2">
                    <Button
                        onMouseDown={handleScanButtonPress}
                        onMouseUp={handleScanButtonRelease}
                        onTouchStart={handleScanButtonPress}
                        onTouchEnd={handleScanButtonRelease}
                        variant="outline"
                        className={cn(
                            "p-4 rounded-full h-20 w-20 flex items-center justify-center transition-all duration-150 ease-in-out",
                            isActivelyScanningByButton 
                                ? "bg-primary text-primary-foreground scale-110 shadow-lg" 
                                : "bg-card hover:bg-muted"
                        )}
                        title="Mantener presionado para escanear"
                    >
                        <Scan className={cn("h-10 w-10", isActivelyScanningByButton ? "text-primary-foreground" : "text-primary")} />
                    </Button>
                </div>
            )}


            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Button
                onClick={handleRefreshStock}
                variant="outline"
                className="h-10 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900"
                disabled={isDbLoading || isRefreshingStock || isTransitionPending}
                title="Actualizar datos de stock desde el catálogo"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingStock ? 'animate-spin' : ''}`} />
                Actualizar Stock
              </Button>
              <div className="relative flex-grow">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Buscar en lista actual..."
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
        
         {activeSection === 'Catálogo de Productos' && isAuthenticated && currentUserId && (
            <div id="database-content">
               <ProductDatabaseComponent
                  userId={currentUserId}
                  catalogProducts={catalogProducts} 
                  isLoadingCatalog={isDbLoading} 
                  onAddOrUpdateProduct={handleAddOrUpdateCatalogProduct}
                  onDeleteProduct={handleDeleteCatalogProduct}
                  onLoadFromGoogleSheet={handleGoogleSheetLoadToCatalog}
                  onClearCatalogRequest={() => { if (isMountedRef.current) setIsClearCatalogConfirmOpen(true); }}
                  onStartCountByProvider={handleStartCountByProvider}
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
                    isLoading={isSyncing || isDbLoading} 
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
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos del catálogo (Firestore y caché local IndexedDB).</p>
                    <p>Esta acción no se puede deshacer.</p>
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
    </div>
  );
}


    