
"use client";

import type { DisplayProduct, ProductDetail, Warehouse, ConsolidatedProductViewItem } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem, debounce } from "@/lib/utils";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// IndexedDB functions
import {
  getProductFromDB as getProductFromIndexedDB,
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  clearProductDatabase,
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
  // --- Firestore Catalog Functions --- NO LONGER IMPORTED FROM HERE
  // getAllProductsFromCatalog,
  // addOrUpdateProductInCatalog,
  // deleteProductFromCatalog,
  // addProductsToCatalog,
  // clearProductCatalogInFirestore,
  // getProductFromCatalog,
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
// import { CountingListTable } from '@/components/counting-list-table'; // Imported in CounterSection
import { ConsolidatedView } from '@/components/consolidated-view';
import { BarcodeEntry } from '@/components/barcode-entry';
import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera';


// Firebase db instance for Firestore operations
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection } from 'firebase/firestore';
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
    GOOGLE_SHEET_URL_LOCALSTORAGE_KEY,
    LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX,
  } from '@/lib/constants';
import { CountingListTable } from '@/components/counting-list-table';


const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
];

// Helper functions for Google Sheet import (moved from ProductDatabaseComponent)
const extractSpreadsheetIdAndGid = (url: string): { spreadsheetId: string | null; gid: string | null } => {
    if (!url) return { spreadsheetId: null, gid: null };
    let spreadsheetId: string | null = null;
    let gid: string | null = null;
    const idRegex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const idMatch = url.match(idRegex);
    if (idMatch && idMatch[1]) {
        spreadsheetId = idMatch[1];
    } else if (!url.includes('/')) {
        spreadsheetId = url;
    }
    const gidRegex = /[#&]gid=([0-9]+)/;
    const gidMatch = url.match(gidRegex);
    if (gidMatch && gidMatch[1]) {
        gid = gidMatch[1];
    } else if (spreadsheetId && !url.includes('gid=')) {
        gid = '0'; // Default to first sheet if gid is not specified
    }
    return { spreadsheetId, gid };
};

async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);

    if (!spreadsheetId) {
        throw new Error("No se pudo extraer el ID de la Hoja de Google de la URL/ID proporcionado.");
    }

    const gidParam = gid ? `&gid=${gid}` : '&gid=0'; // Default to gid=0 if not specified
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gidParam}`;

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error al obtener la Hoja de Google (HTTP ${response.status}). Asegúrate de que la URL sea correcta y que la hoja esté compartida como "Cualquier persona con el enlace puede ver". Detalle: ${errorText}`);
        }
        const csvText = await response.text();

        return new Promise<ProductDetail[]>((resolve, reject) => {
            if (typeof Papa === 'undefined') {
                reject(new Error("La librería PapaParse no está cargada."));
                return;
            }

            Papa.parse(csvText, {
                header: false, 
                skipEmptyLines: true,
                complete: (results) => {
                    const products: ProductDetail[] = [];
                    const BARCODE_COLUMN_INDEX = 0;
                    const DESCRIPTION_COLUMN_INDEX = 1;
                    const STOCK_COLUMN_INDEX = 5;
                    const PROVIDER_COLUMN_INDEX = 9;
                    const EXPIRATION_DATE_COLUMN_INDEX = 2;


                    results.data.forEach((row: any, rowIndex) => {
                        if (rowIndex === 0 && (row as string[]).some(header =>
                            ["codigo", "código", "cod.", "barra", "barras", "barcode", "producto", "descrip", "nombre"].some(kw => header?.toLowerCase().includes(kw))
                        )) {
                            return;
                        }

                        const values = row as string[];
                        const barcode = values[BARCODE_COLUMN_INDEX]?.trim();

                        if (!barcode) {
                             return; 
                        }

                        const description = values[DESCRIPTION_COLUMN_INDEX]?.trim();
                        const provider = values[PROVIDER_COLUMN_INDEX]?.trim();
                        const stockStr = values[STOCK_COLUMN_INDEX]?.trim();
                        let stock = stockStr ? parseInt(stockStr, 10) : 0;
                        if (isNaN(stock)) stock = 0; 

                        const finalDescription = description || `Producto ${barcode}`;
                        const finalProvider = provider || "Desconocido";

                        const expirationDateStr = values[EXPIRATION_DATE_COLUMN_INDEX]?.trim();
                        const expirationDate: string | null = expirationDateStr ? expirationDateStr : null;


                        products.push({ barcode, description: finalDescription, provider: finalProvider, stock, expirationDate });
                    });
                    resolve(products);
                },
                error: (error: any) => {
                    reject(new Error(`Error al parsear el archivo CSV: ${error.message}`));
                }
            });
        });
    } catch (error: any) {
        throw new Error(`No se pudo cargar o procesar la Hoja de Google: ${error.message}`);
    }
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
  const [isDbLoading, setIsDbLoading] = useState(true); 
  const [isSyncing, setIsSyncing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [focusTrigger, setFocusTrigger] = useState<number>(0); // For managing autofocus


  // --- Warehouse State ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  const [isInitialFetchDoneForUserWarehouses, setIsInitialFetchDoneForUserWarehouses] = useState(false);


  // --- Product Catalog State (IndexedDB as primary, React state as copy) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]);

  // --- Counting List State (Firestore as primary, localStorage as cache/fallback) ---
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
  
  const [googleSheetUrlForCatalog, setGoogleSheetUrlForCatalog] = useLocalStorage<string>(
    GOOGLE_SHEET_URL_LOCALSTORAGE_KEY, ""
  );

  const focusBarcodeIfCounting = useCallback(() => {
    if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current && !isCameraScanMode) {
        requestAnimationFrame(() => {
            if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current && !isCameraScanMode) {
                 if (document.activeElement !== barcodeInputRef.current) {
                    barcodeInputRef.current.focus();
                 }
            }
        });
        setTimeout(() => {
            if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current && !isCameraScanMode) {
                if (document.activeElement !== barcodeInputRef.current) {
                    barcodeInputRef.current.focus();
                }
            }
        }, 100); 
    }
  }, [activeSection, isCameraScanMode]);

  useEffect(() => {
    if (focusTrigger > 0 && activeSection === 'Contador' && !isCameraScanMode) {
      focusBarcodeIfCounting();
    }
  }, [focusTrigger, activeSection, isCameraScanMode, focusBarcodeIfCounting]);


  const handleScanButtonPress = useCallback(() => setIsActivelyScanningByButton(true), []);
  const handleScanButtonRelease = useCallback(() => setIsActivelyScanningByButton(false), []);
  
  const toggleCameraScanMode = useCallback(() => {
    setIsCameraScanMode(prev => {
        const nextMode = !prev;
        if (!nextMode && activeSection === 'Contador') { 
           setFocusTrigger(prev => prev + 1);
        }
        return nextMode;
    });
  }, [activeSection]);


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


const synchronizeAndLoadCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    setProcessingStatus("Sincronizando catálogo...");

    if (currentUserId && db) {
        try {
            // For hybrid approach, we now primarily load from IndexedDB.
            // Firestore synchronization for catalog would be a separate, more complex process
            // if we wanted the catalog itself to be cloud-synced.
            // For now, catalog is local-first via IndexedDB.
            const localProducts = await getAllProductsFromIndexedDB();
            const sortedLocalProducts = localProducts
                .filter(p => p && p.barcode) // Ensure product and barcode are valid
                .map(p => ({
                    ...p,
                    description: p.description || `Producto ${p.barcode}`,
                    provider: p.provider || "Desconocido",
                    stock: p.stock ?? 0,
                    expirationDate: p.expirationDate || null,
                }))
                .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
            
            startTransition(() => setCatalogProducts(sortedLocalProducts));
            setProcessingStatus(localProducts.length > 0 ? "Catálogo local cargado." : "Catálogo local vacío.");

        } catch (error: any) {
            console.error("[SyncCatalog] Error during catalog synchronization (using IndexedDB):", error.message, error.stack);
            if (isMountedRef.current) {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo cargar el catálogo local." }));
            }
            startTransition(() => setCatalogProducts([]));
            setProcessingStatus("Error al cargar catálogo local.");
        }
    } else {
         // No user ID, still use IndexedDB for catalog (guest mode or pre-login)
        try {
            const localProducts = await getAllProductsFromIndexedDB();
             const sortedLocalProducts = localProducts
                .filter(p => p && p.barcode)
                .map(p => ({
                    ...p,
                    description: p.description || `Producto ${p.barcode}`,
                    provider: p.provider || "Desconocido",
                    stock: p.stock ?? 0,
                    expirationDate: p.expirationDate || null,
                }))
                .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
            startTransition(() => setCatalogProducts(sortedLocalProducts));
            setProcessingStatus(localProducts.length > 0 ? "Catálogo local cargado." : "Catálogo local vacío.");
        } catch (indexedDbError: any) {
            console.error("[SyncCatalog] Error loading catalog from IndexedDB (no user/db):", indexedDbError.message, indexedDbError.stack);
            startTransition(() => setCatalogProducts([]));
            setProcessingStatus("Error al cargar catálogo local.");
        }
    }

    if (isMountedRef.current) {
        setIsDbLoading(false);
    }
  }, [
    currentUserId, toast, db, // db is kept for potential future use or for other Firestore operations
    getAllProductsFromIndexedDB, // IndexedDB function for catalog
    setCatalogProducts, setIsDbLoading, setProcessingStatus, startTransition
  ]);


const handleAddProduct = useCallback(async (scannedBarcode?: string) => {
    if (!isMountedRef.current) return;
    const rawBarcode = scannedBarcode ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      if(isMountedRef.current && !scannedBarcode && activeSection === 'Contador') {
        // No toast for empty manual entry to keep flow smooth
      }
      if (!scannedBarcode) {
        setBarcode("");
        setFocusTrigger(prev => prev + 1);
      }
      return;
    }
    if (!currentUserId || !currentWarehouseId) {
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén o no hay usuario activo." }); });
        return;
    }

     if (trimmedBarcode === lastScannedBarcode) {
         if (!scannedBarcode) {
            setBarcode("");
            setFocusTrigger(prev => prev + 1);
         }
         return;
     }
     if(isMountedRef.current) {
        if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
        setLastScannedBarcode(trimmedBarcode);
        lastScannedTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setLastScannedBarcode(null); }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }

    let dataForFirestore: DisplayProduct;
    const existingProductInList = countingList.find((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductInList) {
        const newCount = (existingProductInList.count ?? 0) + 1;
        dataForFirestore = { ...existingProductInList, count: newCount, lastUpdated: new Date().toISOString() };
    } else {
        let baseProductData: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'count' | 'lastUpdated' | 'firestoreLastUpdated'>;
        
        try {
            const barcodeToLookup = trimmedBarcode;
            let catalogProd = catalogProducts.find(p => p.barcode === barcodeToLookup);

            if (!catalogProd) { 
                catalogProd = await getProductFromIndexedDB(barcodeToLookup);
            }
            
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
                if (isMountedRef.current && activeSection !== 'Contador' && activeSection !== 'Contador Cámara') {
                    requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            toast({ variant: "destructive", title: "Producto Desconocido", description: `Agregado temporalmente. Edita en 'Catálogo'.`});
                        }
                    });
                }
                playBeep(440, 300);
            }
        } catch (error: any) {
            playBeep(220, 500);
            console.error("Error obteniendo producto de catálogo local:", error);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: `No se pudo obtener info. del producto: ${error.message}` }));
             baseProductData = {
                description: `Producto (error DB) ${trimmedBarcode}`,
                provider: "Error DB",
                stock: 0,
                expirationDate: null,
            };
        }
        dataForFirestore = {
            ...baseProductData,
            barcode: trimmedBarcode,
            warehouseId: currentWarehouseId,
            count: 1,
            lastUpdated: new Date().toISOString(),
        };
    }

    if (!dataForFirestore.barcode || dataForFirestore.barcode.trim() === "") {
         if (isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error Interno", description: "Código de barras inválido al agregar." }); });
         if (!scannedBarcode) { 
            setBarcode(""); 
            setFocusTrigger(prev => prev + 1);
         }
         return;
    }

    if (db && currentUserId && currentWarehouseId) {
        setIsSyncing(true);
        try {
            await setCountingListItem(currentUserId, currentWarehouseId, dataForFirestore);
            if (!existingProductInList) showDiscrepancyToastIfNeeded(dataForFirestore);
        } catch (error: any) {
            console.error("Error guardando en Firestore:", error);
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
    } else { 
      requestAnimationFrame(() => toast({ title: "Operación Local (Offline)", description: "El cambio se reflejará localmente. Conéctate para sincronizar." }));
      // Fallback a localStorage si Firestore no está disponible (ya se maneja en el useEffect de countingList)
      if (!existingProductInList) showDiscrepancyToastIfNeeded(dataForFirestore);
    }

    if (!scannedBarcode && isMountedRef.current) {
      setBarcode("");
      setFocusTrigger(prev => prev + 1);
    } else if (scannedBarcode && isMountedRef.current && activeSection === 'Contador') {
      setFocusTrigger(prev => prev + 1);
    }
  }, [
    barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, 
    activeSection, catalogProducts, getProductFromIndexedDB, 
    setBarcode, setIsSyncing, setLastScannedBarcode, startTransition, 
    setCountingList, showDiscrepancyToastIfNeeded, setCountingListItem, 
    setFocusTrigger // Removed focusBarcodeIfCounting as it's handled by focusTrigger effect
]);

  const handleBarcodeScannedFromCamera = useCallback((scannedBarcode: string) => {
    if (isMountedRef.current && activeSection === 'Contador Cámara' && isActivelyScanningByButton) {
      handleAddProduct(scannedBarcode);
    }
  }, [activeSection, isActivelyScanningByButton, handleAddProduct]);

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
    return () => {
      isMountedRef.current = false;
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
    };
  }, [setCurrentUserId]);

  useEffect(() => {
    if (isAuthenticated && currentUserId) {
      synchronizeAndLoadCatalog();
    } else {
      startTransition(() => setCatalogProducts([]));
      if (isMountedRef.current) setIsDbLoading(false);
    }
  }, [isAuthenticated, currentUserId, synchronizeAndLoadCatalog]);

  useEffect(() => {
    if (isAuthenticated && currentUserId && activeSection === 'Contador' && !isCameraScanMode) {
      setFocusTrigger(prev => prev + 1);
    }
  }, [isAuthenticated, currentUserId, activeSection, isCameraScanMode]);


  useEffect(() => {
    let unsubscribeFirestoreWarehouses: (() => void) = () => {};
    const localUserWarehouseListKey = currentUserId ? `${LOCAL_STORAGE_WAREHOUSE_LIST_KEY_PREFIX}${currentUserId}` : null;

    if (localUserWarehouseListKey) {
        const localWarehouses = getLocalStorageItem<Warehouse[]>(localUserWarehouseListKey, []);
        if (localWarehouses.length > 0) {
             startTransition(() => setWarehouses(localWarehouses.sort((a, b) => a.name.localeCompare(b.name))));
        } else if (warehouses.length === 0 || warehouses.every(w => !PREDEFINED_WAREHOUSES_LIST.some(p => p.id === w.id))) {
             startTransition(() => setWarehouses(PREDEFINED_WAREHOUSES_LIST.sort((a, b) => a.name.localeCompare(b.name))));
        }
    } else if (warehouses.length === 0) {
         startTransition(() => setWarehouses(PREDEFINED_WAREHOUSES_LIST.sort((a, b) => a.name.localeCompare(b.name))));
    }
    
    if (!currentUserId || !db || !isAuthenticated) {
        setIsInitialFetchDoneForUserWarehouses(false); 
        return;
    }

    let isInitialFetchForUser = !isInitialFetchDoneForUserWarehouses;
    setIsSyncing(true); 

    unsubscribeFirestoreWarehouses = subscribeToWarehouses(currentUserId,
      async (fetchedWarehousesFromFirestore) => {
        if (!isMountedRef.current) return;

        let effectiveWarehouseList = [...fetchedWarehousesFromFirestore];
        
        if (isInitialFetchForUser && currentUserId) {
            const warehousesToAddBatch: Warehouse[] = [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predef => {
                if (!effectiveWarehouseList.some(fsWh => fsWh.id === predef.id)) {
                    warehousesToAddBatch.push(predef);
                }
            });

            if (warehousesToAddBatch.length > 0 && db) {
                setIsSyncing(true);
                try {
                    const batch = writeBatch(db);
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                } catch (err) {
                    console.error(`[Warehouses] Failed to add predefined warehouses to Firestore for ${currentUserId}:`, err);
                    if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                } finally {
                     if (isMountedRef.current) setIsSyncing(false);
                }
            }
            if (isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(true);
            isInitialFetchForUser = false; 
            if (warehousesToAddBatch.length > 0) return; 
        }

        const sortedWarehouses = effectiveWarehouseList.sort((a, b) => a.name.localeCompare(b.name));
        if(localUserWarehouseListKey) setLocalStorageItem(localUserWarehouseListKey, sortedWarehouses); 

        startTransition(() => {
            setWarehouses(sortedWarehouses);
            let currentSelectionId = currentWarehouseId; 
            const storedCurrentWarehouseIdKey = `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`;
            const storedId = getLocalStorageItem<string>(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID);

            if (sortedWarehouses.some(w => w.id === storedId)) {
                currentSelectionId = storedId;
            } else if (!sortedWarehouses.some(w => w.id === currentWarehouseId)) {
                const mainExists = sortedWarehouses.find(w => w.id === DEFAULT_WAREHOUSE_ID);
                currentSelectionId = mainExists ? DEFAULT_WAREHOUSE_ID : (sortedWarehouses[0]?.id || DEFAULT_WAREHOUSE_ID);
            }
            
            if (currentWarehouseId !== currentSelectionId) {
                setCurrentWarehouseId(currentSelectionId);
                if (currentUserId) setLocalStorageItem(storedCurrentWarehouseIdKey, currentSelectionId);
            }
        });
        if (isMountedRef.current) setIsSyncing(false);

    }, (error) => { 
        console.error("[Warehouses] Firestore subscription error:", error);
        if (isMountedRef.current) {
            if (localUserWarehouseListKey) {
                const fallbackWarehouses = getLocalStorageItem<Warehouse[]>(localUserWarehouseListKey, PREDEFINED_WAREHOUSES_LIST);
                startTransition(() => {
                    setWarehouses(fallbackWarehouses.sort((a,b)=>a.name.localeCompare(b.name)));
                    const storedCurrentWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : null;
                    const storedId = storedCurrentWarehouseIdKey ? getLocalStorageItem<string>(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
                    const finalCurrentId = fallbackWarehouses.some(w => w.id === storedId) ? storedId : (fallbackWarehouses.find(w => w.id === DEFAULT_WAREHOUSE_ID) ? DEFAULT_WAREHOUSE_ID : fallbackWarehouses[0]?.id || DEFAULT_WAREHOUSE_ID);
                    if(currentWarehouseId !== finalCurrentId) setCurrentWarehouseId(finalCurrentId);
                });
            }
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Red (Almacenes)", description: "No se pudieron cargar almacenes. Usando datos locales."}));
            if (isInitialFetchForUser && isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(true);
            setIsSyncing(false);
        }
    });
    return () => {
      unsubscribeFirestoreWarehouses();
      if(isMountedRef.current && isSyncing) setIsSyncing(false);
    };
  }, [currentUserId, isAuthenticated, isInitialFetchDoneForUserWarehouses, toast, setIsSyncing, setCurrentWarehouseId, setWarehouses, currentWarehouseId]); 


  useEffect(() => {
    let unsubscribeCountingList: (() => void) | null = null;
    const localKey = currentUserId && currentWarehouseId ? `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}` : null;

    // Load from localStorage first
    if (isMountedRef.current && localKey) {
      const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
      if (localList.length > 0) {
          startTransition(() => setCountingList(localList));
      } else if (countingList.length > 0 && localList.length === 0) { // If state has items but local is empty (e.g. after clear)
          startTransition(() => setCountingList([]));
      }
    } else if (isMountedRef.current && !localKey && countingList.length > 0) { // No user/warehouse, clear state
        startTransition(() => setCountingList([]));
    }

    if (!currentUserId || !currentWarehouseId || !isAuthenticated || !db) {
      if (unsubscribeCountingList) unsubscribeCountingList();
      if (isMountedRef.current && isSyncing && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
      return;
    }

    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);

    unsubscribeCountingList = subscribeToCountingList(
      currentUserId,
      currentWarehouseId,
      (productsFromFirestore) => {
        if (isMountedRef.current) {
            startTransition(() => {
                setCountingList(productsFromFirestore);
                if (localKey) setLocalStorageItem(localKey, productsFromFirestore);
            });
             if (isMountedRef.current && isSyncing && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
        }
      },
      (error) => {
        if (isMountedRef.current) {
            console.warn(`[CountingList] Firestore subscription error (user ${currentUserId}, warehouse ${currentWarehouseId}). Using localStorage.`, error);
            if (isSyncing && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Conteo)", description: "Usando datos locales."}));
        }
      }
    );
    return () => {
        if (unsubscribeCountingList) unsubscribeCountingList();
        if (isMountedRef.current && isSyncing && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, isAuthenticated, activeSection, toast, setIsSyncing, setCountingList]);


  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
    if (!warehouseId) return 'N/A';
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : `Almacén (${warehouseId.substring(0,6)}...)`;
  }, [warehouses]);


const modifyProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar."}));
        return;
    }

    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto no encontrado.`}));
         return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    const calculatedNewValue = Math.max(0, originalValue + change);

    let needsConfirmation = false;
    if (type === 'count') {
        const stockValue = productInList.stock ?? 0; 
        needsConfirmation = (stockValue !== 0) &&
                            calculatedNewValue > stockValue &&
                            originalValue <= stockValue;
    }

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

    setIsSyncing(true);
    try {
        let updatedProductData: DisplayProduct;
        if (type === 'count') {
             updatedProductData = { ...productInList, count: calculatedNewValue, lastUpdated: new Date().toISOString() };
             if (db && currentUserId) await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
             showDiscrepancyToastIfNeeded(updatedProductData, calculatedNewValue);
        } else { 
            const catalogProdToUpdate = await getProductFromIndexedDB(productBarcode); 
            if (catalogProdToUpdate) {
                 const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: calculatedNewValue };
                 await addOrUpdateProductToIndexedDB(updatedMasterProduct); 
                 // No necesitamos sincronizar y recargar todo el catálogo aquí para un cambio de stock.
                 // Actualizamos la copia en `catalogProducts` state si es que el producto está ahí.
                 setCatalogProducts(prev => prev.map(p => p.barcode === productBarcode ? {...p, stock: calculatedNewValue} : p));
                 
                 // Y actualizamos el producto en la lista de conteo (en Firestore)
                 updatedProductData = { ...productInList, stock: calculatedNewValue, lastUpdated: new Date().toISOString() };
                 if (db && currentUserId) await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
                 requestAnimationFrame(() => toast({ title: "Stock en Catálogo Actualizado" }));
            } else {
                 if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no en catálogo local."}));
                 setIsSyncing(false);
                 return;
            }
        }
    } catch (error: any) {
        console.error("Error modificando valor del producto:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current) {
             setIsSyncing(false);
             if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
        }
    }
  }, [
    currentWarehouseId, currentUserId, toast, countingList, db,
    isConfirmQuantityDialogOpen, activeSection, 
    setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction,
    setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen, showDiscrepancyToastIfNeeded,
    setCountingListItem, getProductFromIndexedDB, addOrUpdateProductToIndexedDB, setCatalogProducts, 
    setFocusTrigger
  ]);


const handleSetProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', newValue: number, sumValue: boolean = false) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar."}));
        return;
    }
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
        return;
    }
    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Producto no encontrado." }));
      if(isMountedRef.current) setOpenModifyDialog(null);
      return;
    }
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    if (type === 'count' && !sumValue && newValue === originalValue && !isConfirmQuantityDialogOpen) {
        if (isMountedRef.current) setOpenModifyDialog(null);
        if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
        return;
    }
    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    const finalNewValue = Math.max(0, calculatedValue);
    let needsConfirmation = false;
    if (type === 'count') {
        const stockValue = productInList.stock ?? 0;
        needsConfirmation = (stockValue !== 0) &&
                            finalNewValue > stockValue &&
                            (!sumValue || originalValue <= stockValue);
    }

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
    setIsSyncing(true);
    try {
        let updatedProductData: DisplayProduct;
        if (type === 'count') {
            updatedProductData = { ...productInList, count: finalNewValue, lastUpdated: new Date().toISOString() };
            if(db && currentUserId) await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
            showDiscrepancyToastIfNeeded(updatedProductData, finalNewValue);
        } else { 
            const catalogProdToUpdate = await getProductFromIndexedDB(productBarcode); 
            if (catalogProdToUpdate) {
                 const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: finalNewValue };
                 await addOrUpdateProductToIndexedDB(updatedMasterProduct);
                 setCatalogProducts(prev => prev.map(p => p.barcode === productBarcode ? {...p, stock: finalNewValue} : p));

                 updatedProductData = { ...productInList, stock: finalNewValue, lastUpdated: new Date().toISOString() };
                 if (db && currentUserId) await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData); 
                 requestAnimationFrame(() => toast({ title: "Stock en Catálogo Actualizado" }));
            } else {
                 if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no en catálogo local."}));
                 setIsSyncing(false);
                 return;
            }
        }
    } catch (error: any) {
        console.error("Error estableciendo valor del producto:", error);
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if (isMountedRef.current) {
             setIsSyncing(false);
             if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
        }
    }
    if(isMountedRef.current) setOpenModifyDialog(null);
}, [
    toast, countingList, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen, db, activeSection, 
    setCountingListItem, getProductFromIndexedDB, addOrUpdateProductToIndexedDB, setCatalogProducts,
    setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction, setConfirmQuantityNewValue,
    setIsConfirmQuantityDialogOpen, setOpenModifyDialog, showDiscrepancyToastIfNeeded, setFocusTrigger
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
         if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
         return;
     }
     const productInList = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
     if (!productInList) {
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
         return;
     }
    const finalConfirmedCount = Math.max(0, confirmQuantityNewValue);
    setIsSyncing(true);
    try {
        const updatedProductForFirestore: DisplayProduct = { ...productInList, count: finalConfirmedCount, lastUpdated: new Date().toISOString() };
        if(db && currentUserId) await setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
        showDiscrepancyToastIfNeeded(updatedProductForFirestore, finalConfirmedCount);
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsConfirmQuantityDialogOpen(false);
            setConfirmQuantityProductBarcode(null);
            setConfirmQuantityAction(null);
            setConfirmQuantityNewValue(null);
            setOpenModifyDialog(null); 
            if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
        }
    }
 }, [
    currentWarehouseId, currentUserId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue,
    toast, countingList, db, activeSection, 
    setCountingListItem,
    setIsSyncing, setIsConfirmQuantityDialogOpen, setConfirmQuantityProductBarcode, setConfirmQuantityAction,
    setConfirmQuantityNewValue, setOpenModifyDialog, showDiscrepancyToastIfNeeded, setFocusTrigger
]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
    if(isMountedRef.current) setProductToDelete(product);
    if(isMountedRef.current) setIsDeleteDialogOpen(true);
  }, [setProductToDelete, setIsDeleteDialogOpen]);

 const confirmDelete = useCallback(async () => {
    if (!isMountedRef.current || !productToDelete || !currentUserId || !currentWarehouseId) return;
    const {barcode: barcodeForToast, description: descriptionForToast } = productToDelete;
    setIsSyncing(true);
    try {
        if(db && currentUserId) await deleteCountingListItem(currentUserId, currentWarehouseId, barcodeForToast);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó de la lista.` }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsDeleteDialogOpen(false);
            setProductToDelete(null);
            if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
        }
    }
 }, [
    productToDelete, toast, currentUserId, currentWarehouseId, db, activeSection, 
    deleteCountingListItem,
    setIsSyncing, setIsDeleteDialogOpen, setProductToDelete, setFocusTrigger
]);

 const handleClearCurrentList = useCallback(async () => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return;
    setIsSyncing(true);
    try {
        if(db && currentUserId) await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Lista Borrada" }));
    } catch (error: any) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: error.message }));
    } finally {
        if(isMountedRef.current) {
            setIsSyncing(false);
            setIsDeleteListDialogOpen(false);
            if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
        }
    }
 }, [
    currentWarehouseId, toast, currentUserId, db, activeSection, 
    clearCountingListForWarehouseInFirestore,
    setIsSyncing, setIsDeleteListDialogOpen, setFocusTrigger
  ]);

 const handleExport = useCallback(() => {
     const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
     if (currentWarehouseList.length === 0) {
        if(isMountedRef.current) requestAnimationFrame(() => { if (isMountedRef.current) toast({ title: "Vacío", description: "No hay productos para exportar." }); });
        return;
    }
    try {
        if (typeof Papa === 'undefined') {
            requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Error Exportación", description: "La librería PapaParse no está cargada." }); });
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
    if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
 }, [countingList, currentWarehouseId, toast, getWarehouseName, activeSection, setFocusTrigger]);


 const handleRefreshStock = useCallback(async () => {
    if (!currentUserId || !currentWarehouseId || !isMountedRef.current || !db) {
        requestAnimationFrame(() => toast({ title: "Error", description: "No se puede actualizar."}));
        return;
    }
    if (!catalogProducts || catalogProducts.length === 0) { 
        requestAnimationFrame(() => toast({ title: "Catálogo Vacío", description: "Carga el catálogo primero." }));
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

        if (productsToUpdateInFirestore.length > 0 && db && currentUserId) {
            const batch = writeBatch(db);
            productsToUpdateInFirestore.forEach(itemToUpdate => {
                if (!itemToUpdate.barcode) return; 
                const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), itemToUpdate.barcode);
                const { barcode, warehouseId, ...dataToSet } = itemToUpdate; 
                batch.set(docRef, { ...dataToSet, firestoreLastUpdated: new Date() }, { merge: true });
            });
            await batch.commit();
        }

        if(updatedProductCount > 0 && isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s).` }));
        } else if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Productos ya actualizados." }));
        }

    } catch (error: any) {
         if (!isMountedRef.current) return; 
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` }));
    } finally {
         if (isMountedRef.current) { setIsRefreshingStock(false); setIsSyncing(false); if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); }
    }
 }, [
    currentWarehouseId, toast, currentUserId, countingList, catalogProducts, db, activeSection, 
    setIsRefreshingStock, setIsSyncing, setFocusTrigger
]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
    if(isMountedRef.current) setOpenModifyDialog({ type, product });
 }, [setOpenModifyDialog]);

 const handleCloseModifyDialog = () => {
    if(isMountedRef.current) setOpenModifyDialog(null);
    if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
 };


 const handleAddOrUpdateCatalogProduct = useCallback(async (productData: ProductDetail) => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    setProcessingStatus("Guardando en catálogo local...");
    try {
        await addOrUpdateProductToIndexedDB(productData); 
        await synchronizeAndLoadCatalog(); 
        requestAnimationFrame(() => toast({ title: "Producto Guardado en Catálogo Local" }));
        if(isMountedRef.current) { setProcessingStatus("Producto guardado."); setIsEditDetailDialogOpen(false); setProductToEditDetail(null); }
    } catch (error: any) {
        if (isMountedRef.current) {
            setProcessingStatus(`Error al guardar en catálogo local: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: `No se pudo guardar: ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); setProcessingStatus("");}
    }
  }, [toast, synchronizeAndLoadCatalog, addOrUpdateProductToIndexedDB, 
      setIsDbLoading, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail
  ]);

  const handleDeleteCatalogProduct = useCallback(async (barcodeToDelete: string) => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    setProcessingStatus("Eliminando de catálogo local...");
    try {
        await deleteProductFromIndexedDB(barcodeToDelete); 
        await synchronizeAndLoadCatalog(); 
        requestAnimationFrame(() => toast({ title: "Producto Eliminado del Catálogo Local" }));
        if(isMountedRef.current) { setProcessingStatus("Producto eliminado."); setIsEditDetailDialogOpen(false); setProductToEditDetail(null); }
    } catch (error: any) {
        if (isMountedRef.current) {
            setProcessingStatus(`Error al eliminar: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar Local", description: `No se pudo eliminar: ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); setProcessingStatus("");}
    }
  }, [toast, synchronizeAndLoadCatalog, deleteProductFromIndexedDB,
      setIsDbLoading, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail
  ]);


 const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    setProcessingStatus("Borrando catálogo local...");
    try {
      await clearProductDatabase(); 
      await synchronizeAndLoadCatalog(); 
      requestAnimationFrame(() => toast({ title: "Catálogo Local Borrado" }));
      if(isMountedRef.current) setProcessingStatus("Catálogo local borrado.");
    } catch (error: any) {
      if(isMountedRef.current) {
          setProcessingStatus(`Error al borrar: ${error.message}`);
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo Local", description: error.message }));
      }
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); setIsClearCatalogConfirmOpen(false); setProcessingStatus(""); }
    }
  }, [toast, synchronizeAndLoadCatalog, clearProductDatabase,
      setIsDbLoading, setProcessingStatus, setIsClearCatalogConfirmOpen
  ]);


 const handleGoogleSheetLoadToCatalog = useCallback(async (sheetUrlOrId: string) => {
    if (!isMountedRef.current) return;
    if (!sheetUrlOrId) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido" }));
      return;
    }
    setIsDbLoading(true);
    setProcessingStatus("Cargando desde Google Sheet a catálogo local...");
    try {
      const productsFromSheet = await fetchGoogleSheetData(sheetUrlOrId); 
      if (productsFromSheet.length > 0) {
        await addProductsToIndexedDB(productsFromSheet); 
        await synchronizeAndLoadCatalog(); 
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Catálogo Local Actualizado desde Google Sheet", description: `${productsFromSheet.length} productos cargados.` }));
            setGoogleSheetUrlForCatalog(sheetUrlOrId); 
            setProcessingStatus("Carga completa desde Google Sheet.");
        }
      } else {
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Productos", description: "No se encontraron productos." }));
            setProcessingStatus("No se encontraron productos.");
        }
      }
    } catch (error: any) {
      console.error("[handleGoogleSheetLoadToCatalog] Error:", error);
      if (isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Carga GS (Local)", description: error.message || "Error desconocido." }));
        setProcessingStatus(`Error al cargar: ${error.message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setProcessingStatus("");
      }
    }
  }, [toast, synchronizeAndLoadCatalog, addProductsToIndexedDB, setIsDbLoading, setProcessingStatus, setGoogleSheetUrlForCatalog]);


 const handleOpenEditDetailDialog = useCallback(async (product: ProductDetail | DisplayProduct) => {
    if (!product || !product.barcode || !isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede editar." }));
        return;
    }
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        let productDataToEdit = catalogProducts.find(cp => cp.barcode === product.barcode);
        if (!productDataToEdit) {
            productDataToEdit = await getProductFromIndexedDB(product.barcode);
        }

        if (productDataToEdit) {
            startTransition(() => setProductToEditDetail({
                ...productDataToEdit, 
                stock: (typeof productDataToEdit.stock === 'number' && !isNaN(productDataToEdit.stock)) ? productDataToEdit.stock : 0,
                expirationDate: productDataToEdit.expirationDate || null, 
            }));
        } else {
            const placeholderDetail: ProductDetail = {
                 barcode: product.barcode,
                 description: product.description || `Producto ${product.barcode}`,
                 provider: product.provider || "Desconocido",
                 stock: 'stock' in product ? ((typeof product.stock === 'number' && !isNaN(product.stock)) ? product.stock : 0) : 0,
                 expirationDate: 'expirationDate' in product ? (product.expirationDate || null) : null,
            };
            startTransition(() => setProductToEditDetail(placeholderDetail));
            if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Agregando Nuevo Producto", description: "Este producto se agregará al catálogo local." }));
        }
        if (isMountedRef.current) setIsEditDetailDialogOpen(true);
    } catch (error: any) {
         if (!isMountedRef.current) return;
         console.error("Error obteniendo detalles del producto para editar:", error);
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: `No se pudo cargar detalle: ${error.message}` }));
    } finally {
         if (isMountedRef.current) setIsDbLoading(false);
    }
 }, [
    toast, catalogProducts, getProductFromIndexedDB, 
    setIsDbLoading, setProductToEditDetail, setIsEditDetailDialogOpen
]);


 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
    if (!isMountedRef.current || !productToEditDetail) return;
    await handleAddOrUpdateCatalogProduct({ ...productToEditDetail, ...data }); 
 }, [handleAddOrUpdateCatalogProduct, productToEditDetail]);


 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Falta información para iniciar conteo." }));
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
            if (!dbProduct || !dbProduct.barcode) return;
            const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), dbProduct.barcode);
            const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'firestoreLastUpdated'> = { 
               description: dbProduct.description || `Producto ${dbProduct.barcode}`,
               provider: dbProduct.provider || "Desconocido",
               stock: dbProduct.stock ?? 0,
               expirationDate: dbProduct.expirationDate || null,
               count: 0,
               lastUpdated: new Date().toISOString(), 
            };
            batch.set(docRef, {...dataToSet, firestoreLastUpdated: new Date() }); 
        });
        await batch.commit();
        
        if (isMountedRef.current) {
            setActiveSection("Contador");
            requestAnimationFrame(() => {
                if (isMountedRef.current) setSearchTerm("");
            });
            requestAnimationFrame(() => toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` }));
            setProcessingStatus("Conteo iniciado.");
        }
    } catch (error: any) {
        console.error("Error iniciando conteo por proveedor:", error);
        if (isMountedRef.current) {
            setProcessingStatus(`Error al iniciar: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: `No se pudo iniciar el conteo. ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsSyncing(false); setProcessingStatus(""); if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); }
    }
  }, [
    toast, setActiveSection, currentWarehouseId, currentUserId, db, activeSection, 
    clearCountingListForWarehouseInFirestore,
    setIsSyncing, setProcessingStatus, setSearchTerm, setFocusTrigger
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
        setIsCameraScanMode(false); 
        setFocusTrigger(prev => prev + 1);
      } else if (newSection === 'Contador Cámara') {
        setIsCameraScanMode(true);
      } else {
        setIsCameraScanMode(false); 
      }
    }
  }, [setActiveSection, setIsCameraScanMode, setFocusTrigger, startTransition]);

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
    currentWarehouseId, currentUserId, setCurrentWarehouseId, setSearchTerm, startTransition
  ]);

    const handleAddWarehouse = useCallback(async (name: string) => {
      if (!isMountedRef.current || !currentUserId || !name.trim() || !db) {
          requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede agregar almacén.' }));
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
           requestAnimationFrame(() => toast({ title: "Almacén Agregado", description: `"${newWarehouse.name}" añadido a Firestore.` }));
      } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo agregar: ${error.message}` }));
      } finally {
          if(isMountedRef.current) setIsSyncing(false);
      }
    }, [
        warehouses, currentUserId, toast, db, addOrUpdateWarehouseInFirestore, setIsSyncing 
    ]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) {
            requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede actualizar.' }));
            return;
       }
       if(isMountedRef.current) setIsSyncing(true);
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, { ...warehouseToUpdate, name: warehouseToUpdate.name.toUpperCase() });
            requestAnimationFrame(() => toast({ title: "Almacén Actualizado", description: `"${warehouseToUpdate.name}" actualizado en Firestore.` }));
       } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo actualizar: ${error.message}` }));
       } finally {
            if(isMountedRef.current) setIsSyncing(false);
       }
   }, [
    toast, currentUserId, db, addOrUpdateWarehouseInFirestore, setIsSyncing
  ]);

   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
    if (!isMountedRef.current || !currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede eliminar.' }));
        return;
    }
    if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
      requestAnimationFrame(() => toast({ variant: 'destructive', title: 'No permitido', description: "Almacén Principal no se puede eliminar." }));
      return;
    }
    const warehouseNameForToast = warehouses.find(w => w.id === warehouseIdToDelete)?.name || warehouseIdToDelete;
    if(isMountedRef.current) setIsSyncing(true);
    try {
      await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
      requestAnimationFrame(() => toast({ title: "Almacén Eliminado", description: `"${warehouseNameForToast}" eliminado de Firestore.` }));
      // If the deleted warehouse was the current one, switch to default
      if (currentWarehouseId === warehouseIdToDelete) {
        setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
        if (currentUserId) setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID);
      }
    } catch (error: any) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo eliminar.` }));
    } finally {
      if(isMountedRef.current) setIsSyncing(false);
    }
  }, [
    toast, currentUserId, db, deleteWarehouseFromFirestore, setIsSyncing, warehouses, currentWarehouseId, setCurrentWarehouseId 
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
        const userIdToClear = currentUserId || LOGIN_USER; 
        setIsAuthenticated(false);
        setCurrentUserId(null); 
        
        if (typeof window !== 'undefined') {
             Object.keys(localStorage).forEach(key => {
                if (
                    key === LOCAL_STORAGE_USER_ID_KEY ||
                    key.startsWith(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${userIdToClear}`) ||
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
            setWarehouses(PREDEFINED_WAREHOUSES_LIST); 
            setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
            setActiveSection('Contador'); 
        });
        setIsInitialFetchDoneForUserWarehouses(false); 
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
            setIsInitialFetchDoneForUserWarehouses(false); 
            requestAnimationFrame(() => toast({ title: "Inicio de sesión exitoso" }));
            setLoginUsername("");
            setLoginPassword("");
        }
    } else {
        if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Credenciales Incorrectas" }));
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
                        <Label htmlFor="username-login">Usuario</Label>
                        <Input
                            id="username-login"
                            type="text"
                            placeholder="Nombre de usuario"
                            value={loginUsername}
                            onChange={(e) => setLoginUsername(e.target.value)}
                            className="mt-1"
                        />
                    </div>
                    <div>
                        <Label htmlFor="password-login">Contraseña</Label>
                        <Input
                            id="password-login"
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
          "fixed top-0 left-0 w-full h-1 z-[60]", 
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
                        placeholder="Buscar en lista actual..."
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
            <div id="database-content" className="h-full flex flex-col">
               <ProductDatabaseComponent
                  userId={currentUserId}
                  catalogProducts={catalogProducts}
                  isLoadingCatalog={isDbLoading} 
                  processingStatus={processingStatus}
                  googleSheetUrl={googleSheetUrlForCatalog}
                  setGoogleSheetUrl={setGoogleSheetUrlForCatalog}
                  onLoadFromGoogleSheet={handleGoogleSheetLoadToCatalog}
                  onAddOrUpdateProduct={handleAddOrUpdateCatalogProduct}
                  onDeleteProductRequest={handleDeleteCatalogProduct} 
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
            if (!open) {
                if(isMountedRef.current){
                    setConfirmQuantityProductBarcode(null);
                    setConfirmQuantityAction(null);
                    setConfirmQuantityNewValue(null);
                }
                if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
            }
          }}
          title="Confirmar Modificación"
          description={
             (() => {
               if (confirmQuantityNewValue === null || !confirmQuantityProductBarcode) return "¿Continuar con la modificación?";
               const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
               if (!product) return "¿Continuar con la modificación?";
               const stock = product.stock ?? 0;
               const description = product.description ?? confirmQuantityProductBarcode;
                if (stock > 0 && confirmQuantityNewValue > stock && (product.count ?? 0) <= stock) {
                   return `La cantidad contada (${confirmQuantityNewValue}) ahora SUPERA el stock del sistema (${stock}) para "${description}". ¿Confirmar?`;
               }
                return `Está a punto de modificar la cantidad contada para "${description}" a ${confirmQuantityNewValue}. ¿Continuar?`;
             })()
          }
          onConfirm={handleConfirmQuantityChange}
          onCancel={() => { if(isMountedRef.current){ setIsConfirmQuantityDialogOpen(false); setConfirmQuantityProductBarcode(null); setConfirmQuantityAction(null); setConfirmQuantityNewValue(null); } if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); }}
          isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
         isOpen={isDeleteDialogOpen}
         onOpenChange={(open) => { if(isMountedRef.current) setIsDeleteDialogOpen(open); if (!open) { if(isMountedRef.current) setProductToDelete(null); if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); } }}
         title="Confirmar Eliminación"
         description={ productToDelete ? `¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) de la lista actual?` : `¿Seguro que deseas eliminar este producto?`}
         onConfirm={confirmDelete}
         onCancel={() => { if(isMountedRef.current) setIsDeleteDialogOpen(false); if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); }}
         isDestructive={true}
         isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => { if(isMountedRef.current) setIsDeleteListDialogOpen(open); if (!open) { if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); } }}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})?`}
          onConfirm={handleClearCurrentList}
          onCancel={() => { if(isMountedRef.current) setIsDeleteListDialogOpen(false); if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); }}
          isDestructive={true}
          isProcessing={isTransitionPending || isSyncing}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(open); if (!open) { if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); } }}
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
            onCancel={() => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(false); if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1); }}
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
              if (activeSection === 'Contador') setFocusTrigger(prev => prev + 1);
            }
          }}
          selectedDetail={productToEditDetail}
          onSubmit={handleEditDetailSubmit}
          onDelete={(barcode) => { 
             if (currentUserId && barcode) handleDeleteCatalogProduct(barcode);
          }}
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


    