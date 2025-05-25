
// src/app/page.tsx
"use client";

import type { DisplayProduct, ProductDetail, Warehouse, ConsolidatedProductViewItem } from '@/types/product';
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
import { CountingListTable } from '@/components/counting-list-table';
import { WarehouseManagement } from "@/components/warehouse-management";
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock, BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide, LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert, Filter, PanelLeftClose, PanelRightOpen, Save, Library, X, Check, Camera, Download, Edit } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo, useTransition } from "react";
import { playBeep } from '@/lib/helpers';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { EditProductDialog } from '@/components/edit-product-dialog';
import {
  getProductFromDB as getProductFromIndexedDB,
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  clearProductDatabase as clearProductDatabaseInIndexedDB,
  addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database'; // Using IndexedDB for product catalog
import {
  subscribeToWarehouses,
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
import { CounterSection } from '@/components/counter-section';
import { useLocalStorage } from '@/hooks/use-local-storage';
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
import { db } from '@/lib/firebase';
import { writeBatch, doc, collection } from 'firebase/firestore';
import { ConsolidatedView } from '@/components/consolidated-view';
import { BarcodeScannerCamera } from '@/components/barcode-scanner-camera';
import { BarcodeEntry } from '@/components/barcode-entry';


// --- Main Component ---

const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
];

export default function Home() {
  // --- Refs ---
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(false);
  const lastScannedTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  // --- React Transition Hook ---
  const [isTransitionPending, startTransition] = useTransition();

  // --- Authentication State ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // --- User and Warehouse State ---
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST); // Initialize with predefined
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]);


  // --- LocalStorage Hooks for UI preferences ---
  const [activeSection, setActiveSection] = useLocalStorage<string>(
    LOCAL_STORAGE_ACTIVE_SECTION_KEY,
    'Contador'
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage<boolean>(
    LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY,
    false
  );

  // --- Component State ---
  const [barcode, setBarcode] = useState("");
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [openModifyDialog, setOpenModifyDialog] = useState<{ type: 'count' | 'stock', product: DisplayProduct | null } | null>(null);
  const [isConfirmQuantityDialogOpen, setIsConfirmQuantityDialogOpen] = useState(false);
  const [confirmQuantityAction, setConfirmQuantityAction] = useState<'increment' | 'decrement' | 'set' | null>(null);
  const [confirmQuantityProductBarcode, setConfirmQuantityProductBarcode] = useState<string | null>(null);
  const [confirmQuantityNewValue, setConfirmQuantityNewValue] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleteListDialogOpen, setIsDeleteListDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true); // True initially for IndexedDB and Firestore loads
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
  const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0);
  const [isClearCatalogConfirmOpen, setIsClearCatalogConfirmOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const isMobile = useIsMobile();
  const isInitialFetchDoneForUser = useRef<Record<string, boolean>>({});
  const [isSyncing, setIsSyncing] = useState(false); // For Firestore sync indicator


  // --- Helper Functions ---
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
        }, 100); // Increased from 50ms to 100ms
    }
  }, [activeSection]);

  // --- Effects ---

 useEffect(() => {
    isMountedRef.current = true;
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId === LOGIN_USER) { // Only auto-login if the stored ID is the one we expect
        setCurrentUserId(LOGIN_USER);
        setIsAuthenticated(true);
    } else {
        setCurrentUserId(null);
        setIsAuthenticated(false);
        if(typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY); // Clear invalid/old user ID
    }

    requestAnimationFrame(() => {
      if (isMountedRef.current) {
          focusBarcodeIfCounting();
      }
    });

    return () => {
      isMountedRef.current = false;
      if (lastScannedTimeoutRef.current) {
        clearTimeout(lastScannedTimeoutRef.current);
      }
    };
  }, [focusBarcodeIfCounting]);

  // Effect to subscribe to warehouses from Firestore
  useEffect(() => {
    if (!currentUserId || !db) { // Ensure db is initialized
        if (isMountedRef.current) {
            // Fallback to local predefined warehouses if no user or db
            const localDefaultWarehouses = [...PREDEFINED_WAREHOUSES_LIST];
            setWarehouses(localDefaultWarehouses);
            // Attempt to load stored warehouse ID, defaulting to main
            const storedWarehouseId = currentUserId ? getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
            const currentSelectionIsValid = localDefaultWarehouses.some(w => w.id === storedWarehouseId);
            setCurrentWarehouseId(currentSelectionIsValid ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
            setIsDbLoading(false);
        }
        return;
    }

    setIsDbLoading(true);
    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehouses) => {
        if (isMountedRef.current) {
            let finalWarehousesToSet = [...fetchedWarehouses];

            // Logic to add predefined warehouses if it's the initial fetch for this user and they don't exist in Firestore
            if (!isInitialFetchDoneForUser.current[currentUserId] && db && currentUserId) {
                isInitialFetchDoneForUser.current[currentUserId] = true; // Mark initial fetch as done

                const warehousesToAddBatch: Warehouse[] = [];
                PREDEFINED_WAREHOUSES_LIST.forEach(predefined => {
                    if (!fetchedWarehouses.some(fw => fw.id === predefined.id)) {
                        warehousesToAddBatch.push(predefined);
                    }
                });

                if (warehousesToAddBatch.length > 0) {
                    setIsSyncing(true);
                    try {
                        const batch = writeBatch(db);
                        warehousesToAddBatch.forEach(wh => {
                            const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                            batch.set(warehouseDocRef, wh);
                        });
                        await batch.commit();
                        // Firestore listener will pick up these changes and update `finalWarehousesToSet` via `fetchedWarehouses`
                        // No need to manually merge here if listener is robust
                    } catch (err) {
                        console.error(`Failed to add predefined warehouses for user ${currentUserId}:`, err);
                        if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                        // If batch fails, add them locally to ensure UI has them
                        finalWarehousesToSet = [...fetchedWarehouses, ...warehousesToAddBatch].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
                    } finally {
                        setIsSyncing(false);
                    }
                }
                 // If Firestore is empty AND we didn't just add any, ensure predefined list is used locally
                 if (finalWarehousesToSet.length === 0 && warehousesToAddBatch.length === 0) { 
                     finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST]; 
                }
            }

            setWarehouses(finalWarehousesToSet.length > 0 ? finalWarehousesToSet : PREDEFINED_WAREHOUSES_LIST);

            // Logic to set currentWarehouseId based on localStorage or defaults
            const storedWarehouseId = getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID);
            const effectiveWarehouseList = finalWarehousesToSet.length > 0 ? finalWarehousesToSet : PREDEFINED_WAREHOUSES_LIST;
            let currentSelectionIsValid = effectiveWarehouseList.some(w => w.id === storedWarehouseId);

            if (!currentSelectionIsValid) {
                const mainExistsInEffectiveList = effectiveWarehouseList.find(w => w.id === DEFAULT_WAREHOUSE_ID);
                const newCurrentId = mainExistsInEffectiveList ? DEFAULT_WAREHOUSE_ID : (effectiveWarehouseList[0]?.id || DEFAULT_WAREHOUSE_ID);
                setCurrentWarehouseId(newCurrentId);
                if (currentUserId) setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newCurrentId);
            } else {
                setCurrentWarehouseId(storedWarehouseId);
            }
            setIsDbLoading(false);
        }
    });

    return () => {
        unsubscribe();
        if (isMountedRef.current) setIsDbLoading(false);
    };
  }, [currentUserId, toast]);


  // Effect to load catalog products from IndexedDB
  useEffect(() => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true);
    getAllProductsFromIndexedDB()
      .then(products => {
        if (isMountedRef.current) {
          setCatalogProducts(products);
        }
      })
      .catch(error => {
        console.error("Error loading catalog from IndexedDB:", error);
        if (isMountedRef.current) {
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo cargar el catálogo local." }));
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsDbLoading(false);
        }
      });
  }, [toast]);


 // Effect to subscribe to counting list from Firestore
useEffect(() => {
    if (!currentUserId || !currentWarehouseId || !db) {
        if (isMountedRef.current) {
            // Fallback to localStorage if Firestore cannot be used
            const localKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
            const localList = getLocalStorageItem<DisplayProduct[]>(localKey, []);
            setCountingList(localList.filter(item => item.warehouseId === currentWarehouseId));
            setIsDbLoading(false);
        }
        return () => {}; // Return empty unsubscribe for this path
    }

    setIsDbLoading(true);
    const unsubscribeFirestore = subscribeToCountingList(currentUserId, currentWarehouseId, (productsFromFirestore) => {
        if (isMountedRef.current) {
            // Firestore is the source of truth when available
            setCountingList(productsFromFirestore);
            // Also update localStorage as a backup/cache
            const localKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
            setLocalStorageItem(localKey, productsFromFirestore);
            setIsDbLoading(false);
        }
    });

    return () => {
        unsubscribeFirestore();
        if (isMountedRef.current) {
            setIsDbLoading(false);
        }
    };
}, [currentWarehouseId, currentUserId, toast]); // Removed db from dependencies as its presence is checked inside


 const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
        if (!warehouseId) return 'N/A';
        const warehouse = warehouses.find(w => w.id === warehouseId);
        return warehouse ? warehouse.name : `Almacén (${warehouseId})`;
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
      if(isMountedRef.current) {
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                toast({ variant: "default", title: "Código vacío" });
            }
        });
      }
      requestAnimationFrame(() => {
          if (isMountedRef.current) {
              setBarcode("");
              focusBarcodeIfCounting();
          }
      });
      return;
    }
    if (!currentWarehouseId || !currentUserId) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén o no hay usuario activo." });
                }
            });
        }
        return;
    }

     if (trimmedBarcode === lastScannedBarcode) {
         requestAnimationFrame(() => {
             if (isMountedRef.current) {
                 setBarcode("");
                 focusBarcodeIfCounting();
             }
         });
         return;
     }
     if(isMountedRef.current) {
        if (lastScannedTimeoutRef.current) {
            clearTimeout(lastScannedTimeoutRef.current);
        }
        setLastScannedBarcode(trimmedBarcode);
        lastScannedTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) setLastScannedBarcode(null);
        }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }

    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);
    let operationToFirestore: Promise<void> | null = null;

    if (existingProductIndex !== -1) {
        const productToUpdate = countingList[existingProductIndex];
        const newCount = (productToUpdate.count ?? 0) + 1;

        const updatedProductData: DisplayProduct = {
            ...productToUpdate,
            count: newCount,
            lastUpdated: new Date().toISOString(),
        };
        // Optimistically update UI via onSnapshot, Firestore write is source of truth
        if (currentUserId && currentWarehouseId) {
           operationToFirestore = setCountingListItem(currentUserId, currentWarehouseId, updatedProductData);
        }
        playBeep(880, 100);
    } else {
        let newProductForList: DisplayProduct | null = null;
        try {
            const barcodeToLookup = trimmedBarcode;
            console.log(`[handleAddProduct] Buscando código: "'${barcodeToLookup}'" (longitud: ${barcodeToLookup.length})`);
            const catalogProd = await getProductFromIndexedDB(barcodeToLookup);
            console.log(`[handleAddProduct] Resultado para '${barcodeToLookup}':`, JSON.parse(JSON.stringify(catalogProd || {})));

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
                const descriptionForToast = `Producto desconocido ${trimmedBarcode}`;
                newProductForList = {
                    barcode: trimmedBarcode,
                    description: descriptionForToast,
                    provider: "Desconocido",
                    warehouseId: currentWarehouseId,
                    stock: 0,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                    expirationDate: undefined,
                };
                playBeep(440, 300);
                if(isMountedRef.current && (activeSection === 'Contador' || activeSection === 'Contador Cámara')){
                    requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            toast({
                                variant: "destructive",
                                title: "Producto Desconocido",
                                description: `Agregado temporalmente. Edita en 'Catálogo'.`,
                            });
                        }
                    });
                }
            }
             if (isMountedRef.current && newProductForList && currentUserId && currentWarehouseId) {
                 operationToFirestore = setCountingListItem(currentUserId, currentWarehouseId, newProductForList);
             }
        } catch (error) {
            console.error("Error fetching or adding product:", error);
            if(isMountedRef.current) {
                requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error de Catálogo Local" });
                    }
                });
            }
            playBeep(440, 300);
        }
    }

    if (operationToFirestore) {
        setIsSyncing(true);
        operationToFirestore
            .catch(err => {
                console.error("Firestore error in handleAddProduct:", err);
                if (isMountedRef.current) {
                    requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: "No se pudo guardar el cambio en la nube." }));
                }
            })
            .finally(() => {
                if (isMountedRef.current) setIsSyncing(false);
            });
    }

    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            setBarcode("");
            focusBarcodeIfCounting();
        }
    });
  }, [barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, focusBarcodeIfCounting, activeSection, catalogProducts, setCountingList]);


const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
    if (productIndexInList === -1) {
         if(isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: `Producto no encontrado.`}));
         return;
    }

    const productInList = countingList[productIndexInList];
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    const calculatedNewValue = Math.max(0, originalValue + change);
    
    const updatedProductForFirestore: DisplayProduct = {
        ...productInList,
        [type]: calculatedNewValue,
        lastUpdated: new Date().toISOString()
    };

    let firestorePromise: Promise<void> | null = null;
    setIsSyncing(true);

    if (type === 'count') {
        firestorePromise = setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
        // No toast for discrepancy here, handled by visual cues / other sections
    } else if (type === 'stock') {
        // Update stock in IndexedDB first
        try {
            const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
            if (localCatalogProduct) {
                const updatedDbProduct: ProductDetail = { ...localCatalogProduct, stock: calculatedNewValue };
                await addOrUpdateProductToIndexedDB(updatedDbProduct);
                setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                // Also update the item in the counting list (Firestore will sync this part)
                firestorePromise = setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
            } else {
                // Product not in catalog, cannot update stock. Potentially add it? For now, toast an error.
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "Producto no encontrado en catálogo local para actualizar stock."}));
                setIsSyncing(false);
            }
        } catch (error) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo actualizar stock en catálogo local."}));
            setIsSyncing(false);
        }
    }

    if (firestorePromise) {
        firestorePromise
            .catch(err => {
                console.error("Firestore error in modifyProductValue:", err);
                if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
            })
            .finally(() => {
                if (isMountedRef.current) setIsSyncing(false);
            });
    } else {
        // If no firestorePromise was initiated (e.g., stock update failed locally)
        if (isMountedRef.current) setIsSyncing(false);
    }

     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
  }, [currentWarehouseId, currentUserId, toast, countingList, catalogProducts, focusBarcodeIfCounting, setCountingList]);


const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;
    if (newValue < 0 || isNaN(newValue)) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Valor Inválido" }));
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
    if (productIndexInList === -1) return;

    const productInList = countingList[productIndexInList];
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;

    if (type === 'count' && !sumValue && newValue === originalValue && !isConfirmQuantityDialogOpen) {
        if(isMountedRef.current) setOpenModifyDialog(null);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    const finalNewValue = Math.max(0, calculatedValue);

    if (type === 'count' && productInList.stock !== undefined && finalNewValue > productInList.stock && (!sumValue || originalValue <= productInList.stock)) {
        if(isMountedRef.current){
            setConfirmQuantityProductBarcode(productInList.barcode);
            setConfirmQuantityAction('set');
            setConfirmQuantityNewValue(finalNewValue);
            setIsConfirmQuantityDialogOpen(true);
        }
        playBeep(660, 100);
        return; // Wait for confirmation
    }
    
    const updatedProductForFirestore: DisplayProduct = {
        ...productInList,
        [type]: finalNewValue,
        lastUpdated: new Date().toISOString()
    };

    let firestorePromise: Promise<void> | null = null;
    setIsSyncing(true);

    if (type === 'count') {
        firestorePromise = setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
    } else if (type === 'stock') {
        try {
            const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
            if (localCatalogProduct) {
                const updatedDbProduct: ProductDetail = { ...localCatalogProduct, stock: finalNewValue };
                await addOrUpdateProductToIndexedDB(updatedDbProduct);
                setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                firestorePromise = setCountingListItem(currentUserId, currentWarehouseId, updatedProductForFirestore);
            } else {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "Producto no en catálogo local."}));
                setIsSyncing(false);
            }
        } catch (error) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo actualizar stock local."}));
            setIsSyncing(false);
        }
    }

    if (firestorePromise) {
        firestorePromise
            .catch(err => {
                 if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización" }));
            })
            .finally(() => {
                if (isMountedRef.current) setIsSyncing(false);
            });
    } else {
        if (isMountedRef.current) setIsSyncing(false);
    }

    if(isMountedRef.current) setOpenModifyDialog(null);
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
}, [toast, countingList, catalogProducts, focusBarcodeIfCounting, currentUserId, currentWarehouseId, isConfirmQuantityDialogOpen, showDiscrepancyToastIfNeeded, setCountingList]);


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
        if(isMountedRef.current) {
            // Optionally show a success toast, though onSnapshot will update UI
            // requestAnimationFrame(() => toast({ title: "Cantidad Confirmada" }));
        }
    } catch (error) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: "No se pudo guardar la cantidad confirmada." }));
        }
    } finally {
        if(isMountedRef.current) {
            setIsSyncing(false);
            setIsConfirmQuantityDialogOpen(false);
            setConfirmQuantityProductBarcode(null);
            setConfirmQuantityAction(null);
            setConfirmQuantityNewValue(null);
            setOpenModifyDialog(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [currentWarehouseId, currentUserId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, countingList, focusBarcodeIfCounting, showDiscrepancyToastIfNeeded, setCountingList]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         if(isMountedRef.current) setProductToDelete(product);
         if(isMountedRef.current) setIsDeleteDialogOpen(true);
  }, []);

 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete || !currentUserId || !currentWarehouseId) return;

     const descriptionForToast = productToDelete.description;
     const barcodeForToast = productToDelete.barcode;

    setIsSyncing(true);
    try {
        await deleteCountingListItem(currentUserId, currentWarehouseId, productToDelete.barcode);
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({
                    title: "Producto eliminado",
                    description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó.`,
                });
            });
        }
    } catch (error) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                toast({ variant: "destructive", title: "Error de Sincronización", description: "No se pudo eliminar el producto de la nube."});
            });
        }
    } finally {
        if(isMountedRef.current){
            setIsSyncing(false);
            setIsDeleteDialogOpen(false);
            setProductToDelete(null);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [productToDelete, toast, focusBarcodeIfCounting, currentUserId, currentWarehouseId, setCountingList]);

 const handleClearCurrentList = useCallback(async () => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return;

    setIsSyncing(true);
    try {
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        if(isMountedRef.current) {
            requestAnimationFrame(() => toast({ title: "Lista Borrada" }));
        }
    } catch (error) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: "No se pudo borrar la lista en la nube." }));
        }
    } finally {
        if(isMountedRef.current) {
            setIsSyncing(false);
            setIsDeleteListDialogOpen(false);
        }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId, setCountingList]);

 const handleExport = useCallback(() => {
     const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
     if (currentWarehouseList.length === 0) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ title: "Vacío", description: "No hay productos para exportar." });
                }
            });
        }
        return;
    }
    try {
        if (typeof Papa === 'undefined') {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error de Exportación", description: "La librería PapaParse no está cargada." });
                }
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
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ title: "Exportado" });
                }
            });
        }
    } catch (error) {
        console.error("Error exporting inventory:", error);
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error de Exportación" });
                }
            });
        }
    }
    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
 }, [countingList, currentWarehouseId, toast, getWarehouseName, focusBarcodeIfCounting]);


 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current || !currentUserId) return;
     if(isMountedRef.current) {
        setIsRefreshingStock(true);
        setIsSyncing(true); // Indicate potential Firestore writes
     }
     let updatedProductCount = 0;
     let productsToUpdateInFirestore: DisplayProduct[] = [];

     try {
        const allLocalCatalogProducts = await getAllProductsFromIndexedDB();
        if (isMountedRef.current) setCatalogProducts(allLocalCatalogProducts);

        const currentWarehouseItems = countingList.filter(item => item.warehouseId === currentWarehouseId);

        currentWarehouseItems.forEach(countingProduct => {
            const catalogProd = allLocalCatalogProducts.find(cp => cp.barcode === countingProduct.barcode);
            if (catalogProd) {
                if (countingProduct.description !== catalogProd.description ||
                    countingProduct.provider !== catalogProd.provider ||
                    countingProduct.stock !== (catalogProd.stock ?? 0) ||
                    countingProduct.expirationDate !== (catalogProd.expirationDate || undefined)
                   )
                {
                    updatedProductCount++;
                    productsToUpdateInFirestore.push({
                        ...countingProduct,
                        description: catalogProd.description,
                        provider: catalogProd.provider,
                        stock: catalogProd.stock ?? 0,
                        expirationDate: catalogProd.expirationDate || undefined,
                        lastUpdated: new Date().toISOString(), // Ensure lastUpdated is set
                    });
                }
            }
        });
        
        if (productsToUpdateInFirestore.length > 0 && currentUserId && currentWarehouseId) {
            const batch = writeBatch(db!); // db should be defined if currentUserId is present
            productsToUpdateInFirestore.forEach(prod => {
                const docRef = doc(collection(db!, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), prod.barcode);
                batch.set(docRef, prod);
            });
            await batch.commit();
        }
        // Note: The UI will update via the onSnapshot listener for countingList

        requestAnimationFrame(() => {
            if(isMountedRef.current) {
                toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) en la lista.` });
            }
        });

     } catch (error) {
         console.error(`Error refreshing stock for warehouse ${currentWarehouseId}:`, error);
          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar datos.` });
              }
          });
     } finally {
         if (isMountedRef.current) {
             setIsRefreshingStock(false);
             setIsSyncing(false);
         }
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
     }
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, currentUserId, countingList, catalogProducts, setCountingList]); // Added catalogProducts and setCountingList


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
         let productDataToEdit = await getProductFromIndexedDB(product.barcode);
         let source = "Catálogo Local (IndexedDB)";

         if (productDataToEdit) {
             if (!isMountedRef.current) return;
             setProductToEditDetail(productDataToEdit);
             setInitialStockForEdit(productDataToEdit.stock ?? 0);
             setIsEditDetailDialogOpen(true);
         } else {
             if (!isMountedRef.current) return;
             const placeholderDetail: ProductDetail = {
                 barcode: product.barcode,
                 description: product.description || `Producto ${product.barcode}`,
                 provider: product.provider || "Desconocido",
                 stock: product.stock ?? 0,
                 expirationDate: product.expirationDate || undefined,
             };
             setProductToEditDetail(placeholderDetail);
             setInitialStockForEdit(product.stock ?? 0); 
             setIsEditDetailDialogOpen(true);
             requestAnimationFrame(() => {
                if(isMountedRef.current) {
                    toast({ variant: "default", title: "Editando Nuevo Producto", description: "Este producto se agregará al catálogo local." });
                }
             });
         }
     } catch (error) {
         if (!isMountedRef.current) return;
         console.error("Error fetching product details for edit:", error);
         requestAnimationFrame(() => {
            if(isMountedRef.current) {
                toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudieron obtener datos." });
            }
         });
     } finally {
         if (isMountedRef.current) {
            setIsDbLoading(false);
         }
     }
 }, [toast, currentUserId]);

 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
     if (!isMountedRef.current || !productToEditDetail || !currentUserId) return;
     if(isMountedRef.current) setIsDbLoading(true);
     setIsSyncing(true); // Indicate potential Firestore writes if catalog were synced
     try {
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, 
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || null,
         };
         await addOrUpdateProductToIndexedDB(updatedProductData);

         setCatalogProducts(prev => {
            const existingIndex = prev.findIndex(p => p.barcode === updatedProductData.barcode);
            if (existingIndex !== -1) {
                const newCatalog = [...prev];
                newCatalog[existingIndex] = updatedProductData;
                return newCatalog;
            }
            return [...prev, updatedProductData];
         });

        // If the edited product is in the current counting list, update its details there too (via Firestore)
        const productInCountingList = countingList.find(item => item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId);
        if (productInCountingList && currentWarehouseId) {
            const updatedCountingListItem: DisplayProduct = {
                ...productInCountingList,
                description: updatedProductData.description,
                provider: updatedProductData.provider,
                stock: updatedProductData.stock, // Crucially update stock here
                expirationDate: updatedProductData.expirationDate,
                lastUpdated: new Date().toISOString(),
            };
            await setCountingListItem(currentUserId, currentWarehouseId, updatedCountingListItem);
        }


         requestAnimationFrame(() => {
            if(isMountedRef.current) {
                toast({ title: "Producto Actualizado" });
            }
         });
         if(isMountedRef.current){
            setIsEditDetailDialogOpen(false);
            setProductToEditDetail(null);
         }
     } catch (error: any) {
         if (!isMountedRef.current) return;
          requestAnimationFrame(() => {
            if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
            }
          });
     } finally {
         if (isMountedRef.current) {
             setIsDbLoading(false);
             setIsSyncing(false);
         }
         requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
     }
 }, [toast, currentWarehouseId, productToEditDetail, focusBarcodeIfCounting, currentUserId, countingList, catalogProducts, setCountingList]); // Added catalogProducts, setCountingList

 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) return;
    if (!productsToCount || productsToCount.length === 0) {
        requestAnimationFrame(() => {
           if(isMountedRef.current) {
            toast({ title: "Vacío", description: "No hay productos para este proveedor." });
           }
        });
        return;
    }
   const productsWithWarehouseContext: DisplayProduct[] = productsToCount.map(dbProduct => ({
       barcode: dbProduct.barcode,
       description: dbProduct.description,
       provider: dbProduct.provider,
       stock: dbProduct.stock ?? 0,
       expirationDate: dbProduct.expirationDate || undefined,
       warehouseId: currentWarehouseId,
       count: 0, // Start count at 0
       lastUpdated: new Date().toISOString(),
   }));

    setIsSyncing(true);
    try {
        // Clear existing list for this warehouse in Firestore first
        await clearCountingListForWarehouseInFirestore(currentUserId, currentWarehouseId);
        // Then add new products in a batch
        const batch = writeBatch(db!);
        productsWithWarehouseContext.forEach(prod => {
            const docRef = doc(collection(db!, `users/${currentUserId}/countingLists/${currentWarehouseId}/products`), prod.barcode);
            batch.set(docRef, prod);
        });
        await batch.commit();
        // UI will update via onSnapshot
        if (isMountedRef.current) {
            setActiveSection("Contador");
            setSearchTerm("");
            requestAnimationFrame(() => {
                toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` });
            });
        }
    } catch (error) {
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Sincronización", description: "No se pudo iniciar el conteo por proveedor en la nube."}));
        }
    } finally {
        if (isMountedRef.current) setIsSyncing(false);
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
}, [toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, currentUserId, setCountingList]);


  const filteredCountingList = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
    if (!lowerSearchTerm) return currentWarehouseList;
    return currentWarehouseList.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) ||
      (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
      (product.expirationDate || '').includes(lowerSearchTerm)
    );
  }, [countingList, searchTerm, currentWarehouseId]);

  const handleSectionChange = useCallback((newSection: string) => {
    if(isMountedRef.current) setActiveSection(newSection);
    if (newSection === 'Contador' || newSection === 'Contador Cámara') {
        requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [setActiveSection, focusBarcodeIfCounting]);

   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             startTransition(() => {
                // setIsDbLoading(true); // This will be handled by the Firestore subscription effect
                setCurrentWarehouseId(newWarehouseId);
                setSearchTerm(""); // Clear search when changing warehouse
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
          requestAnimationFrame(() => {
              toast({ variant: 'destructive', title: 'Error', description: 'Nombre de almacén ya existe.' });
          });
          return;
      }
      setIsSyncing(true);
      try {
          await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
          requestAnimationFrame(() => {
              toast({title: "Almacén Agregado", description: `Cambiado a: ${newWarehouse.name}`});
          });
          // UI update will be handled by onSnapshot for warehouses
          handleWarehouseChange(newWarehouse.id); 
      } catch (error) {
         // Error toast handled by firestore-service or the calling function
      } finally {
          setIsSyncing(false);
      }
    }, [warehouses, currentUserId, handleWarehouseChange, toast]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) return;
       setIsSyncing(true);
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, warehouseToUpdate);
           requestAnimationFrame(() => toast({ title: `Almacén "${warehouseToUpdate.name}" Actualizado` }));
           // UI update via onSnapshot
       } catch (error) {
          // Error toast handled by firestore-service
       } finally {
            setIsSyncing(false);
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
           // UI update via onSnapshot. If current warehouse deleted, logic in onSnapshot callback will handle it.
           requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
       } catch (error) {
          // Error toast handled by firestore-service
       } finally {
            setIsSyncing(false);
       }
   }, [toast, currentUserId, currentWarehouseId, warehouses]); // Added currentWarehouseId and warehouses for selection logic


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
    // No setIsSyncing here as this is a local IndexedDB operation
    try {
      await clearProductDatabaseInIndexedDB();

      if(isMountedRef.current) {
        setCatalogProducts([]);
        // No need to update countingList stock based on catalog clear, as they are separate
        // If Firestore catalog were used, this would involve a Firestore clear and potentially
        // a re-fetch or update of related countingList items.
      }
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            toast({ title: "Catálogo Borrado" });
          }
      });
    } catch (error: any) {
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: `No se pudieron borrar datos: ${error.message}` });
          }
      });
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setIsClearCatalogConfirmOpen(false);
      }
      requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
    }
  }, [toast, currentUserId, focusBarcodeIfCounting, setCountingList, catalogProducts]); // Added catalogProducts, setCountingList


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
        setCurrentUserId(null); // This will trigger useEffect to unsubscribe from Firestore
        setCountingList([]);
        setCatalogProducts([]); // Clear local catalog display
        setWarehouses(PREDEFINED_WAREHOUSES_LIST); 
        setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID);
        if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
            // Clear warehouse-specific localStorage items if necessary, though new user won't match
        }
        isInitialFetchDoneForUser.current = {}; // Reset initial fetch flags
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
            setCurrentUserId(LOGIN_USER); // This will trigger useEffects for Firestore data
            setIsAuthenticated(true);
            setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, LOGIN_USER);
            // currentWarehouseId will be set by the useEffect that subscribes to warehouses
            // or from localStorage for this user.
            isInitialFetchDoneForUser.current[LOGIN_USER] = false; // Reset for new login session

            requestAnimationFrame(() => {
                toast({ title: "Inicio de sesión exitoso" });
            });
            setLoginUsername("");
            setLoginPassword("");
        }
    } else {
        if (isMountedRef.current) {
             requestAnimationFrame(() => {
                toast({ variant: "destructive", title: "Error de inicio de sesión" });
            });
        }
        setLoginPassword("");
    }
  };

  const handleBarcodeScannedFromCamera = useCallback((scannedBarcode: string) => {
    if (isMountedRef.current) {
      handleAddProduct(scannedBarcode); 
    }
  }, [handleAddProduct]);


  // Render login form if not authenticated
  if (!isAuthenticated) {
    return (
        <div className="login-container">
            <div className="login-form bg-card p-8 rounded-lg shadow-xl w-full max-w-sm">
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

  // Main application layout
  return (
    <div className="flex flex-col md:flex-row h-screen bg-background text-foreground">
      <div className="md:hidden p-4 border-b flex items-center justify-between bg-card sticky top-0 z-20">
        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Abrir menú">
              <MenuIcon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[280px] sm:w-[320px] bg-card flex flex-col">
            <SheetHeader className="sr-only">
              <SheetTitle>Menú Principal</SheetTitle>
            </SheetHeader>
            <SidebarLayout
              {...sidebarProps}
            />
          </SheetContent>
        </Sheet>
        <h2 className="text-xl font-bold truncate ml-4">StockCounter Pro</h2>
        <div className="w-8"></div> {/* Spacer */}
      </div>

      <aside className={cn(
        "hidden md:flex flex-shrink-0 border-r bg-card flex-col transition-all duration-300 ease-in-out",
        isSidebarCollapsed ? "w-20" : "w-60"
      )}>
        <SidebarLayout
          {...sidebarProps}
        />
      </aside>

      <main className="flex-1 p-6 overflow-y-auto relative"> {/* Added relative for sync indicator */}
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
                            requestAnimationFrame(() => {
                            toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                            });
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
                        requestAnimationFrame(() => {
                            toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                        });
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
            <div className="h-1/2 md:h-2/5 border rounded-lg overflow-hidden">
              <BarcodeScannerCamera
                onBarcodeScanned={handleBarcodeScannedFromCamera}
                isScanningActive={activeSection === 'Contador Cámara'}
                isDecodingActive={true} 
              />
            </div>

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
                            requestAnimationFrame(() => {
                            toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                            });
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
                        requestAnimationFrame(() => {
                            toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                        });
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
                  isTransitionPending={isDbLoading || isTransitionPending}
                  catalogProducts={catalogProducts}
                  setCatalogProducts={setCatalogProducts}
                  onClearCatalogRequest={() => {if(isMountedRef.current) setIsClearCatalogConfirmOpen(true)}}
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
                    isLoading={isDbLoading || isTransitionPending}
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
            setIsConfirmQuantityDialogOpen(open);
            if (!open) {
                setConfirmQuantityProductBarcode(null);
                setConfirmQuantityAction(null);
                setConfirmQuantityNewValue(null);
                requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
            }
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
          onCancel={() => {
              if(isMountedRef.current){
                setIsConfirmQuantityDialogOpen(false);
                setConfirmQuantityProductBarcode(null);
                setConfirmQuantityAction(null);
                setConfirmQuantityNewValue(null);
              }
              requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
          }}
          isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
         isOpen={isDeleteDialogOpen}
         onOpenChange={(open) => {
            setIsDeleteDialogOpen(open);
            if (!open) {
                setProductToDelete(null);
                requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
            }
         }}
         title="Confirmar Eliminación"
         description={ productToDelete ? `¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) de la lista actual (${getWarehouseName(productToDelete?.warehouseId)})?` : `¿Seguro que deseas eliminar este producto?`}
         onConfirm={confirmDelete}
         onCancel={() => {
            if(isMountedRef.current) setIsDeleteDialogOpen(false);
            requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
         }}
         isDestructive={true}
         isProcessing={isTransitionPending || isSyncing}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteListDialogOpen(open);
            if (!open) {
                requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
            }
          }}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})?`}
          onConfirm={handleClearCurrentList}
          onCancel={() => {
            if(isMountedRef.current) setIsDeleteListDialogOpen(false);
            requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
          }}
          isDestructive={true}
          isProcessing={isTransitionPending || isSyncing}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => {
                setIsClearCatalogConfirmOpen(open);
                if (!open) {
                    requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
                }
            }}
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
            confirmText="Sí, Borrar Catálogo Local"
            onConfirm={handleClearCatalog}
            onCancel={() => {
                if(isMountedRef.current) setIsClearCatalogConfirmOpen(false);
                requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
            }}
            isDestructive={true}
            isProcessing={isDbLoading || isTransitionPending}
        />

      {productToEditDetail && currentUserId && (
        <EditProductDialog
          isOpen={isEditDetailDialogOpen}
          setIsOpen={(open) => {
              setIsEditDetailDialogOpen(open);
              if (!open) {
                  setProductToEditDetail(null);
                  requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
              }
          }}
          selectedDetail={productToEditDetail}
          setSelectedDetail={setProductToEditDetail}
          onSubmit={handleEditDetailSubmit}
          onDelete={ async (barcode) => {
                if (!isMountedRef.current || !currentUserId) return;
                setIsDbLoading(true);
                // No setIsSyncing here unless deleting from Firestore catalog
                try {
                    await deleteProductFromIndexedDB(barcode);

                    if (!isMountedRef.current) return;
                    setCatalogProducts(prev => prev.filter(p => p.barcode !== barcode));
                    // If product was in current counting list, remove it from Firestore
                    const productInCountingList = countingList.find(item => item.barcode === barcode && item.warehouseId === currentWarehouseId);
                    if(productInCountingList && currentWarehouseId) {
                        setIsSyncing(true);
                        await deleteCountingListItem(currentUserId, currentWarehouseId, barcode).finally(()=> setIsSyncing(false));
                    }
                    requestAnimationFrame(() => toast({title: "Producto eliminado del catálogo local"}));
                    if(isMountedRef.current) {
                      setIsEditDetailDialogOpen(false);
                      setProductToEditDetail(null);
                    }
                } catch (error: any) {
                      if (!isMountedRef.current) return;
                      requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
                } finally {
                      if (isMountedRef.current) setIsDbLoading(false);
                      requestAnimationFrame(() => { if (isMountedRef.current) focusBarcodeIfCounting(); });
                }
            }}
          isProcessing={isDbLoading || isTransitionPending || isSyncing}
          initialStock={initialStockForEdit}
          context="countingList" // Or "database" if called from ProductDatabase module
          warehouseName={getWarehouseName(currentWarehouseId)}
        />
      )}
    </div>
  );
}
