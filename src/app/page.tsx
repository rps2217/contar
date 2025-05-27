
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

// IndexedDB functions
import {
  getProductFromDB as getProductFromIndexedDB,
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  clearProductDatabase,
  addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database';

// Firestore functions
import {
  subscribeToWarehouses,
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  setCountingListItem,
  deleteCountingListItem,
  subscribeToCountingList,
  clearCountingListForWarehouseInFirestore,
  // --- Firestore Catalog Functions ---
  getAllProductsFromCatalog,
  addOrUpdateProductInCatalog,
  deleteProductFromCatalog,
  addProductsToCatalog,
  clearProductCatalogInFirestore,
  getProductFromCatalog, // Keep if used for single product fetch from catalog
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


// Firebase db instance for Firestore operations
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection, serverTimestamp } from 'firebase/firestore';
import Papa from 'papaparse';

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
    LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX,
  } from '@/lib/constants';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { playBeep } from '@/lib/helpers';


const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
];


// --- Helper functions for Google Sheet Import (moved from ProductDatabaseComponent) ---
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

      let userMessage = `Error ${status} al obtener datos. `;
      if (status === 400) userMessage += "Solicitud incorrecta.";
      else if (status === 403) userMessage += "Acceso denegado. Asegúrese de que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.";
      else if (status === 404) userMessage += "Hoja no encontrada.";
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
          const EXPIRATION_DATE_COLUMN_INDEX = 2; // Assuming column 3 (index 2) is expiration
          const STOCK_COLUMN_INDEX = 5; // Assuming column 6 (index 5) is stock
          const PROVIDER_COLUMN_INDEX = 9; // Assuming column 10 (index 9) is provider

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

  // --- Warehouse State (Firestore as master, localStorage as cache) ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  
  // --- Product Catalog State (Firestore as master, IndexedDB as cache) ---
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]); 

  // --- Counting List State (Firestore as master, localStorage as cache) ---
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
  const [isInitialFetchDoneForUserWarehouses, setIsInitialFetchDoneForUserWarehouses] = useState(false);

  // --- Camera Scan Mode State ---
  const [isCameraScanMode, setIsCameraScanMode] = useState(false);
  const [isActivelyScanningByButton, setIsActivelyScanningByButton] = useState(false);
  const handleScanButtonPress = useCallback(() => setIsActivelyScanningByButton(true), []);
  const handleScanButtonRelease = useCallback(() => setIsActivelyScanningByButton(false), []);
  const toggleCameraScanMode = useCallback(() => setIsCameraScanMode(prev => !prev), []);
  
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


  const handleAddProduct = useCallback(async (scannedBarcode?: string) => {
    if (!isMountedRef.current) return;
    const rawBarcode = scannedBarcode ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      if(isMountedRef.current && !scannedBarcode) requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "default", title: "Código vacío" }); });
      if (!scannedBarcode) requestAnimationFrame(() => { if (isMountedRef.current) { setBarcode(""); focusBarcodeIfCounting(); }});
      return;
    }
    if (!currentWarehouseId || !currentUserId) {
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
        
        let catalogProd = catalogProducts.find(cp => cp.barcode === barcodeToLookup); // Busca en el catálogo cargado desde Firestore/IndexedDB
        console.log(`[handleAddProduct] Resultado para '${barcodeToLookup}' desde catalogProducts (estado React):`, JSON.parse(JSON.stringify(catalogProd || {})));
        
        if (!catalogProd && isMountedRef.current) { 
            console.log(`[handleAddProduct] Código '${barcodeToLookup}' no encontrado en estado. Intentando IndexedDB (caché)...`);
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
                requestAnimationFrame(() => { if (isMountedRef.current) toast({ variant: "destructive", title: "Producto Desconocido", description: `Agregado temporalmente. Edita en 'Catálogo'.`}); });
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
            if (currentUserId && currentWarehouseId) { 
                setLocalStorageItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`, updatedOfflineList);
            }
            requestAnimationFrame(() => toast({ title: "Guardado Localmente (Offline)", description: "El cambio se guardó localmente. Se sincronizará cuando haya conexión." }));
        }
        // No mostrar toast de discrepancia automáticamente al agregar, se maneja con colores de fila
        // showDiscrepancyToastIfNeeded(dataForFirestore, currentCount); 
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
    focusBarcodeIfCounting, activeSection, catalogProducts, getProductFromIndexedDB, // catalogProducts es dependencia
    setBarcode, setIsSyncing, setLastScannedBarcode, startTransition, db, 
    setCountingList, // Necesario para el caso offline
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
    requestAnimationFrame(() => {
      if (isMountedRef.current) focusBarcodeIfCounting();
    });
    return () => {
      isMountedRef.current = false;
      if (lastScannedTimeoutRef.current) clearTimeout(lastScannedTimeoutRef.current);
    };
  }, [focusBarcodeIfCounting]);


 const synchronizeAndLoadCatalog = useCallback(async () => {
    if (!currentUserId) { 
      if (isMountedRef.current) {
          setIsDbLoading(true);
          setProcessingStatus("Cargando catálogo local (IndexedDB)...");
          try {
              const localProducts = await getAllProductsFromIndexedDB();
              const sortedLocalProducts = localProducts
                .filter(p => p && p.barcode)
                .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
              startTransition(() => setCatalogProducts(sortedLocalProducts));
              setProcessingStatus(localProducts.length > 0 ? "Catálogo local cargado." : "Catálogo local vacío.");
              console.log(`[SyncCatalog] Loaded ${sortedLocalProducts.length} products from IndexedDB (no user).`);
          } catch (indexedDbError) {
              console.error("[SyncCatalog] Error loading catalog from IndexedDB (no user):", indexedDbError);
              startTransition(() => setCatalogProducts([]));
              setProcessingStatus("Error al cargar catálogo local.");
              requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo cargar el catálogo." }));
          } finally {
              setIsDbLoading(false);
          }
      }
      return;
    }

    if (isMountedRef.current) {
      setIsDbLoading(true);
      setIsSyncing(true);
      setProcessingStatus("Sincronizando catálogo con la nube...");
      console.log("[SyncCatalog] Iniciando sincronización de catálogo con Firestore para usuario:", currentUserId);
    }

    try {
      const productsFromFirestore = await getAllProductsFromCatalog(currentUserId); 
      console.log(`[SyncCatalog] Obtenidos ${productsFromFirestore.length} productos de Firestore. Primeros 5:`, productsFromFirestore.slice(0, 5).map(p=>p.barcode));

      if (isMountedRef.current) {
        const sortedFirestoreProducts = productsFromFirestore
          .filter(p => p && p.barcode) 
          .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
        
        startTransition(() => setCatalogProducts(sortedFirestoreProducts));

        console.log("[SyncCatalog] Actualizando IndexedDB (caché) con datos de Firestore...");
        await clearProductDatabase(); 
        await addProductsToIndexedDB(sortedFirestoreProducts); 
        console.log("[SyncCatalog] IndexedDB (caché) actualizado con datos de Firestore.");
        
        setProcessingStatus("Catálogo sincronizado y caché local actualizado.");
      }
    } catch (error: any) {
        console.error("[SyncCatalog] Error during catalog synchronization:", error.message, error.stack);
        if (isMountedRef.current) {
            setProcessingStatus(`Error catálogo (nube): ${error.message}. Usando caché local...`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo (Nube)", description: `No se pudo sincronizar. ${error.message}.`}));
            
            console.warn("[SyncCatalog] Firestore sync failed, falling back to IndexedDB cache.");
            try {
                const localProducts = await getAllProductsFromIndexedDB();
                const sortedLocalProducts = localProducts
                    .filter(p => p && p.barcode)
                    .sort((a,b) => (a.description || "").localeCompare(b.description || ""));
                startTransition(() => setCatalogProducts(sortedLocalProducts));
                setProcessingStatus(localProducts.length > 0 ? "Caché local del catálogo cargado." : "Catálogo vacío (error de nube y sin caché local).");
            } catch (indexedDbError) {
                console.error("[SyncCatalog] Error cargando catálogo desde IndexedDB (fallback):", indexedDbError);
                startTransition(() => setCatalogProducts([]));
                setProcessingStatus("Error al cargar catálogo (nube y local).");
            }
        }
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setIsSyncing(false);
      }
      console.log("[SyncCatalog] Sincronización de catálogo finalizada.");
    }
  }, [
    currentUserId, toast, db, 
    getAllProductsFromCatalog, // Firestore
    clearProductDatabase, addProductsToIndexedDB, getAllProductsFromIndexedDB, // IndexedDB
    setCatalogProducts, setIsDbLoading, setIsSyncing, setProcessingStatus, startTransition
  ]);


  useEffect(() => {
    if (isAuthenticated && currentUserId) { 
      synchronizeAndLoadCatalog();
    } else if (isAuthenticated && !currentUserId) { // Logged in but userId somehow null (shouldn't happen with rps logic)
        console.warn("Autenticado pero sin currentUserId, intentando cargar catálogo localmente.");
        synchronizeAndLoadCatalog(); // Intentará cargar de IndexedDB
    }
     else {
      startTransition(() => setCatalogProducts([])); 
      if (isMountedRef.current) setIsDbLoading(false); 
    }
  }, [isAuthenticated, currentUserId, synchronizeAndLoadCatalog]);


  // Warehouse Management
   useEffect(() => {
    const localWarehouseListKey = currentUserId ? `${LOCAL_STORAGE_WAREHOUSE_LIST_KEY_PREFIX}${currentUserId}` : null;
    const storedCurrentWarehouseIdKey = currentUserId ? `${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}` : null;

    if (isMountedRef.current && currentUserId && storedCurrentWarehouseIdKey) {
        const localWarehouses = getLocalStorageItem<Warehouse[]>(localWarehouseListKey!, []);
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

    } else if (isMountedRef.current && !currentUserId) {
        startTransition(() => {
            setWarehouses([...PREDEFINED_WAREHOUSES_LIST]);
            setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
        });
    }

    if (!currentUserId || !db || !isAuthenticated) {
      if (isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(false);
      return () => {}; 
    }

    let isInitialFetchForUser = !isInitialFetchDoneForUserWarehouses;

    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehousesFromFirestore) => {
        if (!isMountedRef.current) return;
        
        let effectiveWarehouseList = [...fetchedWarehousesFromFirestore];
        let currentSelectionIdFromStorage = storedCurrentWarehouseIdKey ? getLocalStorageItem<string>(storedCurrentWarehouseIdKey, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
        
        if (isInitialFetchForUser && db && currentUserId) {
            const warehousesToAddBatch: Warehouse[] = [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predef => {
                if (!fetchedWarehousesFromFirestore.some(fsWh => fsWh.id === predef.id)) {
                    warehousesToAddBatch.push(predef);
                }
            });

            if (warehousesToAddBatch.length > 0) {
                console.log(`[Warehouses] Creando almacenes predeterminados faltantes en Firestore para ${currentUserId}.`);
                setIsSyncing(true);
                try {
                    const batch = writeBatch(db);
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh); 
                    });
                    await batch.commit();
                    // El listener de Firestore recogerá estos cambios y actualizará effectiveWarehouseList.
                } catch (err) {
                    console.error(`[Warehouses] Fallo al añadir almacenes predeterminados para ${currentUserId}:`, err);
                    requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                } finally {
                    if(isMountedRef.current) setIsSyncing(false);
                }
            }
        }
        
        // Si después del batch (o si no hubo batch), la lista de Firestore sigue vacía (ej. primer uso sin red),
        // o si faltan predefinidos (ej. si Firestore aún no los ha propagado por el listener)
        // Asegurar que la UI tenga al menos los predefinidos.
        // La fuente de verdad sigue siendo Firestore, y localStorage se actualizará cuando Firestore emita.
        
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
            if (localWarehouseListKey) setLocalStorageItem(localWarehouseListKey, combinedList);
            
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

        if (isInitialFetchForUser && isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(true);

    }, (error) => { 
        console.error("[Warehouses] Error de suscripción a Firestore:", error);
        if (isMountedRef.current) {
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
            
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Red (Almacenes)", description: "Usando datos locales."}));
            if (isInitialFetchForUser && isMountedRef.current) setIsInitialFetchDoneForUserWarehouses(true);
        }
    });

    return () => {
        unsubscribe();
    };
  }, [currentUserId, isAuthenticated, toast, db, isInitialFetchDoneForUserWarehouses, currentWarehouseId]);


  // Counting List (Firestore as master, localStorage as cache)
  useEffect(() => {
    if (!isMountedRef.current) return () => {};

    const localKey = currentUserId && currentWarehouseId ? `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}` : null;

    if (localKey) {
      const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
      if (isMountedRef.current) { // Check isMounted before setting state
        startTransition(() => { setCountingList(localList.length > 0 ? localList : []); });
      }
    } else {
      if (isMountedRef.current) { // Check isMounted before setting state
        startTransition(() => { setCountingList([]); });
      }
    }

    if (!currentUserId || !currentWarehouseId || !isAuthenticated || !db) {
      if (isSyncing && isMountedRef.current && activeSection.startsWith('Contador')) setIsSyncing(false);
      return () => {}; 
    }
    
    if(isMountedRef.current && activeSection.startsWith('Contador')) setIsSyncing(true); 
    
    const unsubscribeFirestore = subscribeToCountingList(
      currentUserId, 
      currentWarehouseId, 
      (productsFromFirestore) => { 
        if (isMountedRef.current) {
            startTransition(() => { setCountingList(productsFromFirestore); });
            if (localKey) setLocalStorageItem(localKey, productsFromFirestore); 
            if (isSyncing && activeSection.startsWith('Contador')) setIsSyncing(false); 
        }
      }, 
      (error) => { 
        if (isMountedRef.current) {
            console.warn(`[CountingList] Error de suscripción a Firestore. Usando localStorage como fallback.`);
            if (isSyncing && activeSection.startsWith('Contador')) setIsSyncing(false); 
            requestAnimationFrame(() => toast({ variant: "default", title: "Modo Offline (Conteo)", description: "No se pudo conectar. Usando datos locales."}));
        }
      }
    );

    return () => {
        unsubscribeFirestore();
        if (isMountedRef.current && isSyncing && activeSection.startsWith('Contador')) setIsSyncing(false);
    };
  }, [currentWarehouseId, currentUserId, toast, isAuthenticated, db, activeSection]); // No depender de isSyncing aquí


  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
    if (!warehouseId) return 'N/A';
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : `Almacén (${warehouseId.substring(0,6)}...)`;
  }, [warehouses]);


  const modifyProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
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
    
    const needsConfirmation = type === 'count' && 
                          (productInList.stock !== undefined && productInList.stock !== 0) && 
                          calculatedNewValue > productInList.stock && 
                          originalValue <= productInList.stock; 


    if (type === 'count' && needsConfirmation && activeSection !== 'Contador Cámara' && !isConfirmQuantityDialogOpen) { 
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
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData); // A Firestore
            // La UI se actualizará via onSnapshot. No showDiscrepancyToast aquí para no interrumpir.
        } else { // type === 'stock'
            const catalogProdToUpdate = catalogProducts.find(p => p.barcode === productBarcode);
            if (catalogProdToUpdate) {
                 const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: calculatedNewValue };
                 await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); // A Firestore (catálogo maestro)
                 await addOrUpdateProductToIndexedDB(updatedMasterProduct); // Y a IndexedDB (caché del catálogo)
                 
                 startTransition(() => setCatalogProducts(prev => prev.map(p => p.barcode === productBarcode ? updatedMasterProduct : p).sort((a,b)=>(a.description || "").localeCompare(b.description || ""))));

                 updatedProductData = { 
                    ...productInList,
                    stock: calculatedNewValue, 
                    lastUpdated: new Date().toISOString(),
                 };
                 await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData); // Actualizar item en lista de conteo
                 requestAnimationFrame(() => toast({ title: "Stock en Catálogo Actualizado" }));
            } else {
                 console.warn(`[modifyProductValue] Producto ${productBarcode} no encontrado en catálogo para actualizar stock.`);
                 if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no encontrado en catálogo."}));
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
    focusBarcodeIfCounting, catalogProducts, 
    addOrUpdateProductToIndexedDB, addOrUpdateProductInCatalog, 
    setCatalogProducts, setIsSyncing, setConfirmQuantityProductBarcode, setConfirmQuantityAction,
    setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen, startTransition, isConfirmQuantityDialogOpen
  ]);


const handleSetProductValue = useCallback(async (productBarcode: string, type: 'count' | 'stock', newValue: number, sumValue: boolean = false) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede modificar."}));
        return;
    }
    
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
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
        if(isMountedRef.current) setOpenModifyDialog(null);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    const finalNewValue = Math.max(0, calculatedValue); 

    const needsConfirmation = type === 'count' && 
                            (productInList.stock !== undefined && productInList.stock !== 0) && 
                            finalNewValue > productInList.stock && 
                            (!sumValue || originalValue <= productInList.stock) &&
                            activeSection !== 'Contador Cámara';


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
            await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData); // A Firestore
            // No showDiscrepancyToast aquí, se maneja con colores
        } else { // type === 'stock' 
            const catalogProdToUpdate = catalogProducts.find(p => p.barcode === productBarcode);
            if (catalogProdToUpdate) {
                 const updatedMasterProduct: ProductDetail = { ...catalogProdToUpdate, stock: finalNewValue };
                 await addOrUpdateProductInCatalog(currentUserId, updatedMasterProduct); // A Firestore (catálogo maestro)
                 await addOrUpdateProductToIndexedDB(updatedMasterProduct); // Y a IndexedDB (caché del catálogo)
                 
                 startTransition(() => setCatalogProducts(prev => prev.map(p => p.barcode === productBarcode ? updatedMasterProduct : p).sort((a,b)=>(a.description || "").localeCompare(b.description || ""))));

                 updatedProductData = {
                    ...productInList,
                    stock: finalNewValue, 
                    lastUpdated: new Date().toISOString(),
                 };
                 await setCountingListItem(currentUserId, currentWarehouseId, updatedProductData); // Actualizar en lista de conteo
                 requestAnimationFrame(() => toast({ title: "Stock en Catálogo Actualizado" }));
            } else {
                 console.warn(`[handleSetProductValue] Producto ${productBarcode} no encontrado en catálogo.`);
                 if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Aviso", description: "Producto no encontrado en catálogo."}));
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
    catalogProducts, 
    addOrUpdateProductToIndexedDB, addOrUpdateProductInCatalog, 
    setCatalogProducts, setIsSyncing, setOpenModifyDialog, setConfirmQuantityProductBarcode, setConfirmQuantityAction,
    setConfirmQuantityNewValue, setIsConfirmQuantityDialogOpen, startTransition
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
        await setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore); // A Firestore
        // La UI se actualizará via onSnapshot
        
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
    setIsSyncing, setIsConfirmQuantityDialogOpen, setConfirmQuantityProductBarcode, setConfirmQuantityAction, 
    setConfirmQuantityNewValue, setOpenModifyDialog, startTransition
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
        await deleteCountingListItem(currentUserId, currentWarehouseId, barcodeForToast); // De Firestore
        // La UI se actualizará via onSnapshot
        if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Producto eliminado", description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó.` }));
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
    setIsSyncing, setIsDeleteDialogOpen, setProductToDelete, startTransition
]);

 const handleClearCurrentList = useCallback(async () => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId || !db) return;
    if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')) setIsSyncing(true);
    try {
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId); // De Firestore
        // La UI se actualizará via onSnapshot
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
    setIsSyncing, setIsDeleteListDialogOpen, startTransition,
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
        requestAnimationFrame(() => toast({ title: "Error", description: "No se puede actualizar stock."}));
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
                        // firestoreLastUpdated se actualizará en el servidor
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
                const dataWithServerTimestamp = { ...dataToSet, firestoreLastUpdated: serverTimestamp() };
                batch.set(docRef, dataWithServerTimestamp, { merge: true }); 
            });
            await batch.commit();
            // La UI se actualizará via onSnapshot
        }

        if(updatedProductCount > 0 && isMountedRef.current) {
            requestAnimationFrame(() => {
                 toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s).` });
            });
        } else if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Sin Cambios", description: "Productos ya actualizados." }));
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
    currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId, countingList, catalogProducts, db,
    setIsRefreshingStock, setIsSyncing 
]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
    if(isMountedRef.current) setOpenModifyDialog({ type, product });
 }, [setOpenModifyDialog]);

 const handleCloseModifyDialog = () => {
    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
 };


  // --- Catalog CRUD (Firestore as master, IndexedDB as cache) ---
  const handleAddOrUpdateCatalogProduct = useCallback(async (productData: ProductDetail) => {
    if (!currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede guardar en catálogo." }));
        return;
    }
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); setProcessingStatus("Guardando en catálogo..."); }
    try {
        await addOrUpdateProductInCatalog(currentUserId, productData); // A Firestore
        await synchronizeAndLoadCatalog(); 
        requestAnimationFrame(() => toast({ title: "Producto Guardado en Catálogo" }));
        if(isMountedRef.current) { setProcessingStatus("Producto guardado."); setIsEditDetailDialogOpen(false); setProductToEditDetail(null); }
    } catch (error: any) {
        if (isMountedRef.current) {
            setProcessingStatus(`Error: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `No se pudo guardar: ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); setProcessingStatus("");}
    }
  }, [currentUserId, toast, synchronizeAndLoadCatalog, addOrUpdateProductInCatalog, setIsDbLoading, setIsSyncing, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail, db]);

  const handleDeleteCatalogProduct = useCallback(async (barcodeToDelete: string) => {
    if (!currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede eliminar." }));
        return;
    }
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); setProcessingStatus("Eliminando de catálogo..."); }
    try {
        await deleteProductFromCatalog(currentUserId, barcodeToDelete); // De Firestore
        await synchronizeAndLoadCatalog(); 
        requestAnimationFrame(() => toast({ title: "Producto Eliminado del Catálogo" }));
        if(isMountedRef.current) { setProcessingStatus("Producto eliminado."); setIsEditDetailDialogOpen(false); setProductToEditDetail(null); }
    } catch (error: any) {
        if (isMountedRef.current) {
            setProcessingStatus(`Error: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); setProcessingStatus("");}
    }
  }, [currentUserId, toast, synchronizeAndLoadCatalog, deleteProductFromCatalog, setIsDbLoading, setIsSyncing, setProcessingStatus, setIsEditDetailDialogOpen, setProductToEditDetail, db]);


 const handleClearCatalog = useCallback(async () => {
    if (!currentUserId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede borrar catálogo." }));
      return;
    }
    if(isMountedRef.current) { setIsDbLoading(true); setIsSyncing(true); setProcessingStatus("Borrando catálogo..."); }
    try {
      await clearProductCatalogInFirestore(currentUserId); // De Firestore
      await synchronizeAndLoadCatalog(); 
      requestAnimationFrame(() => toast({ title: "Catálogo Borrado" }));
      if(isMountedRef.current) setProcessingStatus("Catálogo borrado.");
    } catch (error: any) {
      if(isMountedRef.current) {
          setProcessingStatus(`Error: ${error.message}`);
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: error.message }));
      }
    } finally {
      if (isMountedRef.current) { setIsDbLoading(false); setIsSyncing(false); setIsClearCatalogConfirmOpen(false); setProcessingStatus(""); }
    }
  }, [currentUserId, toast, synchronizeAndLoadCatalog, clearProductCatalogInFirestore, setIsDbLoading, setIsSyncing, setProcessingStatus, setIsClearCatalogConfirmOpen, db]);


 const handleGoogleSheetLoadToCatalog = useCallback(async (sheetUrlOrId: string) => {
    if (!currentUserId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede cargar." }));
      return;
    }
    if (!sheetUrlOrId) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido" }));
      return;
    }
    if (isMountedRef.current) {
        setIsDbLoading(true);
        setIsSyncing(true);
        setProcessingStatus("Cargando desde Google Sheet...");
    }
    try {
      const productsFromSheet = await fetchGoogleSheetData(sheetUrlOrId); 
      if (productsFromSheet.length > 0) {
        await addProductsToCatalog(currentUserId, productsFromSheet); // A Firestore
        await synchronizeAndLoadCatalog(); 
        if (isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({ title: "Catálogo Actualizado", description: `${productsFromSheet.length} productos cargados.` });
            });
            setProcessingStatus("Carga completa.");
        }
      } else {
        if (isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({ title: "Sin Productos", description: "No se encontraron productos." });
            });
            setProcessingStatus("No se encontraron productos.");
        }
      }
    } catch (error: any) {
      console.error("[handleGoogleSheetLoadToCatalog] Error:", error);
      if (isMountedRef.current) {
        requestAnimationFrame(() => {
            toast({ variant: "destructive", title: "Error de Carga GS", description: error.message || "Error desconocido." });
        });
        setProcessingStatus(`Error: ${error.message}`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setIsSyncing(false);
        setProcessingStatus("");
      }
    }
  }, [
    currentUserId, toast, synchronizeAndLoadCatalog, addProductsToCatalog, db,
    setIsDbLoading, setIsSyncing, setProcessingStatus
  ]);


 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct | ProductDetail) => {
    if (!product || !product.barcode || !isMountedRef.current || !currentUserId || !db) { 
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se puede editar." }));
        return;
    }
    if(isMountedRef.current) setIsDbLoading(true);
    try {
        let productDataToEdit = catalogProducts.find(cp => cp.barcode === product.barcode); // Primero del estado (Firestore cache)
        
        if (!productDataToEdit) {
            console.log(`[handleOpenEditDetailDialog] Producto '${product.barcode}' no en estado. Intentando IndexedDB (caché local)...`);
            productDataToEdit = await getProductFromIndexedDB(product.barcode);
        }
        
        if (!productDataToEdit && db) { // Si aún no se encuentra, intentar desde Firestore directamente
             console.log(`[handleOpenEditDetailDialog] Producto '${product.barcode}' no en caché local. Intentando Firestore...`);
             productDataToEdit = await getProductFromCatalog(currentUserId, product.barcode);
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
            if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "default", title: "Agregando Nuevo Producto", description: "Este producto se agregará al catálogo." }));
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
    toast, currentUserId, catalogProducts, db, startTransition,
    getProductFromIndexedDB, getProductFromCatalog, 
    setProductToEditDetail, setIsEditDetailDialogOpen, setIsDbLoading 
]);


 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
    if (!isMountedRef.current || !productToEditDetail || !currentUserId) return;
    await handleAddOrUpdateCatalogProduct({ ...productToEditDetail, ...data }); 
 }, [handleAddOrUpdateCatalogProduct, productToEditDetail, currentUserId]);


 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId || !db) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "Falta información o conexión." }));
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
            const dataToSet: Omit<DisplayProduct, 'barcode' | 'warehouseId' | 'lastUpdated' | 'firestoreLastUpdated'> & { firestoreLastUpdated: any } = {
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
            requestAnimationFrame(() => toast({ title: "Conteo Iniciado", description: `Cargados ${productsToCount.length} productos.` }));
            setProcessingStatus("Conteo por proveedor iniciado.");
        }
    } catch (error: any) {
        console.error("Error iniciando conteo por proveedor:", error);
        if (isMountedRef.current) {
            setProcessingStatus(`Error: ${error.message}`);
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Sincronización", description: `No se pudo iniciar. ${error.message}` }));
        }
    } finally {
        if (isMountedRef.current) { setIsSyncing(false); setProcessingStatus(""); }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [
    toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, currentUserId, db,
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
        setIsCameraScanMode(true); 
      } else {
        setIsCameraScanMode(false); 
      }
    }
  }, [setActiveSection, focusBarcodeIfCounting, setIsCameraScanMode]); 

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
    currentWarehouseId, startTransition, currentUserId, 
  ]);

    const handleAddWarehouse = useCallback(async (name: string) => {
      if (!isMountedRef.current || !currentUserId || !name.trim() || !db) {
          requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede agregar.' }));
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
          requestAnimationFrame(() => toast({ title: "Almacén Agregado" }));
      } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo agregar. ${error.message}` }));
      } finally {
          if(isMountedRef.current) setIsSyncing(false);
      }
    }, [
        warehouses, currentUserId, toast, db,
        addOrUpdateWarehouseInFirestore, 
        setIsSyncing 
    ]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) {
            requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede actualizar.' }));
            return;
       }
       if(isMountedRef.current) setIsSyncing(true);
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, { ...warehouseToUpdate, name: warehouseToUpdate.name.toUpperCase() }); 
           requestAnimationFrame(() => toast({ title: "Almacén Actualizado" }));
       } catch (error: any) {
           if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo actualizar. ${error.message}` }));
       } finally {
            if(isMountedRef.current) setIsSyncing(false);
       }
   }, [
    toast, currentUserId, db,
    addOrUpdateWarehouseInFirestore, 
    setIsSyncing 
  ]);

   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
    if (!isMountedRef.current || !currentUserId || !db) {
        requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error', description: 'No se puede eliminar.' }));
        return;
    }
    if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
      requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Operación no permitida', description: "Almacén Principal no se puede eliminar." }));
      return;
    }
    if(isMountedRef.current) setIsSyncing(true);
    try {
      await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
      // La UI se actualizará via onSnapshot, incluyendo la selección del almacén activo si es necesario.
       requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
    } catch (error: any) {
      if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: `No se pudo eliminar.` }));
    } finally {
      if(isMountedRef.current) setIsSyncing(false);
    }
  }, [
    toast, currentUserId, db, 
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
            // Limpiar localStorage específico del usuario que cierra sesión
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${userIdToClear}`) || 
                    (key.startsWith(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}`) && key.includes(`_${userIdToClear}`)) ||
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

  // --- Warehouse Edit Dialog State ---
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
          isSyncing ? "bg-primary animate-syncing-pulse-colors" : "bg-muted/30" 
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
          <SheetContent side="left" className="w-72 p-0 bg-sidebar-background text-sidebar-foreground">
             <SheetHeader className="p-4 border-b border-sidebar-border">
                <SheetTitle className="text-xl font-bold">StockCounter Pro</SheetTitle>
             </SheetHeader>
            <SidebarLayout {...sidebarProps} />
          </SheetContent>
        </Sheet>
      ) : (
        <aside className={cn(
            "flex-shrink-0 border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground flex flex-col transition-all duration-300 ease-in-out pt-1", 
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
              {/* Botones de Exportar y Borrar Lista para modo cámara (similares a los del modo Contador) */}
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
                    onUpdateWarehouse={handleUpdateWarehouse} // Pasando la nueva función
                    onDeleteWarehouse={handleDeleteWarehouse} // Pasando la nueva función
                    onSelectWarehouse={handleWarehouseChange}
                    isLoading={isSyncing || isTransitionPending} 
                    onOpenEditDialog={ (warehouse) => { setWarehouseToEdit(warehouse); setIsEditWarehouseDialogOpen(true); }}
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
    


    

    