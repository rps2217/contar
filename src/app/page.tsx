
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
  clearProductDatabase as clearProductDatabaseInIndexedDB,
  addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database'; // Using IndexedDB for product catalog

// Firebase db instance for Firestore operations
import { db } from '@/lib/firebase'; 
import { writeBatch, doc, collection } from 'firebase/firestore';

// Firestore functions
import {
  subscribeToWarehouses,
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  setCountingListItem,
  deleteCountingListItem,
  subscribeToCountingList,
  clearCountingListForWarehouseInFirestore,
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
import { CountingListTable } from '@/components/counting-list-table';
import { ConsolidatedView } from '@/components/consolidated-view';
import { BarcodeEntry } from '@/components/barcode-entry';
import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera';
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
import Papa from 'papaparse';


// --- Google Sheet Data Fetching (Moved from ProductDatabaseComponent) ---
const extractSpreadsheetIdAndGid = (url: string): { spreadsheetId: string | null; gid: string | null } => {
    if (!url) return { spreadsheetId: null, gid: null };
    let spreadsheetId: string | null = null;
    let gid: string | null = null;
    const idRegex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const idMatch = url.match(idRegex);
    if (idMatch && idMatch[1]) {
        spreadsheetId = idMatch[1];
    } else if (!url.includes('/')) {
        spreadsheetId = url; // Assume it's just the ID
    }
    const gidRegex = /[#&]gid=([0-9]+)/;
    const gidMatch = url.match(gidRegex);
    if (gidMatch && gidMatch[1]) {
        gid = gidMatch[1];
    } else if (spreadsheetId && !url.includes('gid=')) {
        gid = '0';
    }
    return { spreadsheetId, gid };
};

async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);

    if (!spreadsheetId) {
        throw new Error("No se pudo extraer el ID de la Hoja de Google de la URL/ID proporcionado.");
    }

    const gidParam = gid ? `&gid=${gid}` : '&gid=0';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gidParam}`;

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error fetching Google Sheet (HTTP ${response.status}). URL: ${csvUrl}. Response: ${errorText}`);
            throw new Error(`Error al obtener la Hoja de Google (HTTP ${response.status}). Asegúrate de que la URL sea correcta y que la hoja esté compartida como "Cualquier persona con el enlace puede ver". Detalle: ${errorText}`);
        }
        const csvText = await response.text();
        
        return new Promise<ProductDetail[]>((resolve, reject) => {
            if (typeof Papa === 'undefined') {
                 console.error("PapaParse library is not loaded.");
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
                            ["codigo", "código", "cod.", "barra", "barras", "barcode", "producto", "descrip", "nombre", "stock", "proveedor", "laboratorio"].some(kw => header?.toLowerCase().includes(kw))
                        )) {
                            return;
                        }

                        const values = row as string[];
                        const barcode = values[BARCODE_COLUMN_INDEX]?.trim();
                        if (!barcode) return;

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
                    console.error("Error parsing CSV:", error);
                    reject(new Error(`Error al parsear el archivo CSV: ${error.message}`));
                }
            });
        });
    } catch (error: any) {
        console.error("Failed to load or process Google Sheet:", error);
        throw new Error(`No se pudo cargar o procesar la Hoja de Google: ${error.message}`);
    }
}
// --- End Google Sheet Data Fetching ---

// --- Almacenes predefinidos ---
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  // --- UI State ---
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
  const [isDbLoading, setIsDbLoading] = useState(true); // For IndexedDB catalog loads
  const [isSyncing, setIsSyncing] = useState(false); // For Firestore write operations indicator
  const [processingStatus, setProcessingStatus] = useState<string>(""); // For GS Load status
  const [focusTrigger, setFocusTrigger] = useState<number>(0); // For manual focus triggering


  // --- Warehouse State (Synced with Firestore, cached in localStorage) ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  const [isInitialFetchDoneForUserWarehouses, setIsInitialFetchDoneForUserWarehouses] = useState(false);

  // --- Product Catalog State (from IndexedDB, master is Firestore) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]);

  // --- Counting List State (from localStorage, synced with Firestore) ---
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
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
  const [isClearCatalogConfirmOpen, setIsClearCatalogConfirmOpen] = useState(false);
  const [isEditWarehouseDialogOpen, setIsEditWarehouseDialogOpen] = useState(false);
  const [warehouseToEdit, setWarehouseToEdit] = useState<Warehouse | null>(null);

  // --- Misc State ---
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [googleSheetUrlForCatalog, setGoogleSheetUrlForCatalog] = useLocalStorage<string>( GOOGLE_SHEET_URL_LOCALSTORAGE_KEY, "");
  
  // --- Camera Scan Mode ---
  const [isCameraScanMode, setIsCameraScanMode] = useState(false);
  const [isActivelyScanningByButton, setIsActivelyScanningByButton] = useState(false);


  const focusBarcodeIfCounting = useCallback(() => {
    const attemptFocus = (retriesLeft: number) => {
        if (retriesLeft <= 0 || !isMountedRef.current || activeSection !== 'Contador' || !barcodeInputRef.current || isCameraScanMode) {
          return;
        }
        if (document.activeElement !== barcodeInputRef.current) {
          barcodeInputRef.current.focus();
        }
        setTimeout(() => {
          if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current && !isCameraScanMode) {
            if (document.activeElement !== barcodeInputRef.current) {
              attemptFocus(retriesLeft - 1);
            }
          }
        }, 50); 
      };
    if (isMountedRef.current && activeSection === 'Contador' && barcodeInputRef.current && !isCameraScanMode) {
      requestAnimationFrame(() => {
        attemptFocus(3); 
      });
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

  // --- Catalog Management (Hybrid: Firestore as master, IndexedDB as local cache/offline fallback) ---
  const synchronizeAndLoadCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (!currentUserId) {
      console.warn("[SyncCatalog] No currentUserId, skipping catalog load.");
      setCatalogProducts([]);
      setIsDbLoading(false);
      return;
    }

    setIsDbLoading(true);
    setProcessingStatus("Cargando catálogo...");

    try {
        console.log(`[SyncCatalog] Loading catalog from IndexedDB for user ${currentUserId}...`);
        const localProducts = await getAllProductsFromIndexedDB();
        console.log(`[SyncCatalog] Loaded ${localProducts.length} products from IndexedDB.`);
        
        const sortedLocalProducts = localProducts
            .filter(p => p && p.barcode) // Ensure product and barcode exist
            .map(p => ({ ...p, description: p.description || `Producto ${p.barcode}` })) // Provide default description
            .sort((a, b) => (a.description || '').localeCompare(b.description || '')); // Sort by description

        startTransition(() => {
            setCatalogProducts(sortedLocalProducts);
        });
        setProcessingStatus(localProducts.length > 0 ? "Catálogo local cargado." : "Catálogo local vacío.");

    } catch (error: any) {
        console.error("[SyncCatalog] Error loading catalog from IndexedDB:", error.message, error.stack);
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo cargar el catálogo local." }));
            startTransition(() => setCatalogProducts([]));
            setProcessingStatus("Error al cargar catálogo local.");
        }
    } finally {
        if (isMountedRef.current) {
            setIsDbLoading(false);
        }
    }
  }, [
    currentUserId, toast, 
    getAllProductsFromIndexedDB, 
    setCatalogProducts, setIsDbLoading, setProcessingStatus, startTransition
  ]);


  const handleAddProduct = useCallback(async (scannedBarcode?: string) => {
    if (!isMountedRef.current) return;
    const rawBarcode = scannedBarcode ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      if (!scannedBarcode && isMountedRef.current) { 
        setBarcode(""); 
        setFocusTrigger(prev => prev + 1);
      }
      return;
    }

    if (!currentUserId || !currentWarehouseId || !db) { 
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Falta ID de usuario, almacén o conexión a la nube." }));
      if (!scannedBarcode && isMountedRef.current) { setBarcode(""); setFocusTrigger(prev => prev + 1); }
      return;
    }

    if (lastScannedTimeoutRef.current && trimmedBarcode === lastScannedBarcode) {
       if (!scannedBarcode && isMountedRef.current) { setBarcode(""); setFocusTrigger(prev => prev + 1); }
       return;
    }
    if (isMountedRef.current) {
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
      setLastScannedBarcode(trimmedBarcode);
      lastScannedTimeoutRef.current = setTimeout(() => { if (isMountedRef.current) setLastScannedBarcode(null); }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
    }
    
    let productDataForFirestore: DisplayProduct;
    const existingProductInList = countingList.find(p => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductInList) {
      const newCount = (existingProductInList.count ?? 0) + 1;
      productDataForFirestore = { ...existingProductInList, count: newCount, lastUpdated: new Date().toISOString() };
      
      if (activeSection !== 'Contador' && activeSection !== 'Contador Cámara') {
          showDiscrepancyToastIfNeeded(productDataForFirestore);
      }
    } else {
      let baseProductData: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'count' | 'lastUpdated'| 'firestoreLastUpdated'>;
      const barcodeToLookup = trimmedBarcode;
      
      let catalogProd = catalogProducts.find(p => p.barcode === barcodeToLookup);
      console.log(`[handleAddProduct] Buscando código: "'${barcodeToLookup}'" (longitud: ${barcodeToLookup.length})`);
      if (!catalogProd && isMountedRef.current) { 
          try {
            console.log(`[handleAddProduct] Producto no en estado catalogProducts, buscando en IndexedDB: '${barcodeToLookup}'`);
            catalogProd = await getProductFromIndexedDB(barcodeToLookup);
            console.log(`[handleAddProduct] Resultado de IndexedDB para '${barcodeToLookup}':`, JSON.parse(JSON.stringify(catalogProd || {})));
          } catch (dbError) {
            console.warn("[handleAddProduct] Fallback to IndexedDB failed:", dbError);
          }
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
            // No toast for unknown product if in counter section to maintain flow
        }
        playBeep(440, 300);
      }

      productDataForFirestore = {
        ...baseProductData,
        barcode: trimmedBarcode,
        warehouseId: currentWarehouseId,
        count: 1,
        lastUpdated: new Date().toISOString(),
      };
      if (activeSection !== 'Contador' && activeSection !== 'Contador Cámara') {
          showDiscrepancyToastIfNeeded(productDataForFirestore); 
      }
    }
    
    console.log("[handleAddProduct] Objeto a enviar a setCountingListItem:", JSON.parse(JSON.stringify(productDataForFirestore)));
    if (!productDataForFirestore.barcode || productDataForFirestore.barcode.trim() === "") {
        console.error("[handleAddProduct] Intento de guardar producto sin barcode válido:", productDataForFirestore);
        toast({ variant: "destructive", title: "Error Interno", description: "No se puede agregar producto sin código de barras." });
        if (!scannedBarcode && isMountedRef.current) { setBarcode(""); setFocusTrigger(prev => prev + 1); }
        return;
    }
    
    if (currentUserId && currentWarehouseId && db) {
      setIsSyncing(true);
      setCountingListItem(currentUserId, currentWarehouseId, productDataForFirestore)
        .catch(error => {
          console.error("[handleAddProduct] Error syncing with Firestore:", error);
        })
        .finally(() => {
          if (isMountedRef.current) setIsSyncing(false);
        });
    }

    if (!scannedBarcode && isMountedRef.current) {
      setBarcode(""); 
      setFocusTrigger(prev => prev + 1);
    } else if (scannedBarcode && isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) {
      if (activeSection === 'Contador') { 
         setFocusTrigger(prev => prev + 1);
      }
    }
  }, [
    barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, 
    activeSection, catalogProducts, getProductFromIndexedDB,
    setBarcode, setIsSyncing, setLastScannedBarcode, startTransition, 
    showDiscrepancyToastIfNeeded, setCountingListItem, focusBarcodeIfCounting
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
  }, []);

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
    let unsubscribeFirestoreWarehouses: (() => void) | null = null;
    const localUserWarehouseListKey = currentUserId ? `${LOCAL_STORAGE_WAREHOUSE_LIST_KEY_PREFIX}${currentUserId}` : null;

    if (isMountedRef.current) {
        let initialWarehouses = PREDEFINED_WAREHOUSES_LIST;
        if (localUserWarehouseListKey) {
            const localStoredWarehouses = getLocalStorageItem<Warehouse[]>(localUserWarehouseListKey, []);
            if (localStoredWarehouses.length > 0) {
                initialWarehouses = localStoredWarehouses;
            }
        }
        startTransition(() => setWarehouses(initialWarehouses.sort((a,b) => a.name.localeCompare(b.name))));
        
        const storedCurrentWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : null;
        let newCurrentId = DEFAULT_WAREHOUSE_ID;

        if (storedCurrentWarehouseIdKey) {
            const storedId = getLocalStorageItem<string>(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID);
            if (initialWarehouses.some(w => w.id === storedId)) {
                newCurrentId = storedId;
            } else if (initialWarehouses.length > 0) {
                newCurrentId = initialWarehouses.find(w => w.id === DEFAULT_WAREHOUSE_ID) ? DEFAULT_WAREHOUSE_ID : initialWarehouses[0].id;
            }
        }
        if (currentWarehouseId !== newCurrentId) setCurrentWarehouseId(newCurrentId);
    }

    if (!currentUserId || !db || !isAuthenticated) {
        setIsInitialFetchDoneForUserWarehouses(false); 
        return () => { if(unsubscribeFirestoreWarehouses) unsubscribeFirestoreWarehouses(); };
    }

    let isInitialFetchForUser = !isInitialFetchDoneForUserWarehouses;
    if(isMountedRef.current) setIsSyncing(true); 

    unsubscribeFirestoreWarehouses = subscribeToWarehouses(currentUserId,
      async (fetchedWarehousesFromFirestore) => {
        if (!isMountedRef.current || !currentUserId) return; 
        
        let effectiveWarehouseList = [...fetchedWarehousesFromFirestore];
        
        if (isInitialFetchForUser) {
            setIsInitialFetchDoneForUserWarehouses(true); 
            isInitialFetchForUser = false;
            
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
                        batch.set(warehouseDocRef, { name: wh.name, id: wh.id }); 
                    });
                    await batch.commit();
                } catch (err) {
                    console.error(`[Warehouses] Failed to add predefined warehouses to Firestore for ${currentUserId}:`, err);
                    if (isMountedRef.current) {
                         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                    }
                } finally {
                    if (isMountedRef.current) setIsSyncing(false);
                }
            }
        }
        
        // Firestore is the source of truth, always use its data after initial setup
        const sortedWarehouses = fetchedWarehousesFromFirestore.sort((a, b) => a.name.localeCompare(b.name));

        if(localUserWarehouseListKey) { 
            setLocalStorageItem(localUserWarehouseListKey, sortedWarehouses); 
        }

        startTransition(() => {
            setWarehouses(prevWarehouses => {
                if (JSON.stringify(prevWarehouses) !== JSON.stringify(sortedWarehouses)) {
                    return sortedWarehouses;
                }
                return prevWarehouses;
            });

            let currentSelectionId = currentWarehouseId; 
            const finalStoredCurrentWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : null;
            const storedId = finalStoredCurrentWarehouseIdKey ? getLocalStorageItem<string>(finalStoredCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
            
            if (sortedWarehouses.some(w => w.id === storedId)) {
                currentSelectionId = storedId;
            } else if (sortedWarehouses.length > 0 && !sortedWarehouses.some(w => w.id === currentWarehouseId)) {
                const mainExists = sortedWarehouses.find(w => w.id === DEFAULT_WAREHOUSE_ID);
                currentSelectionId = mainExists ? DEFAULT_WAREHOUSE_ID : (sortedWarehouses[0]?.id || DEFAULT_WAREHOUSE_ID);
            } else if (sortedWarehouses.length === 0 && PREDEFINED_WAREHOUSES_LIST.length > 0) { 
                currentSelectionId = DEFAULT_WAREHOUSE_ID; 
            }
            
            if (currentWarehouseId !== currentSelectionId) {
                setCurrentWarehouseId(currentSelectionId);
                if (currentUserId && finalStoredCurrentWarehouseIdKey) {
                    setLocalStorageItem(finalStoredCurrentWarehouseIdKey, currentSelectionId);
                }
            }
        });
        if (isMountedRef.current && isSyncing) setIsSyncing(false);

    }, (error) => { 
        console.error("[Warehouses] Firestore subscription error:", error);
        if (isMountedRef.current) { 
            if (isInitialFetchForUser) setIsInitialFetchDoneForUserWarehouses(true);
            if (isSyncing) setIsSyncing(false);
        }
    });

    return () => {
      if (unsubscribeFirestoreWarehouses) unsubscribeFirestoreWarehouses();
      if(isMountedRef.current && isSyncing) setIsSyncing(false);
    };
  }, [
    currentUserId, 
    isAuthenticated,
    toast, 
    addOrUpdateWarehouseInFirestore, // Firestore function
    getLocalStorageItem, // Local storage util
    setLocalStorageItem, // Local storage util
    startTransition, // React transition
    // No incluir warehouses, currentWarehouseId, y sus setters como dependencias directas si son modificados DENTRO del efecto
    // Solo incluir las funciones estables que vienen de fuera
  ]); 

  useEffect(() => {
    let unsubscribeFirestore: (() => void) | undefined;
    const localListKey = currentUserId && currentWarehouseId ? `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}` : null;

    if (isMountedRef.current && localListKey) {
        const localList = getLocalStorageItem<DisplayProduct[]>(localListKey, []);
        if (JSON.stringify(countingList) !== JSON.stringify(localList)) {
             startTransition(() => setCountingList(localList));
        }
    }

    if (!currentUserId || !currentWarehouseId || !isAuthenticated || !db) {
      if (isMountedRef.current && isSyncing) setIsSyncing(false);
      return () => { if (unsubscribeFirestore) unsubscribeFirestore(); };
    }

    if (isMountedRef.current) setIsSyncing(true);
    
    unsubscribeFirestore = subscribeToCountingList(
      currentUserId,
      currentWarehouseId,
      (productsFromFirestore) => { 
        if (isMountedRef.current) {
          const newSortedList = [...productsFromFirestore].sort((a,b) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime());
          
          if (JSON.stringify(countingList) !== JSON.stringify(newSortedList)) {
            startTransition(() => setCountingList(newSortedList));
          }

          if(localListKey) { 
            setLocalStorageItem(localListKey, newSortedList);
          }
          if (isSyncing) setIsSyncing(false);
        }
      },
      (error) => { 
        if (isMountedRef.current) {
          console.error(`[CountingList] Firestore subscription error (user ${currentUserId}, warehouse ${currentWarehouseId}).`, error);
          if (isSyncing) setIsSyncing(false);
        }
      }
    );

    return () => {
      if (unsubscribeFirestore) unsubscribeFirestore();
      if (isMountedRef.current && isSyncing) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, isAuthenticated, db, toast, countingList, setCountingList, setIsSyncing, getLocalStorageItem, setLocalStorageItem, startTransition, subscribeToCountingList]);

  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
    if (!warehouseId) return 'N/A';
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : `Almacén (${warehouseId.substring(0,6)}...)`;
  }, [warehouses]);

 const modifyProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar. Verifique la conexión y el usuario."}));
        setFocusTrigger(prev => prev + 1);
        return;
    }

    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto no encontrado en la lista actual.`}));
         setFocusTrigger(prev => prev + 1);
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
        setFocusTrigger(prev => prev + 1);
        return;
    }
    
    let updatedProductData: DisplayProduct;
    if (type === 'count') {
        updatedProductData = { ...productInList, count: calculatedNewValue, lastUpdated: new Date().toISOString() };
    } else { 
        // Si es stock, el maestro está en IndexedDB
        const catalogProdToUpdate = await getProductFromIndexedDB(productBarcode);
        if (catalogProdToUpdate) {
            const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: calculatedNewValue };
            await addOrUpdateProductToIndexedDB(updatedMasterProduct); // Update IndexedDB
            // Actualizar en el estado local del catálogo para reflejar en UI
            setCatalogProducts(prev => prev.map(p => p.barcode === productBarcode ? updatedMasterProduct : p));
            if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Stock Actualizado (Local)" }));
        } else {
            if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no en catálogo local para actualizar stock."}));
        }
        // El stock en la countingList (que es una copia/referencia) también se actualiza para UI local
        updatedProductData = { ...productInList, stock: calculatedNewValue, lastUpdated: new Date().toISOString() };
    }
    
    if (type === 'count' && currentUserId && currentWarehouseId && db) { // Solo 'count' se sincroniza a Firestore para la lista de conteo
        setIsSyncing(true);
        try {
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
            if (activeSection !== 'Contador' && activeSection !== 'Contador Cámara') {
                showDiscrepancyToastIfNeeded(updatedProductData, calculatedNewValue);
            }
        } catch (error: any) { /* Error toast manejado en setCountingListItem */ }
        finally { if (isMountedRef.current) setIsSyncing(false); }
    }
    
    // Actualizar la lista local para reflejar cambios (especialmente de stock local)
    startTransition(() => {
        setCountingList(prevList =>
            prevList.map(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId ? updatedProductData : p)
        );
    });
    if(isMountedRef.current) setFocusTrigger(prev => prev + 1);

  }, [
    currentWarehouseId, currentUserId, toast, countingList, db,
    isConfirmQuantityDialogOpen, activeSection, catalogProducts,
    setCountingList, setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction,
    setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen, showDiscrepancyToastIfNeeded,
    setCountingListItem, getProductFromIndexedDB, addOrUpdateProductToIndexedDB,
    setCatalogProducts, setFocusTrigger, startTransition
  ]);

  const handleSetProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', newValue: number, sumValue: boolean = false) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar. Verifique la conexión y el usuario."}));
        setOpenModifyDialog(null);
        setFocusTrigger(prev => prev + 1);
        return;
    }
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        if(isMountedRef.current) setOpenModifyDialog(null);
        setFocusTrigger(prev => prev + 1);
        return;
    }

    const productInList = countingList.find(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId);
    if (!productInList) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Producto no encontrado en la lista actual." }));
      if(isMountedRef.current) setOpenModifyDialog(null);
      setFocusTrigger(prev => prev + 1);
      return;
    }

    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    if (type === 'count' && !sumValue && newValue === originalValue && !isConfirmQuantityDialogOpen) {
        if (isMountedRef.current) setOpenModifyDialog(null);
        setFocusTrigger(prev => prev + 1);
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
        setFocusTrigger(prev => prev + 1);
        return;
    }

    let updatedProductData: DisplayProduct;
    if (type === 'count') {
        updatedProductData = { ...productInList, count: finalNewValue, lastUpdated: new Date().toISOString() };
    } else { 
        const catalogProdToUpdate = await getProductFromIndexedDB(productBarcode);
        if (catalogProdToUpdate) {
            const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: finalNewValue };
            await addOrUpdateProductToIndexedDB(updatedMasterProduct);
            setCatalogProducts(prev => prev.map(p => p.barcode === productBarcode ? updatedMasterProduct : p));
            if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Stock Actualizado (Local)" }));
        } else {
            if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no en catálogo local para actualizar stock."}));
        }
        updatedProductData = { ...productInList, stock: finalNewValue, lastUpdated: new Date().toISOString() };
    }
    
    if (type === 'count' && currentUserId && currentWarehouseId && db) {
        setIsSyncing(true);
        try {
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
            if (activeSection !== 'Contador' && activeSection !== 'Contador Cámara') {
                showDiscrepancyToastIfNeeded(updatedProductData, finalNewValue);
            }
        } catch (error: any) { /* Error toast handled in setCountingListItem */ }
        finally { if (isMountedRef.current) setIsSyncing(false); }
    }
    
    startTransition(() => {
        setCountingList(prevList =>
            prevList.map(p => p.barcode === productBarcode && p.warehouseId === currentWarehouseId ? updatedProductData : p)
        );
    });
    if(isMountedRef.current) {
        setOpenModifyDialog(null);
        setFocusTrigger(prev => prev + 1);
    }
}, [
    toast, countingList, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen, db, activeSection, catalogProducts,
    setCountingListItem, getProductFromIndexedDB, addOrUpdateProductToIndexedDB,
    setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction, setConfirmQuantityNewValue,
    setIsConfirmQuantityDialogOpen, setOpenModifyDialog, showDiscrepancyToastIfNeeded, setCatalogProducts, setFocusTrigger, startTransition, setCountingList
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
         setFocusTrigger(prev => prev + 1);
         return;
     }

     const productInList = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
     if (!productInList) {
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         setFocusTrigger(prev => prev + 1);
         return;
     }

    const finalConfirmedCount = Math.max(0, confirmQuantityNewValue);
    const updatedProductForFirestore: DisplayProduct = { ...productInList, count: finalConfirmedCount, lastUpdated: new Date().toISOString() };
    
    setIsSyncing(true);
    setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore)
      .then(() => {
        if (isMountedRef.current && activeSection !== 'Contador' && activeSection !== 'Contador Cámara') {
          showDiscrepancyToastIfNeeded(updatedProductForFirestore, finalConfirmedCount);
        }
      })
      .catch(error => { /* Error toast handled in setCountingListItem */ })
      .finally(() => {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsConfirmQuantityDialogOpen(false);
            setConfirmQuantityProductBarcode(null);
            setConfirmQuantityAction(null);
            setConfirmQuantityNewValue(null);
            setOpenModifyDialog(null); 
            setFocusTrigger(prev => prev + 1);
        }
      });
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
    if (!isMountedRef.current || !productToDelete || !currentUserId || !currentWarehouseId || !db) {
      setFocusTrigger(prev => prev + 1); return;
    }
    const { barcode: barcodeToDelete, description: descriptionForToast } = productToDelete;

    setIsSyncing(true);
    deleteCountingListItem(currentUserId, currentWarehouseId, barcodeToDelete)
      .then(() => {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" se eliminó de la lista.` }));
      })
      .catch(error => { /* Error toast handled in deleteCountingListItem */ })
      .finally(() => {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsDeleteDialogOpen(false);
            setProductToDelete(null);
            setFocusTrigger(prev => prev + 1);
        }
      });
 }, [
    productToDelete, toast, currentUserId, currentWarehouseId, db,
    deleteCountingListItem, 
    setIsSyncing, setIsDeleteDialogOpen, setProductToDelete, setFocusTrigger
]);

 const handleClearCurrentList = useCallback(async () => {
    if (!isMountedRef.current || !currentWarehouseId || !currentUserId || !db) {
      setFocusTrigger(prev => prev + 1); return;
    }
    
    setIsSyncing(true);
    clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId)
      .then(() => {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Lista Borrada" }));
      })
      .catch(error => { /* Error toast handled in clearCountingListForWarehouseInFirestore */})
      .finally(() => {
        if(isMountedRef.current) {
            setIsSyncing(false);
            setIsDeleteListDialogOpen(false);
            setFocusTrigger(prev => prev + 1);
        }
      });
 }, [
    currentWarehouseId, toast, currentUserId, db, 
    clearCountingListForWarehouseInFirestore, 
    setIsSyncing, setIsDeleteListDialogOpen, setFocusTrigger
  ]);

 const handleExport = useCallback(() => {
     const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
     if (currentWarehouseList.length === 0) {
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Vacío", description: "No hay productos para exportar." }));
        return;
    }
    try {
        if (typeof Papa === 'undefined') {
            requestAnimationFrame(() => {
                if(isMountedRef.current) toast({ variant: "destructive", title: "Error Exportación", description: "La librería PapaParse no está cargada." });
            });
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
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Exportado" }));
    } catch (error) {
        console.error("Error exportando inventario:", error);
        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Exportación" }));
    }
    setFocusTrigger(prev => prev + 1);
 }, [countingList, currentWarehouseId, toast, getWarehouseName, setFocusTrigger]);

 const handleRefreshStock = useCallback(async () => {
    if (!currentUserId || !currentWarehouseId || !isMountedRef.current || !db) {
        requestAnimationFrame(() => toast({ title: "Error", description: "No se puede actualizar. Verifique la conexión y el usuario."}));
        setFocusTrigger(prev => prev + 1);
        return;
    }
    if (!catalogProducts || catalogProducts.length === 0) { 
        requestAnimationFrame(() => toast({ title: "Catálogo Vacío", description: "Carga el catálogo primero." }));
        setFocusTrigger(prev => prev + 1);
        return;
    }
    if(isMountedRef.current) { setIsRefreshingStock(true); setIsSyncing(true); }
    let updatedProductCount = 0;
    
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
        try {
            const batch = writeBatch(db);
            productsToUpdateInFirestore.forEach(itemToUpdate => {
                if (!itemToUpdate.barcode) return; 
                const docRef = doc(collection(db, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), itemToUpdate.barcode);
                const { barcode, warehouseId, ...dataToSet } = itemToUpdate; 
                batch.set(docRef, dataToSet, { merge: true });
            });
            await batch.commit();
            if (isMountedRef.current) {
                requestAnimationFrame(() => toast({ title: "Datos Actualizados en Nube", description: `${updatedProductCount} producto(s) sincronizado(s) con la nube.` }));
            }
        } catch (error: any) {
            if (isMountedRef.current) {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Sincronizar", description: `No se pudo actualizar en la nube: ${error.message}` }));
            }
        }
    } else if (updatedProductCount === 0 && isMountedRef.current) { 
        requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Los productos en la lista ya estaban actualizados." }));
    }
    
    if (isMountedRef.current) { setIsRefreshingStock(false); setIsSyncing(false); setFocusTrigger(prev => prev + 1); }

 }, [
    currentWarehouseId, toast, currentUserId, countingList, catalogProducts, db,
    setIsRefreshingStock, setIsSyncing, setFocusTrigger
]);

 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
    if(isMountedRef.current) setOpenModifyDialog({ type, product });
 }, [setOpenModifyDialog]);

 const handleCloseModifyDialog = () => {
    if(isMountedRef.current) setOpenModifyDialog(null);
    setFocusTrigger(prev => prev + 1);
 };

  const handleAddOrUpdateCatalogProduct = useCallback(async (productData: ProductDetail) => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    setProcessingStatus("Guardando en catálogo local...");
    try {
      await addOrUpdateProductToIndexedDB(productData);
      await synchronizeAndLoadCatalog(); 
      
      requestAnimationFrame(() => toast({ title: "Producto Guardado (Local)" }));
      setProcessingStatus("Producto guardado localmente.");
      setIsEditDetailDialogOpen(false);
      setProductToEditDetail(null);
    } catch (error: any) {
      console.error("Error guardando producto en catálogo local:", error);
      if (isMountedRef.current) {
        setProcessingStatus(`Error al guardar: ${error.message}`);
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo guardar: ${error.message}` }));
      }
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); setProcessingStatus(""); }
    }
  }, [
      synchronizeAndLoadCatalog, toast, addOrUpdateProductToIndexedDB, 
      setIsDbLoading, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail
  ]);

  const handleDeleteCatalogProduct = useCallback(async (barcodeToDelete: string) => {
    if (!isMountedRef.current) return;

    setIsDbLoading(true);
    setProcessingStatus("Eliminando de catálogo local...");
    try {
        await deleteProductFromIndexedDB(barcodeToDelete);
        await synchronizeAndLoadCatalog(); 
        
        requestAnimationFrame(() => toast({ title: "Producto Eliminado (Local)" }));
        setProcessingStatus("Producto eliminado localmente.");
        setIsEditDetailDialogOpen(false); 
        setProductToEditDetail(null);
    } catch (error: any) {
        console.error("Error eliminando producto del catálogo local:", error);
        if (isMountedRef.current) {
            setProcessingStatus(`Error al eliminar: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); setProcessingStatus(""); }
    }
  }, [
      synchronizeAndLoadCatalog, toast, deleteProductFromIndexedDB, 
      setIsDbLoading, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail
  ]);

 const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    setProcessingStatus("Borrando catálogo local...");
    try {
      await clearProductDatabaseInIndexedDB(); 
      await synchronizeAndLoadCatalog(); 
      
      requestAnimationFrame(() => toast({ title: "Catálogo Local Borrado" }));
      setProcessingStatus("Catálogo local borrado.");
    } catch (error: any) {
      console.error("Error borrando catálogo local:", error); // Added curly brace
      if(isMountedRef.current) {
          setProcessingStatus(`Error al borrar: ${error.message}`);
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo Local", description: error.message }));
      }
    } finally { // Added curly brace
      if (isMountedRef.current) { setIsDbLoading(false); setIsClearCatalogConfirmOpen(false); setProcessingStatus(""); }
    }
  }, [
    synchronizeAndLoadCatalog, toast, clearProductDatabaseInIndexedDB,
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
            setProcessingStatus("Carga completa a catálogo local.");
        }
      } else {
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Productos", description: "No se encontraron productos en la hoja." }));
            setProcessingStatus("No se encontraron productos.");
        }
      }
    } catch (error: any) {
      console.error("[handleGoogleSheetLoadToCatalog] Error:", error);
      if (isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Carga GS", description: error.message || "Error desconocido." }));
        setProcessingStatus(`Error al cargar: ${error.message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setProcessingStatus("");
      }
    }
  }, [
      synchronizeAndLoadCatalog, toast, addProductsToIndexedDB, 
      setIsDbLoading, setProcessingStatus, setGoogleSheetUrlForCatalog
  ]);

 const handleOpenEditDetailDialog = useCallback(async (product: ProductDetail | DisplayProduct) => {
    if (!product || !product.barcode || !isMountedRef.current ) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede editar." }));
        return;
    }
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        let productDataToEdit = await getProductFromIndexedDB(product.barcode);

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
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo cargar detalle: ${error.message}` }));
    } finally {
         if (isMountedRef.current) setIsDbLoading(false);
    }
 }, [
    toast, getProductFromIndexedDB,
    setIsDbLoading, setProductToEditDetail, setIsEditDetailDialogOpen, startTransition
]);

 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
    if (!isMountedRef.current || !productToEditDetail) return;
    await handleAddOrUpdateCatalogProduct({ ...productToEditDetail, ...data }); 
 }, [handleAddOrUpdateCatalogProduct, productToEditDetail]);

 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Falta información para iniciar conteo." }));
      setFocusTrigger(prev => prev + 1);
      return;
    }
    if (!productsToCount || productsToCount.length === 0) {
        requestAnimationFrame(() => toast({ title: "Vacío", description: "No hay productos para este proveedor." }));
        setFocusTrigger(prev => prev + 1);
        return;
    }
    
    setIsSyncing(true); 
    setProcessingStatus("Iniciando conteo por proveedor...");
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
            batch.set(docRef, dataToSet); 
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
        if (isMountedRef.current) { setIsSyncing(false); setProcessingStatus(""); setFocusTrigger(prev => prev + 1); }
    }
  }, [
    toast, setActiveSection, currentWarehouseId, currentUserId, db,
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
  }, [setActiveSection, setIsCameraScanMode, startTransition, setFocusTrigger]);

  const toggleShowOnlyDiscrepancies = useCallback(() => {
    setShowOnlyDiscrepancies(prev => !prev);
    setFocusTrigger(prev => prev + 1);
  }, [setShowOnlyDiscrepancies, setFocusTrigger]);

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
         setFocusTrigger(prev => prev + 1);
   }, [
    currentWarehouseId, currentUserId, setCurrentWarehouseId, setSearchTerm, startTransition, setLocalStorageItem, setFocusTrigger
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
      } catch (error: any) {
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
       } catch (error: any) {
       } finally {
            if(isMountedRef.current) setIsSyncing(false);
            if(isMountedRef.current) {
                setIsEditWarehouseDialogOpen(false);
                setWarehouseToEdit(null); 
            }
       }
   }, [
    toast, currentUserId, db, addOrUpdateWarehouseInFirestore, setIsSyncing, setIsEditWarehouseDialogOpen, setWarehouseToEdit
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
    
    if(isMountedRef.current) setIsSyncing(true);
    try {
      await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
    } catch (error: any) {
    } finally {
      if(isMountedRef.current) {
          setIsSyncing(false);
      }
    }
  }, [
    toast, currentUserId, db, deleteWarehouseFromFirestore, setIsSyncing
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
        {activeSection === 'Contador' && currentUserId && !isCameraScanMode && (
            <div id="contador-content-wrapper" className="space-y-4 h-full flex flex-col">
              <div className="mb-4 space-y-4">
                <BarcodeEntry
                    barcode={barcode}
                    setBarcode={setBarcode}
                    onAddProduct={handleAddProduct}
                    onRefreshStock={handleRefreshStock}
                    isLoading={isDbLoading} 
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
                  onLoadFromGoogleSheet={handleGoogleSheetLoadToCatalog}
                  onAddOrUpdateProduct={handleAddOrUpdateCatalogProduct}
                  onDeleteProductRequest={(productBarcode) => { 
                      const product = catalogProducts.find(p => p.barcode === productBarcode);
                      setProductToDelete(product ? { ...product, count: 0, warehouseId: currentWarehouseId, lastUpdated: new Date().toISOString() } : { barcode: productBarcode, description: productBarcode, count:0, warehouseId: currentWarehouseId, lastUpdated: new Date().toISOString()});
                      setIsDeleteDialogOpen(true); 
                  }}
                  onClearCatalogRequest={() => setIsClearCatalogConfirmOpen(true)}
                  onStartCountByProvider={handleStartCountByProvider}
                  onEditProductRequest={handleOpenEditDetailDialog}
                  setGoogleSheetUrl={setGoogleSheetUrlForCatalog}
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
            if (!open) {
                if(isMountedRef.current){
                    setConfirmQuantityProductBarcode(null);
                    setConfirmQuantityAction(null);
                    setConfirmQuantityNewValue(null);
                }
                setFocusTrigger(prev => prev + 1);
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
          onCancel={() => { if(isMountedRef.current){ setIsConfirmQuantityDialogOpen(false); setConfirmQuantityProductBarcode(null); setConfirmQuantityAction(null); setConfirmQuantityNewValue(null); } setFocusTrigger(prev => prev + 1); }}
          isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
         isOpen={isDeleteDialogOpen}
         onOpenChange={(open) => { if(isMountedRef.current) setIsDeleteDialogOpen(open); if (!open) { if(isMountedRef.current) setProductToDelete(null); setFocusTrigger(prev => prev + 1); } }}
         title="Confirmar Eliminación"
         description={ productToDelete ? `¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) de la lista actual?` : `¿Seguro que deseas eliminar este producto?`}
         onConfirm={confirmDelete}
         onCancel={() => { if(isMountedRef.current) setIsDeleteDialogOpen(false); setFocusTrigger(prev => prev + 1); }}
         isDestructive={true}
         isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => { if(isMountedRef.current) setIsDeleteListDialogOpen(open); if (!open) { setFocusTrigger(prev => prev + 1); } }}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})?`}
          onConfirm={handleClearCurrentList}
          onCancel={() => { if(isMountedRef.current) setIsDeleteListDialogOpen(false); setFocusTrigger(prev => prev + 1); }}
          isDestructive={true}
          isProcessing={isTransitionPending || isSyncing}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(open); if (!open) { setFocusTrigger(prev => prev + 1); } }}
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
            onCancel={() => { if(isMountedRef.current) setIsClearCatalogConfirmOpen(false); setFocusTrigger(prev => prev + 1); }}
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
              setFocusTrigger(prev => prev + 1);
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
              setFocusTrigger(prev => prev + 1);
          }}
          warehouse={warehouseToEdit}
          onSave={handleUpdateWarehouse} 
          isProcessing={isSyncing || isTransitionPending}
        />
      )}
    </div>
  );
}

    
