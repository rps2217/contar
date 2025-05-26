
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
import { BarcodeEntry } from '@/components/barcode-entry';
import { CounterSection } from '@/components/counter-section';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { EditProductDialog } from '@/components/edit-product-dialog';
import { CountingListTable } from '@/components/counting-list-table'; // Added import


import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock,
  BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide,
  LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert,
  Filter, Download, Edit, Library, X, Camera
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo, useTransition } from "react";
import { playBeep } from '@/lib/helpers';
import { ModifyValueDialog } from '@/components/modify-value-dialog';

// IndexedDB functions for Product Catalog and local history
import {
  getProductFromDB as getProductFromIndexedDB,
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  clearProductDatabase,
  addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database'; // Using IndexedDB for product catalog

// Firestore functions (for CountingList and Warehouses)
import {
  subscribeToWarehouses, // Still using Firestore for warehouses for multi-device sync if login is shared
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  setCountingListItem,
  deleteCountingListItem,
  clearCountingListForWarehouseInFirestore,
  subscribeToCountingList,
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
import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera';


// Firebase db instance for Firestore operations (history, warehouses)
// The db import is used by firestore-service.ts, so ensure it's correctly initialized in firebase.ts
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';

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
  } from '@/lib/constants';


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
                    console.log("[fetchGoogleSheetData] CSV data has only header or is empty.");
                    resolve(products); 
                    return;
                }
                
                const BARCODE_COLUMN_INDEX = 0;
                const DESCRIPTION_COLUMN_INDEX = 1;
                const PROVIDER_COLUMN_INDEX = 2; 
                const STOCK_COLUMN_INDEX = 3;
                const EXPIRATION_DATE_COLUMN_INDEX = 4; // Assuming this is the 5th column

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
  const [showUserIdInput, setShowUserIdInput] = useState(false); // For changing user ID in sidebar
  
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
  const [processingStatus, setProcessingStatus] = useState<string>(""); 
  const [isCameraScanMode, setIsCameraScanMode] = useState(false); // For camera scanning mode

  // --- Warehouse State ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => PREDEFINED_WAREHOUSES_LIST);
  const [currentWarehouseId, setCurrentWarehouseId] = useLocalStorage<string>(
      `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId || 'default_user'}`, // Key depends on userId
      DEFAULT_WAREHOUSE_ID
  );
  
  // --- Product Catalog State (IndexedDB as primary) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]); 

  // --- Counting List State (Firestore as primary, localStorage as temporary fallback) ---
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

  const isInitialFetchDoneForUserWarehouses = useRef<Record<string, boolean>>({});
  const isInitialCatalogSyncDoneForUser = useRef<Record<string, boolean>>({}); // Used with IndexedDB

  const toggleCameraScanMode = useCallback(() => {
    setIsCameraScanMode(prev => !prev);
  }, []);

  const handleBarcodeScannedFromCamera = useCallback((scannedBarcode: string) => {
    if (isMountedRef.current) {
        setBarcode(scannedBarcode); // Set the barcode to trigger add
        // Wait a very short moment for setBarcode to propagate if needed by handleAddProduct
        // or pass directly if handleAddProduct can take it.
        // For simplicity, if handleAddProduct uses the 'barcode' state, this is fine.
        // If not, pass scannedBarcode to handleAddProduct.
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                handleAddProduct(scannedBarcode);
            }
        });
    }
  }, []); // Add handleAddProduct when it's stable (useCallback)

  const toggleShowOnlyDiscrepancies = useCallback(() => {
    setShowOnlyDiscrepancies(prev => !prev);
  }, []);

  const focusBarcodeIfCounting = useCallback(() => {
    if (isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara') && barcodeInputRef.current) {
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
  }, [activeSection]); 

  useEffect(() => {
    isMountedRef.current = true;
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId === LOGIN_USER) { // Only auto-login if the stored ID is the known LOGIN_USER
        setCurrentUserId(LOGIN_USER); 
        setIsAuthenticated(true); 
    } else {
        setCurrentUserId(null); 
        setIsAuthenticated(false); 
        if(typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
    }

    // Initial focus attempt
    requestAnimationFrame(() => {
      if (isMountedRef.current) focusBarcodeIfCounting();
    });

    return () => {
      isMountedRef.current = false;
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
    };
  }, [focusBarcodeIfCounting, setCurrentUserId]);


  // Catalog Management using IndexedDB
  const synchronizeAndLoadCatalog = useCallback(async () => {
    if (!isMountedRef.current) {
        console.warn("[SyncCatalog] Skipping: Component not mounted.");
        if(isMountedRef.current) setIsDbLoading(false);
        return;
    }
    console.log("[SyncCatalog] Starting catalog synchronization from IndexedDB.");
    if(isMountedRef.current) setIsDbLoading(true);

    try {
        const localProducts = await getAllProductsFromIndexedDB();
        if (isMountedRef.current) {
            console.log(`[SyncCatalog] Fetched ${localProducts.length} products from IndexedDB.`);
            const first5 = localProducts.slice(0, 5).map(p => ({ b: p.barcode, d: p.description?.substring(0, 15) }));
            console.log("[SyncCatalog] First 5 IndexedDB products (if any):", JSON.parse(JSON.stringify(first5)));
            
            const sortedLocalProducts = localProducts
                .filter(p => p && p.barcode) 
                .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
            setCatalogProducts(sortedLocalProducts);

            const userIdForToast = currentUserId || "default_user_for_catalog_toast";
            if (!isInitialCatalogSyncDoneForUser.current[userIdForToast]) {
                requestAnimationFrame(() => toast({ title: "Catálogo Cargado", description: "Catálogo cargado desde base de datos local."}));
                isInitialCatalogSyncDoneForUser.current[userIdForToast] = true;
            }
        }
    } catch (error: any) {
        console.error("[SyncCatalog] Error during catalog synchronization from IndexedDB:", error.message, error.stack);
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudo cargar el catálogo."}));
            setCatalogProducts([]);
        }
    } finally {
        if (isMountedRef.current) setIsDbLoading(false);
        console.log("[SyncCatalog] Catalog synchronization from IndexedDB finished.");
    }
  }, [toast, currentUserId]); 

  useEffect(() => {
    if (isAuthenticated) { // Load catalog only if authenticated
      synchronizeAndLoadCatalog();
    } else {
      setCatalogProducts([]); 
      if (isMountedRef.current) setIsDbLoading(false); 
    }
  }, [isAuthenticated, synchronizeAndLoadCatalog]);


  // Warehouse Management (Firestore as primary)
  useEffect(() => {
    if (!currentUserId || !db || !isAuthenticated) {
        console.warn("[Warehouses] Skipping Firestore subscription: No currentUserId, Firestore DB not initialized, or not authenticated.");
        if (isMountedRef.current) {
            let localDefaultWarehouses = [...PREDEFINED_WAREHOUSES_LIST];
            // Ensure "Almacén Principal" is always first and present
            if (!localDefaultWarehouses.some(w => w.id === DEFAULT_WAREHOUSE_ID)) {
                 localDefaultWarehouses.unshift({ id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME });
            } else {
                localDefaultWarehouses = [
                    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
                    ...localDefaultWarehouses.filter(w => w.id !== DEFAULT_WAREHOUSE_ID)
                ];
            }
            localDefaultWarehouses = localDefaultWarehouses.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); // Deduplicate
            
            setWarehouses(localDefaultWarehouses);

            const storedWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}default_user`;
            const storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(localDefaultWarehouses.some(w => w.id === storedWarehouseId) ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
        }
        return;
    }

    console.log("[Warehouses] Subscribing to warehouses for user:", currentUserId);
    let isInitialFetchForUser = !isInitialFetchDoneForUserWarehouses.current[currentUserId];

    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehouses) => {
        if (!isMountedRef.current) return;
        
        let finalWarehousesToSet = [...fetchedWarehouses];
        
        // Ensure default warehouses are added to Firestore if they don't exist for the user
        if (isInitialFetchForUser && db && currentUserId) { // Check db and currentUserId again for safety
            isInitialFetchForUser = false; // Mark as done for this user's session
            isInitialFetchDoneForUserWarehouses.current[currentUserId] = true;

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
                    const batch = writeBatch(db); // db is checked to be non-null
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                    console.log("[Warehouses] Predefined warehouses added successfully. Listener will update list.");
                    // No need to manually merge here, onSnapshot will provide the updated list
                } catch (err) {
                    console.error(`[Warehouses] Failed to add predefined warehouses for user ${currentUserId}:`, err);
                    if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                     // If batch fails, we might add them to the local state for UI consistency for this session
                     finalWarehousesToSet = [...finalWarehousesToSet, ...warehousesToAddBatch].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
                } finally {
                    if(isMountedRef.current) setIsSyncing(false);
                }
            }
        }
        
        // Ensure "Almacén Principal" is always first if it exists
        if (finalWarehousesToSet.some(w => w.id === DEFAULT_WAREHOUSE_ID)) {
            finalWarehousesToSet = [
                finalWarehousesToSet.find(w => w.id === DEFAULT_WAREHOUSE_ID)!,
                ...finalWarehousesToSet.filter(w => w.id !== DEFAULT_WAREHOUSE_ID)
            ];
        } else if (finalWarehousesToSet.length > 0 && !db) { // Offline and no default means something is off, force add default locally
            finalWarehousesToSet.unshift({id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME });
        }

        if (finalWarehousesToSet.length === 0 && isMountedRef.current && !db) { // Offline and Firestore was empty
            finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST];
            console.warn("[Warehouses] No warehouses from Firestore (or offline), using local predefined list for UI.");
        }
        finalWarehousesToSet = finalWarehousesToSet.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); // Deduplicate

        if(isMountedRef.current) setWarehouses(finalWarehousesToSet);

        // Restore last selected warehouse for this user, or default to Almacén Principal
        const storedWarehouseIdKey = `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`;
        const storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
        
        let currentSelectionIsValid = finalWarehousesToSet.some(w => w.id === storedWarehouseId);

        if (!currentSelectionIsValid) {
            const mainExistsInFinalList = finalWarehousesToSet.find(w => w.id === DEFAULT_WAREHOUSE_ID);
            const newCurrentId = mainExistsInFinalList ? DEFAULT_WAREHOUSE_ID : (finalWarehousesToSet[0]?.id || DEFAULT_WAREHOUSE_ID); // Fallback to default
            if(isMountedRef.current && currentWarehouseId !== newCurrentId) setCurrentWarehouseId(newCurrentId);
            setLocalStorageItem(storedWarehouseIdKey, newCurrentId);
            console.log(`[Warehouses] Current warehouse selection '${storedWarehouseId}' invalid or not found, changed to '${newCurrentId}'.`);
        } else {
             if(isMountedRef.current && currentWarehouseId !== storedWarehouseId) setCurrentWarehouseId(storedWarehouseId);
        }
    }, (error) => { // onError callback for subscribeToWarehouses
        console.error("[Warehouses] Firestore subscription error:", error);
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Red (Almacenes)", description: "No se pudo conectar para obtener almacenes."}));
            // Fallback to local predefined list if Firestore fails
            let localFallbackWarehouses = [...PREDEFINED_WAREHOUSES_LIST];
            if (!localFallbackWarehouses.some(w => w.id === DEFAULT_WAREHOUSE_ID)) {
                 localFallbackWarehouses.unshift({ id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME });
            }
            setWarehouses(localFallbackWarehouses.filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i));
            
            const storedWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}default_user`;
            const storedWarehouseId = getLocalStorageItem<string>(storedWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(localFallbackWarehouses.some(w => w.id === storedWarehouseId) ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
        }
    });
    return () => {
        if (currentUserId) { // Only log if there was a user
          console.log("[Warehouses] Unsubscribing from warehouses for user:", currentUserId);
        }
        unsubscribe();
    };
  }, [currentUserId, toast, isAuthenticated, setCurrentWarehouseId, currentWarehouseId]); // Added currentWarehouseId to dependencies for consistency in selection logic


  // Counting List (Firestore as primary, localStorage as temporary fallback/cache)
  useEffect(() => {
    const localKey = currentUserId && currentWarehouseId ? `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}` : null;

    // Attempt to load from localStorage first for immediate UI response
    if (localKey && isMountedRef.current) {
        const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
        startTransition(() => { setCountingList(localList); });
    }


    if (!currentUserId || !currentWarehouseId || !db || !isAuthenticated) {
        console.warn(`[CountingList] Skipping Firestore subscription: No currentUserId ('${currentUserId}'), currentWarehouseId ('${currentWarehouseId}'), Firestore DB not init, or not authenticated.`);
        // If no Firestore, the localStorage version (if any) remains. If no localKey, list becomes empty.
        if (!localKey && isMountedRef.current) {
             startTransition(() => { setCountingList([]); });
        }
        return () => {};
    }

    console.log(`[CountingList] Subscribing to counting list for user '${currentUserId}', warehouse '${currentWarehouseId}'.`);
    if (isMountedRef.current) setIsSyncing(true); // Indicate sync activity
    
    const unsubscribeFirestore = subscribeToCountingList(
      currentUserId, 
      currentWarehouseId, 
      (productsFromFirestore) => { 
        if (isMountedRef.current) {
            startTransition(() => { setCountingList(productsFromFirestore); });
            if (localKey) setLocalStorageItem(localKey, productsFromFirestore); 
            console.log(`[CountingList] Received ${productsFromFirestore.length} items from Firestore for warehouse '${currentWarehouseId}'.`);
            setIsSyncing(false); 
        }
      }, 
      (error) => { 
        if (isMountedRef.current) {
            console.warn(`[CountingList] Firestore subscription error for warehouse '${currentWarehouseId}'. Error: ${error.message}. Using localStorage as fallback.`);
            setIsSyncing(false); 
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Conteo)", description: "Usando lista de conteo local. No se pudo conectar a la nube."}));
        }
      }
    );

    return () => {
        console.log(`[CountingList] Unsubscribing from counting list for warehouse '${currentWarehouseId}'.`);
        unsubscribeFirestore();
        if (isMountedRef.current && isSyncing) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, toast, isAuthenticated]); 


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
    const rawBarcode = barcodeToAdd ?? barcode; // Use barcodeToAdd if provided (from camera), else use state 'barcode'
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
         // If it's a direct manual entry (not from camera), clear and focus.
         // If from camera, it might have already been cleared by `handleBarcodeScannedFromCamera`.
         if (!barcodeToAdd && isMountedRef.current) {
             requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
         }
         return;
     }
     if(isMountedRef.current) {
        if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
        setLastScannedBarcode(trimmedBarcode);
        lastScannedTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setLastScannedBarcode(null); }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }

    if(isMountedRef.current) setIsSyncing(true);
    let productForFirestore: DisplayProduct | null = null;
    let existingProductInList = countingList.find((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    try {
        if (existingProductInList) {
            const newCount = (existingProductInList.count ?? 0) + 1;
            productForFirestore = {
                ...existingProductInList,
                count: newCount,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp() as Timestamp,
            };
            playBeep(880, 100);
        } else {
            console.log(`[handleAddProduct] Buscando código: "'${trimmedBarcode}'" (longitud: ${trimmedBarcode.length})`);
            let catalogProd = catalogProducts.find(cp => cp.barcode === trimmedBarcode);
            if (!catalogProd && isMountedRef.current) {
                console.log(`[handleAddProduct] '${trimmedBarcode}' no en catalogProducts state, intentando IndexedDB...`);
                catalogProd = await getProductFromIndexedDB(trimmedBarcode);
            }
            console.log(`[handleAddProduct] Resultado para '${trimmedBarcode}':`, JSON.parse(JSON.stringify(catalogProd || {})));

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
                if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')){
                    requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Producto Desconocido", description: `Agregado temporalmente. Edita en 'Catálogo'.`}); });
                }
            }
            productForFirestore = {
                ...baseProductData,
                barcode: trimmedBarcode,
                warehouseId: currentWarehouseId,
                count: 1,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp() as Timestamp,
            };
        }

        if (productForFirestore && currentUserId && currentWarehouseId && db) { // Ensure db is checked
            await setCountingListItem(currentUserId, currentWarehouseId, productForFirestore);
        } else if (!db) {
            console.warn("[handleAddProduct] Firestore (db) no inicializado. Cambios no se guardarán en la nube.");
            // Aquí podrías manejar la lógica para actualizar solo localStorage si Firestore no está disponible
            // Esto ya se hace de forma implícita si el listener no está activo
            // y las operaciones de Firestore fallan (aunque no deberían llegar aquí si db es null).
        }

    } catch (error: any) {
        console.error("Error adding/updating product in Firestore counting list:", error);
        playBeep(440, 300);
        if (isMountedRef.current) {
          requestAnimationFrame(() => {
            if (isMountedRef.current) {
              toast({ variant: "destructive", title: "Error de Sincronización", description: `No se pudo guardar el producto en la nube. ${error.message}` });
            }
          });
        }
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
    }

    // Clear input only if it was a manual entry, not from camera
    if (!barcodeToAdd && isMountedRef.current) {
        requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
    } else if (barcodeToAdd && isMountedRef.current) { // If from camera, ensure focus returns to input (if manual input is shown) or remains appropriate
        focusBarcodeIfCounting();
    }
  }, [
    barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, 
    catalogProducts, focusBarcodeIfCounting, activeSection, getProductFromIndexedDB, // No add setCountingListItem directly
  ]);


 const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;

    const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
    if (!productInList) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto no encontrado en la lista actual.`}));
         return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    const calculatedNewValue = Math.max(0, originalValue + change); // Ensure non-negative
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
            if (db) { // Check if db is initialized
                const updatedProductData: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
                    count: calculatedNewValue,
                    lastUpdated: new Date().toISOString(),
                    firestoreLastUpdated: serverTimestamp()
                };
                await setCountingListItem(currentUserId, currentWarehouseId, { ...productInList, ...updatedProductData });
            } else {
                console.warn("[modifyProductValue] Firestore (db) no inicializado. Cambios de conteo no se guardarán en la nube.");
                // Logic to update localStorage directly if needed, though onSnapshot failing should handle this
            }
            if (showDiscrepancyToastIfNeeded(productInList, calculatedNewValue)) {
            }
        } else if (type === 'stock') {
            const masterProduct = await getProductFromIndexedDB(barcodeToUpdate);
            if (masterProduct) { 
                const updatedMasterProduct: ProductDetail = { ...masterProduct, stock: calculatedNewValue };
                await addOrUpdateProductToIndexedDB(updatedMasterProduct); 
                await synchronizeAndLoadCatalog(); // Refresh catalog state (from IndexedDB)
                
                if (db && currentUserId && currentWarehouseId) { // Update the stock in the current counting list item in Firestore if it exists
                    const updatedCountingItemStock: Partial<DisplayProduct> & { firestoreLastUpdated: any } = { 
                        stock: calculatedNewValue, 
                        lastUpdated: new Date().toISOString(),
                        firestoreLastUpdated: serverTimestamp()
                    };
                    await setCountingListItem(currentUserId, currentWarehouseId, { ...productInList, ...updatedCountingItemStock });
                }
                requestAnimationFrame(() => toast({ title: "Stock Actualizado en Catálogo y Lista" }));
            } else {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "Producto no encontrado en catálogo maestro para actualizar stock."}));
            }
        }
    } catch (error: any) {
        console.error("Error modifying product value:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
    }
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
  }, [currentWarehouseId, currentUserId, toast, countingList, activeSection, synchronizeAndLoadCatalog, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, getProductFromIndexedDB, addOrUpdateProductToIndexedDB]);


const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue: boolean = false) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
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
    
    if(isMountedRef.current) setIsSyncing(true);
    try {
        if (type === 'count') {
            if (db) { // Check db initialization
                const updatedProductForFirestore: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
                    count: finalNewValue,
                    lastUpdated: new Date().toISOString(),
                    firestoreLastUpdated: serverTimestamp()
                };
                await setCountingListItem(currentUserId, currentWarehouseId, { ...productInList, ...updatedProductForFirestore });
            } else {
                 console.warn("[handleSetProductValue] Firestore (db) no inicializado. Cambios de conteo no se guardarán en la nube.");
            }
             if (showDiscrepancyToastIfNeeded(productInList, finalNewValue)) {
            }
        } else if (type === 'stock') {
            const masterProduct = await getProductFromIndexedDB(barcodeToUpdate);
            if (masterProduct) {
                const updatedMasterProduct: ProductDetail = { ...masterProduct, stock: finalNewValue };
                await addOrUpdateProductToIndexedDB(updatedMasterProduct); 
                await synchronizeAndLoadCatalog(); 

                if (db && currentUserId && currentWarehouseId) { // Update stock in counting list on Firestore
                    const updatedCountingItemStock: Partial<DisplayProduct> & { firestoreLastUpdated: any } = { 
                        stock: finalNewValue,
                        lastUpdated: new Date().toISOString(),
                        firestoreLastUpdated: serverTimestamp()
                    };
                    await setCountingListItem(currentUserId, currentWarehouseId, { ...productInList, ...updatedCountingItemStock });
                }
                requestAnimationFrame(() => toast({ title: "Stock Actualizado en Catálogo y Lista" }));
            } else {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "Producto no en catálogo maestro."}));
            }
        }
    } catch (error: any) {
        console.error("Error setting product value:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
    }

    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
}, [toast, countingList, focusBarcodeIfCounting, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen, activeSection, synchronizeAndLoadCatalog, showDiscrepancyToastIfNeeded, getProductFromIndexedDB, addOrUpdateProductToIndexedDB]);


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
    
    if(isMountedRef.current) setIsSyncing(true);
    try {
        if (db) { // Check db initialization
            const updatedProductForFirestore: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
                count: finalConfirmedCount,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, { ...productInList, ...updatedProductForFirestore });
        } else {
            console.warn("[handleConfirmQuantityChange] Firestore (db) no inicializado. Cambios de conteo no se guardarán en la nube.");
        }
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Cantidad Modificada" }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
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
    const {barcode: barcodeForToast, description: descriptionForToast } = productToDelete;
    
    if(isMountedRef.current) setIsSyncing(true);
    try {
        if (db) { // Check db initialization
            await deleteCountingListItem(currentUserId, currentWarehouseId, barcodeForToast);
        } else {
             console.warn("[confirmDelete] Firestore (db) no inicializado. Producto no se eliminará de la nube.");
        }
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó de la lista actual.` }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsDeleteDialogOpen(false);
            setProductToDelete(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [productToDelete, toast, focusBarcodeIfCounting, currentUserId, currentWarehouseId]);

 const handleClearCurrentList = useCallback(async () => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return;
    if(isMountedRef.current) setIsSyncing(true);
    try {
        if (db) { // Check db initialization
            await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        } else {
            console.warn("[handleClearCurrentList] Firestore (db) no inicializado. Lista no se borrará de la nube.");
        }
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Lista Borrada" }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: error.message }));
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
                        ...countingProduct, // Keep existing count and warehouseId
                        description: catalogProd.description,
                        provider: catalogProd.provider,
                        stock: catalogProd.stock ?? 0,
                        expirationDate: catalogProd.expirationDate || null,
                        lastUpdated: new Date().toISOString(),
                        firestoreLastUpdated: serverTimestamp() as Timestamp,
                    });
                }
            }
        });
        
        if (productsToUpdateInFirestore.length > 0 && db) { // Check db
            const batch = writeBatch(db); 
            productsToUpdateInFirestore.forEach(itemToUpdate => {
                if (!itemToUpdate.barcode) return; 
                const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), itemToUpdate.barcode);
                const { barcode, warehouseId, ...dataToSet } = itemToUpdate; 
                batch.set(docRef, dataToSet, { merge: true }); 
            });
            await batch.commit();
        } else if (productsToUpdateInFirestore.length > 0 && !db) {
             console.warn("[handleRefreshStock] Firestore (db) no inicializado. Actualizaciones de stock no se guardarán en la nube.");
        }

        if(updatedProductCount > 0 && isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) en la lista.` }));
        } else if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Los productos en la lista ya están actualizados con el catálogo." }));
        }
    } catch (error: any) {
         console.error(`Error refreshing stock for warehouse ${currentWarehouseId}:`, error);
         if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Actualizar", description: error.message }));
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
    if (!product || !product.barcode || !isMountedRef.current) return;
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        // Use catalogProducts state as primary, fallback to IndexedDB if needed
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
 }, [toast, catalogProducts, getProductFromIndexedDB]); // currentUserId removed as not directly used


 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
    if (!isMountedRef.current || !productToEditDetail) return; // currentUserId check moved
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); }
    try {
        const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, 
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || null,
        };
        
        await addOrUpdateProductToIndexedDB(updatedProductData); // Update IndexedDB
        await synchronizeAndLoadCatalog(); // Refresh catalogProducts state from IndexedDB

        // If product is in current counting list, update its details in Firestore
        const productInCountingList = countingList.find(p => p.barcode === updatedProductData.barcode && p.warehouseId === currentWarehouseId);
        if (productInCountingList && currentUserId && currentWarehouseId && db) { // ensure currentUserId, currentWarehouseId and db
            const updatedCountingItemData: Partial<DisplayProduct> & { firestoreLastUpdated: any } = {
                description: updatedProductData.description,
                provider: updatedProductData.provider,
                stock: updatedProductData.stock ?? 0,
                expirationDate: updatedProductData.expirationDate,
                lastUpdated: new Date().toISOString(),
                firestoreLastUpdated: serverTimestamp()
            };
            await setCountingListItem(currentUserId, currentWarehouseId, { ...productInCountingList, ...updatedCountingItemData });
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
 }, [toast, productToEditDetail, focusBarcodeIfCounting, currentUserId, countingList, currentWarehouseId, synchronizeAndLoadCatalog, addOrUpdateProductToIndexedDB]);


 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) return;
    if (!productsToCount || productsToCount.length === 0) {
        requestAnimationFrame(() => toast({ title: "Vacío", description: "No hay productos para este proveedor." }));
        return;
    }

    if(isMountedRef.current) setIsSyncing(true);
    try {
        // Clear the current list in Firestore for this warehouse
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        
        // Add products from the selected provider to the Firestore counting list
        const batch = writeBatch(db); // db is checked to be non-null
        productsToCount.forEach(dbProduct => {
            const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), dbProduct.barcode);
            const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId'> & { firestoreLastUpdated: any } = {
               description: dbProduct.description,
               provider: dbProduct.provider,
               stock: dbProduct.stock ?? 0,
               expirationDate: dbProduct.expirationDate || null,
               count: 0, // Start with count 0 for provider-based counting
               lastUpdated: new Date().toISOString(),
               firestoreLastUpdated: serverTimestamp(),
            };
            batch.set(docRef, dataToSet); 
        });
        await batch.commit();

        if (isMountedRef.current) {
            setActiveSection("Contador");
            setSearchTerm(""); // Clear search after loading by provider
            requestAnimationFrame(() => toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` }));
        }
    } catch (error: any) {
        console.error("Error starting count by provider:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: `No se pudo iniciar el conteo por proveedor. ${error.message}` }));
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
      startTransition(() => { // Wrap in transition for smoother UI
        setActiveSection(newSection);
      });
      // If changing to a counter section, attempt focus
      if (newSection === 'Contador' || newSection === 'Contador Cámara') {
        requestAnimationFrame(focusBarcodeIfCounting);
      }
      if (newSection === 'Contador Cámara') {
        setIsCameraScanMode(true);
      } else {
        setIsCameraScanMode(false);
      }
    }
  }, [setActiveSection, focusBarcodeIfCounting]); 


   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             startTransition(() => {
                setCurrentWarehouseId(newWarehouseId);
                setSearchTerm(""); // Clear search when changing warehouse
             });
             if (currentUserId) { // Only save to localStorage if there's a current user
                 setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newWarehouseId);
             }
         }
   }, [currentWarehouseId, startTransition, currentUserId, setCurrentWarehouseId]);

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
          handleWarehouseChange(newWarehouse.id); // Switch to the new warehouse
          requestAnimationFrame(() => toast({title: "Almacén Agregado", description: `Cambiado a: ${newWarehouse.name}`}));
      } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo agregar el almacén. ${error.message}` }));
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
       } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo actualizar el almacén. ${error.message}` }));
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
      // The onSnapshot listener for warehouses will update the UI.
      // If the deleted warehouse was the current one, the listener's logic will select a new one (DEFAULT_WAREHOUSE_ID).
      requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
    } catch (error: any) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo eliminar el almacén. ${error.message}` }));
    } finally {
      if(isMountedRef.current) setIsSyncing(false);
    }
  }, [toast, currentUserId]);


   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        // Find the product in the current counting list to get its latest value
        const currentItem = countingList.find(p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId);
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]); 

   // Function to handle catalog loading from Google Sheet
   const handleGoogleSheetLoadToCatalog = useCallback(async (sheetUrlOrId: string) => {
        if (!isAuthenticated) { // Use isAuthenticated which is more reliable than currentUserId alone
          toast({ variant: "destructive", title: "Error", description: "Debe iniciar sesión para cargar el catálogo." });
          return;
        }
        if (!sheetUrlOrId) {
          toast({ variant: "destructive", title: "URL/ID Requerido", description: "Por favor, ingrese la URL o ID de la Hoja de Google." });
          return;
        }

        if (isMountedRef.current) {
            setIsDbLoading(true);
            setProcessingStatus("Cargando datos desde Google Sheet...");
        }

        try {
          const productsFromSheet = await fetchGoogleSheetData(sheetUrlOrId);
          if (productsFromSheet.length > 0) {
            await addProductsToIndexedDB(productsFromSheet); // Save to IndexedDB
            await synchronizeAndLoadCatalog(); // Refresh catalogProducts state from IndexedDB
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
            // setProcessingStatus(""); // Clear status after a delay or keep it
          }
        }
    }, [isAuthenticated, toast, synchronizeAndLoadCatalog, addProductsToIndexedDB]); // Removed currentUserId

   const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current || !isAuthenticated) return; // Use isAuthenticated
    if(isMountedRef.current) { setIsDbLoading(true); } 
    try {
      await clearProductDatabase(); // Clear IndexedDB
      await synchronizeAndLoadCatalog(); // Refresh catalogProducts state from (now empty) IndexedDB
      if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Catálogo Borrado" }));
    } catch (error: any) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: `No se pudieron borrar datos: ${error.message}` }));
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); setIsClearCatalogConfirmOpen(false); }
      requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [toast, isAuthenticated, focusBarcodeIfCounting, synchronizeAndLoadCatalog]); // Removed currentUserId


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
        // Clear local storage associated with the user
        if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
            // Attempt to clear warehouse-specific and counting list localStorage for 'rps'
            // More robust would be to iterate keys if multiple users were truly supported
            // For now, this targets the 'rps' user specifically if currentUserId was 'rps'
            const userIdToClear = LOGIN_USER; // Assuming we are signing out 'rps'
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${userIdToClear}`) || 
                    key.startsWith(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}`) && key.endsWith(`_${userIdToClear}`)) {
                    localStorage.removeItem(key);
                }
            });
        }
        setCountingList([]);
        setCatalogProducts([]); 
        setWarehouses(PREDEFINED_WAREHOUSES_LIST); 
        setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
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
    showUserIdInput: showUserIdInput,
    setShowUserIdInput: setShowUserIdInput,
    onUserIdChange: (newId: string) => {
      if (newId.trim() !== "" && newId.trim() !== currentUserId) {
          if (isMountedRef.current) {
              startTransition(() => {
                  setCurrentUserId(newId.trim());
                  // Clear states that depend on user ID
                  setCountingList([]);
                  setCatalogProducts([]);
                  setWarehouses(PREDEFINED_WAREHOUSES_LIST);
                  setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
                  // Reset initial fetch flags for the new user
                  isInitialFetchDoneForUserWarehouses.current[newId.trim()] = false;
                  isInitialCatalogSyncDoneForUser.current[newId.trim()] = false;
              });
              setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, newId.trim());
              toast({ title: "Usuario Cambiado", description: `ID de usuario cambiado a: ${newId.trim()}` });
          }
      }
      setShowUserIdInput(false); // Close input after attempting change
    }
  };


  const handleLogin = () => {
    if (loginUsername === LOGIN_USER && loginPassword === LOGIN_PASSWORD) {
        if (isMountedRef.current) {
            setCurrentUserId(LOGIN_USER); 
            setIsAuthenticated(true);
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
            "flex-shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300 ease-in-out",
            isSidebarCollapsed ? "w-16" : "w-64"
        )}>
          <SidebarLayout {...sidebarProps} />
        </aside>
      )}


      <main className="flex-1 p-4 md:p-6 overflow-y-auto relative"> 
         {isSyncing && (
          <div className="absolute top-4 right-4 p-2 z-50" title="Sincronizando con la nube...">
            <RefreshCw className="h-5 w-5 text-primary animate-spin" />
          </div>
        )}

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
                    isScanningActive={activeSection === 'Contador Cámara'} // Only active if this section is visible
                    isDecodingActive={true} // Always try to decode when camera is active in this mode
                    />
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <Button
                    onClick={handleRefreshStock}
                    variant="outline"
                    className="h-10 text-primary border-primary/50 hover:bg-primary/10"
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
                            <Button variant="outline" className="w-full"> <MoreVertical className="h-4 w-4 mr-2" /> <span>Acciones</span> </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[calc(100vw-4rem)] sm:w-56">
                            <DropdownMenuItem onSelect={handleExport} disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending}> <Download className="h-4 w-4 mr-2" /> Exportar </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => { if (countingList.filter(p => p.warehouseId === currentWarehouseId).length > 0) { setIsDeleteListDialogOpen(true); } else { requestAnimationFrame(() => toast({ title: "Vacío", description: "La lista actual ya está vacía." })); } }} disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending} className="text-destructive focus:text-destructive dark:focus:text-red-400"> <Trash className="h-4 w-4 mr-2" /> Borrar Lista </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    ) : (
                    <>
                        <Button onClick={handleExport} disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending} variant="outline" className="flex items-center gap-1 w-full sm:w-auto"> <Download className="h-4 w-4" /> Exportar </Button>
                        <Button onClick={() => { if (countingList.filter(p => p.warehouseId === currentWarehouseId).length > 0) { setIsDeleteListDialogOpen(true); } else { requestAnimationFrame(() => toast({ title: "Vacío", description: "La lista actual ya está vacía." })); } }} disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isTransitionPending} variant="destructive" className="flex items-center gap-1 w-full sm:w-auto"> <Trash className="h-4 w-4" /> Borrar Lista </Button>
                    </>
                    )}
                </div>
            </div>
        )}
        
         {activeSection === 'Catálogo de Productos' && isAuthenticated && ( // Check isAuthenticated
            <div id="database-content">
               <ProductDatabase
                  catalogProducts={catalogProducts} 
                  isLoadingCatalog={isDbLoading} // Pass the correct loading state
                  onAddOrUpdateProduct={async (productData: ProductDetail) => { 
                      if (!isAuthenticated) return; // Check isAuthenticated
                      if(isMountedRef.current) { setIsDbLoading(true); }
                      try {
                          await addOrUpdateProductToIndexedDB(productData); // Save to IndexedDB
                          await synchronizeAndLoadCatalog(); // Refresh state from IndexedDB
                          if(isMountedRef.current) requestAnimationFrame(() => toast({title: "Producto Actualizado/Agregado en Catálogo Local"}));
                      } catch (error: any) {
                          if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo guardar: ${error.message}` }));
                      } finally {
                          if (isMountedRef.current) { setIsDbLoading(false); }
                      }
                  }}
                  onDeleteProduct={async (barcodeToDelete) => { 
                    if (!isAuthenticated) return; // Check isAuthenticated
                    if(isMountedRef.current) { setIsDbLoading(true); }
                    try {
                        await deleteProductFromIndexedDB(barcodeToDelete); // Delete from IndexedDB
                        await synchronizeAndLoadCatalog(); // Refresh state from IndexedDB
                        if (isMountedRef.current) {
                          requestAnimationFrame(() => toast({title: "Producto eliminado del catálogo local"}));
                        }
                    } catch (error: any) {
                          if (!isMountedRef.current) return;
                          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
                    } finally {
                          if (isMountedRef.current) { setIsDbLoading(false); }
                    }
                  }}
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
                    isLoading={isDbLoading || isTransitionPending || isSyncing}
                  />
             </div>
           )}
           {activeSection === 'Consolidado' && currentUserId && (
             <div id="consolidated-report-content" className="h-full">
                <ConsolidatedView
                    catalogProducts={catalogProducts} // Pass catalogProducts for master stock info
                    warehouses={warehouses}
                    currentUserId={currentUserId}
                    // getWarehouseName is already defined in Home
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
               if (stock > 0 && confirmQuantityNewValue > stock) { // Condición para superar stock
                   return `La cantidad contada (${confirmQuantityNewValue}) ahora SUPERA el stock del sistema (${stock}) para "${description}". ¿Confirmar?`;
               } else if (stock > 0 && confirmQuantityNewValue === stock) { // Condición para igualar stock (y no es 0)
                   return `La cantidad contada (${confirmQuantityNewValue}) ahora COINCIDE con el stock del sistema (${stock}) para "${description}". ¿Continuar?`;
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
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos del catálogo local (IndexedDB).</p>
                    <p>Esta acción no se puede deshacer.</p>
                 </div>
            }
            confirmText="Sí, Borrar Catálogo"
            onConfirm={handleClearCatalog}
            onCancel={() => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(false); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); }}
            isDestructive={true}
            isProcessing={isDbLoading || isTransitionPending || isSyncing}
        />

      {productToEditDetail && ( // Check productToEditDetail directly
        <EditProductDialog
          isOpen={isEditDetailDialogOpen}
          setIsOpen={(open) => { if(isMountedRef.current) setIsEditDetailDialogOpen(open); if (!open) { if(isMountedRef.current) setProductToEditDetail(null); requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); }); } }}
          selectedDetail={productToEditDetail}
          setSelectedDetail={(detail) => {if(isMountedRef.current && detail) setProductToEditDetail(detail); else if (isMountedRef.current) setProductToEditDetail(null);}}
          onSubmit={handleEditDetailSubmit}
          onDelete={ async (barcodeToDelete) => {
                if (!isMountedRef.current || !isAuthenticated) return; // Use isAuthenticated
                if(isMountedRef.current) { setIsDbLoading(true); }
                try {
                    await deleteProductFromIndexedDB(barcodeToDelete); // Delete from IndexedDB
                    await synchronizeAndLoadCatalog(); // Refresh state from IndexedDB
                    if (isMountedRef.current) {
                      requestAnimationFrame(() => toast({title: "Producto eliminado del catálogo local"}));
                      setIsEditDetailDialogOpen(false); setProductToEditDetail(null);
                    }
                } catch (error: any) {
                      if (!isMountedRef.current) return;
                      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
                } finally {
                      if (isMountedRef.current) { setIsDbLoading(false); }
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
