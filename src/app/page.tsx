// src/app/page.tsx
"use client";

import type { DisplayProduct, ProductDetail, Warehouse } from '@/types/product'; // CountingHistoryEntry removed
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
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock, BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide, LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert, Filter, PanelLeftClose, PanelRightOpen, Save, Library, X, Check } from "lucide-react"; // Added Library, X, Check icons
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
  // Removed history related imports from database.ts
  // saveCountingHistory,
  // getCountingHistory,
  // clearCountingHistory
} from '@/lib/database'; // Using IndexedDB for product catalog and local history
import {
  subscribeToWarehouses, 
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
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
import { BarcodeEntry } from '@/components/barcode-entry';
import {
    LOCAL_STORAGE_USER_ID_KEY,
    LOCAL_STORAGE_ACTIVE_SECTION_KEY,
    LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY,
    LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX,
    LOGIN_USER,
    LOGIN_PASSWORD,
    LAST_SCANNED_BARCODE_TIMEOUT_MS,
    LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX, // Added for localStorage persistence of countingList
    DEFAULT_WAREHOUSE_ID,
    DEFAULT_WAREHOUSE_NAME,
  } from '@/lib/constants';
// Firebase db instance for Firestore operations (history, warehouses)
// The db import is used by firestore-service.ts, so ensure it's correctly initialized in firebase.ts
import { db } from '@/lib/firebase'; 
import { writeBatch, doc, collection } from 'firebase/firestore';
import { ConsolidatedView } from '@/components/consolidated-view';


// --- Main Component ---

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
  
  const PREDEFINED_WAREHOUSES_LIST: Warehouse[] = [
    { id: DEFAULT_WAREHOUSE_ID, name: DEFAULT_WAREHOUSE_NAME },
    { id: 'bodega', name: 'BODEGA' },
    { id: 'isla', name: 'ISLA' },
    { id: 'meson', name: 'MESON' },
    { id: 'vitrinas', name: 'VITRINAS' },
    { id: 'oficina', name: 'OFICINA' },
  ];

  // Initialize warehouses state with predefined list for initial render consistency
  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  
  // State for master product catalog (from IndexedDB)
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
  const [isDbLoading, setIsDbLoading] = useState(true); 
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  // const [isSavingToHistory, setIsSavingToHistory] = useState(false); // Removed, history saving is removed
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
  const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0);
  const [isClearCatalogConfirmOpen, setIsClearCatalogConfirmOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const isMobile = useIsMobile();
  const isInitialFetchDoneForUser = useRef<Record<string, boolean>>({});


  // --- Helper Functions ---
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
        }, 100); // Increased delay for focus robustness
    }
  }, [activeSection]);

  // --- Effects ---

 useEffect(() => {
    isMountedRef.current = true;
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId === LOGIN_USER) { 
        setCurrentUserId(LOGIN_USER);
        setIsAuthenticated(true);
        const storedWarehouseId = getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${LOGIN_USER}`, DEFAULT_WAREHOUSE_ID);
        setCurrentWarehouseId(storedWarehouseId); 
    } else {
        setCurrentUserId(null);
        setIsAuthenticated(false);
        if(typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
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

  // Subscribe to warehouses from Firestore
  useEffect(() => {
    if (!currentUserId || !db) { 
        if (isMountedRef.current) {
            setWarehouses(PREDEFINED_WAREHOUSES_LIST); // Show predefined if no user or db
            const storedWarehouseId = currentUserId ? getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
            const currentSelectionIsValid = PREDEFINED_WAREHOUSES_LIST.some(w => w.id === storedWarehouseId);
            setCurrentWarehouseId(currentSelectionIsValid ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
            setIsDbLoading(false); 
        }
        return;
    }

    setIsDbLoading(true); 
    
    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehouses) => {
      if (isMountedRef.current) {
        let finalWarehousesToSet = [...fetchedWarehouses];
        
        if (!isInitialFetchDoneForUser.current[currentUserId] && db && currentUserId) { 
            isInitialFetchDoneForUser.current[currentUserId] = true; 
            
            const warehousesToAddBatch: Warehouse[] = [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predefined => {
                if (!fetchedWarehouses.some(fw => fw.id === predefined.id)) {
                    warehousesToAddBatch.push(predefined);
                }
            });

            if (warehousesToAddBatch.length > 0) {
                try {
                    const batch = writeBatch(db); 
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                    // Firestore listener will pick up these changes and update finalWarehousesToSet
                } catch (err) {
                    console.error(`Failed to add predefined warehouses to Firestore for user ${currentUserId}:`, err);
                    requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                    // Fallback to local list if batch fails
                    finalWarehousesToSet = [...fetchedWarehouses, ...warehousesToAddBatch].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i); // Ensure unique by ID
                }
            }
             if (finalWarehousesToSet.length === 0 && warehousesToAddBatch.length === 0) { // If Firestore is empty AND batch was empty
                 finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST]; // Ensure a default if everything is empty
            }
        }
        
        // Ensure PREDEFINED_WAREHOUSES_LIST is used if finalWarehousesToSet is still empty (e.g., offline, initial error)
        setWarehouses(finalWarehousesToSet.length > 0 ? finalWarehousesToSet : PREDEFINED_WAREHOUSES_LIST);

        // Logic to determine currentWarehouseId based on available warehouses
        const storedWarehouseId = getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID);
        const effectiveWarehouseList = finalWarehousesToSet.length > 0 ? finalWarehousesToSet : PREDEFINED_WAREHOUSES_LIST;
        let currentSelectionIsValid = effectiveWarehouseList.some(w => w.id === storedWarehouseId);
        
        if (!currentSelectionIsValid) {
            const mainExistsInEffectiveList = effectiveWarehouseList.find(w => w.id === DEFAULT_WAREHOUSE_ID);
            const newCurrentId = mainExistsInEffectiveList ? DEFAULT_WAREHOUSE_ID : (effectiveWarehouseList[0]?.id || DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(newCurrentId);
            if (currentUserId) setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newCurrentId);
        } else {
            setCurrentWarehouseId(storedWarehouseId); // Keep stored if valid
        }
        setIsDbLoading(false); 
      }
    });

    return () => {
      unsubscribe();
      if (isMountedRef.current) setIsDbLoading(false); // Reset loading state on cleanup
    };
  }, [currentUserId, toast]); // Removed PREDEFINED_WAREHOUSES_LIST as it's stable


  // Load master product catalog from IndexedDB
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


 // Load counting list from localStorage when warehouse or user changes
 useEffect(() => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) {
        if(isMountedRef.current) setIsDbLoading(false); // Ensure loading is off if no user/warehouse
        if(isMountedRef.current) setCountingList([]); // Clear list if no context
        return;
    }

    if(isMountedRef.current) setIsDbLoading(true);
    const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
    let savedList: DisplayProduct[] = getLocalStorageItem<DisplayProduct[]>(savedListKey, []);

    // Basic validation for the structure of savedList
    if (Array.isArray(savedList) && savedList.every(item => typeof item?.barcode === 'string')) {
        // Ensure all essential properties are present and have defaults
        const loadedList = savedList
            .map(item => ({
                ...item,
                stock: item.stock ?? 0, // Default to 0 if undefined
                count: item.count ?? 0, // Default to 0 if undefined
                lastUpdated: item.lastUpdated || new Date().toISOString(), // Default to now if undefined
                warehouseId: item.warehouseId || currentWarehouseId, // Default to current if undefined
                expirationDate: item.expirationDate || undefined, // Keep undefined if not present
            }));
        if(isMountedRef.current) setCountingList(loadedList.filter(item => item.warehouseId === currentWarehouseId));
    } else {
        // If data structure is invalid, log it and clear the bad data from localStorage
        if (Array.isArray(savedList) && savedList.length > 0 && !savedList.every(item => typeof item?.barcode === 'string')) {
           console.warn(`Invalid data structure in localStorage for ${savedListKey}. Clearing.`);
        }
        if(typeof window !== 'undefined') localStorage.removeItem(savedListKey);
        if(isMountedRef.current) setCountingList([]); // Reset to empty list
    }
    if(isMountedRef.current) setIsDbLoading(false);
 }, [currentWarehouseId, currentUserId]); // Re-run when warehouse or user changes

 // Debounced function to save counting list to localStorage
 const debouncedSaveCountingList = useMemo(
    () =>
      debounce((list: DisplayProduct[], warehouseId: string, userId: string) => {
        if (!warehouseId || !isMountedRef.current || !userId) return;
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}_${userId}`;
        // Filter list to save only items for the current warehouse
        const listToSave = list.filter(item => item.warehouseId === warehouseId);
        setLocalStorageItem(key, listToSave);
      }, 500), // Debounce for 500ms
    [] // No dependencies, function created once
  );

  // Effect to save counting list to localStorage
  useEffect(() => {
    // Only save if not in DB loading state and component is mounted, and warehouse/user are set
    if (!isDbLoading && isMountedRef.current && currentWarehouseId && currentUserId) {
      debouncedSaveCountingList(countingList, currentWarehouseId, currentUserId);
    }
    return () => {
       debouncedSaveCountingList.clear?.(); // Clear any pending debounced saves on unmount
    };
  }, [countingList, currentWarehouseId, currentUserId, isDbLoading, debouncedSaveCountingList]);


  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
        if (!warehouseId) return 'N/A';
        const warehouse = warehouses.find(w => w.id === warehouseId);
        return warehouse ? warehouse.name : `Almacén (${warehouseId})`;
  }, [warehouses]);

  const showDiscrepancyToastIfNeeded = useCallback((product: DisplayProduct, newCountVal?: number) => {
    const countToCheck = newCountVal !== undefined ? newCountVal : (product.count ?? 0);
    const stockToCheck = product.stock ?? 0;

    if (stockToCheck > 0 && countToCheck !== stockToCheck) {
        // Solo mostrar el toast si NO estamos en la sección 'Contador'
        if (isMountedRef.current && activeSection !== 'Contador') {
            requestAnimationFrame(() => {
                if(isMountedRef.current) {
                    toast({
                        title: "Alerta de Discrepancia",
                        description: `${product.description}: Contado ${countToCheck}, Stock ${stockToCheck}.`,
                        variant: "default",
                        // duration: 6000, // Removed, will use default from ToasterProvider
                    });
                }
            });
        }
        return true; // Importante: seguir retornando true para indicar que hay una discrepancia
    }
    return false;
  }, [toast, activeSection]); // Se añadió activeSection a las dependencias


 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    if (!isMountedRef.current) return;

    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, ''); // Clean barcode

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

     // Prevent processing the same barcode if scanned multiple times very quickly
     if (trimmedBarcode === lastScannedBarcode) {
         requestAnimationFrame(() => { // Ensure UI updates happen smoothly
             if (isMountedRef.current) {
                 setBarcode("");
                 focusBarcodeIfCounting();
             }
         });
         return; // Exit early
     }
     if(isMountedRef.current) {
        // Clear any existing timeout for last scanned barcode
        if (lastScannedTimeoutRef.current) {
            clearTimeout(lastScannedTimeoutRef.current); 
        }
        setLastScannedBarcode(trimmedBarcode); // Set current barcode as last scanned
        lastScannedTimeoutRef.current = setTimeout(() => { // Reset after a short delay
            if (isMountedRef.current) setLastScannedBarcode(null); 
        }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }


    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
        // Product exists in current list, increment its count
        const productToUpdate = countingList[existingProductIndex];
        const newCount = (productToUpdate.count ?? 0) + 1;
       
        const updatedProductData: DisplayProduct = {
            ...productToUpdate,
            count: newCount,
            lastUpdated: new Date().toISOString(),
        };
        if(isMountedRef.current) {
            startTransition(() => {
                setCountingList(currentList => {
                    const listWithoutOld = currentList.filter(item => !(item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId));
                    return [updatedProductData, ...listWithoutOld];
                });
            });
        }
        playBeep(880, 100); // Higher pitch for existing product
        showDiscrepancyToastIfNeeded(updatedProductData, newCount);
    } else {
        // Product does not exist in current list, try to find in catalog or add as unknown
        let newProductForList: DisplayProduct | null = null;
        try {
            const catalogProd = await getProductFromIndexedDB(trimmedBarcode);

            if (catalogProd) {
                // Product found in catalog
                newProductForList = {
                    ...catalogProd, // Spread catalog details (barcode, description, provider, stock, expirationDate)
                    warehouseId: currentWarehouseId,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(660, 150); // Medium pitch for new product from catalog
                showDiscrepancyToastIfNeeded(newProductForList); // Check for discrepancy
            } else {
                // Product not found in catalog, add as unknown
                const descriptionForToast = `Producto desconocido ${trimmedBarcode}`;
                newProductForList = {
                    barcode: trimmedBarcode,
                    description: descriptionForToast,
                    provider: "Desconocido",
                    warehouseId: currentWarehouseId,
                    stock: 0, // Default stock for unknown product
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                    expirationDate: undefined, // No expiration for unknown
                };
                playBeep(440, 300); // Lower pitch for unknown product
                if(isMountedRef.current){
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
             if (isMountedRef.current && newProductForList) {
                 const finalProduct = newProductForList; // Avoid issues with closure
                 startTransition(() => {
                    setCountingList(currentList => [finalProduct, ...currentList.filter(item => !(item.barcode === finalProduct.barcode && item.warehouseId === currentWarehouseId))]);
                 });
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
            playBeep(440, 300); // Error beep
        }
    }
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            setBarcode("");
            focusBarcodeIfCounting();
        }
    });
  }, [barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition]);


const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId) return;

    let finalValue: number | undefined;
    let productForToast: DisplayProduct | null = null;

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);

    if (productIndexInList === -1) {
         // Product not found in list - this shouldn't happen if called from UI
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error", description: `Producto no encontrado en la lista.`});
                }
            });
        }
         return;
    }
    
    const productInList = countingList[productIndexInList];
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    const calculatedNewValue = Math.max(0, originalValue + change); // Ensure value is not negative
    finalValue = calculatedNewValue;
    productForToast = { ...productInList, [type]: finalValue, lastUpdated: new Date().toISOString() };


    // Update state using functional update with startTransition for smoother UI
    startTransition(() => {
        setCountingList(prevList => {
            const currentProductIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
            if (currentProductIndex === -1) return prevList; // Should not happen if checked above

            const productToUpdate = prevList[currentProductIndex];
            const updatedValueForState = Math.max(0, (type === 'count' ? productToUpdate.count ?? 0 : productToUpdate.stock ?? 0) + change);

            const updatedProduct = {
                    ...productToUpdate,
                    [type]: updatedValueForState, // Use the state-specific original value for calculation
                    lastUpdated: new Date().toISOString()
            };
            // Move updated product to the top of the list
            const listWithoutProduct = prevList.filter((_, i) => i !== currentProductIndex);
            return [updatedProduct, ...listWithoutProduct];
        });
    });
    
    // Handle side effects (DB update for stock, discrepancy toast for count)
    if (finalValue !== undefined && productForToast) {
        if (type === 'stock') {
            // If stock is modified, update it in IndexedDB (master catalog)
            try {
                const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
                if (localCatalogProduct) {
                    const updatedDbProduct: ProductDetail = { ...localCatalogProduct, stock: finalValue };
                    await addOrUpdateProductToIndexedDB(updatedDbProduct); // Persist to IndexedDB
                    // Update local catalog state as well
                    setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                } else {
                    // If product somehow not in catalog but in list, add it to catalog
                    const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                    if (listProduct) {
                        const newDbProduct: ProductDetail = {
                            barcode: listProduct.barcode,
                            description: listProduct.description,
                            provider: listProduct.provider,
                            stock: finalValue, // Use the new stock value
                            expirationDate: listProduct.expirationDate,
                        };
                        await addOrUpdateProductToIndexedDB(newDbProduct);      
                        setCatalogProducts(prev => [...prev, newDbProduct]); // Add to local catalog state
                    }
                }
                if(isMountedRef.current) {
                    requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            toast({ title: `Stock Actualizado` });
                        }
                    });
                }
            } catch (error) {
                if(isMountedRef.current) {
                    requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            toast({
                                variant: "destructive",
                                title: "Error Catálogo Local",
                                description: `No se pudo actualizar stock en catálogo local.`
                            });
                        }
                    });
                }
            }
        } else if (type === 'count' && productForToast ) {
                // If count is modified, check for discrepancy
                showDiscrepancyToastIfNeeded(productForToast, finalValue);
        }
    }
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
  }, [currentWarehouseId, toast, countingList, catalogProducts, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition, currentUserId]);


const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
    if (!isMountedRef.current || !currentUserId) return;
    if (newValue < 0 || isNaN(newValue)) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Valor Inválido" });
                }
            });
        }
        requestAnimationFrame(() => { // Ensure focus is returned
             if (isMountedRef.current) {
                 focusBarcodeIfCounting();
             }
         });
        return;
    }

    let finalValue: number | undefined;
    let needsConfirmation = false;
    let productForToast: DisplayProduct | null = null;

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
    if (productIndexInList === -1) return; // Product not found in list

    const productInList = countingList[productIndexInList];
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    
    // If setting 'count' and the new value is the same as original (and not summing), do nothing
    if (type === 'count' && !sumValue && newValue === originalValue) {
        if(isMountedRef.current) setOpenModifyDialog(null); // Close dialog
        requestAnimationFrame(() => { // Ensure focus is returned
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    finalValue = Math.max(0, calculatedValue); // Ensure not negative
    productForToast = { ...productInList, [type]: finalValue, lastUpdated: new Date().toISOString() };


    // Check for confirmation only if type is 'count', new value exceeds stock,
    // original value was not exceeding stock, and stock is greater than 0.
    if (type === 'count') {
        needsConfirmation = finalValue > (productInList.stock ?? 0) && originalValue <= (productInList.stock ?? 0) && (productInList.stock ?? 0) > 0;
    }

    if (needsConfirmation) {
        // Open confirmation dialog
        if(isMountedRef.current) setConfirmQuantityProductBarcode(productInList.barcode);
        if(isMountedRef.current) setConfirmQuantityAction('set'); // Indicate the action being confirmed
        if(isMountedRef.current) setConfirmQuantityNewValue(finalValue);
        if(isMountedRef.current) setIsConfirmQuantityDialogOpen(true);
        playBeep(660, 100); // Play a sound for confirmation
    } else {
        // No confirmation needed, update directly
        startTransition(() => {
            setCountingList(prevList => {
                const currentProductIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                if (currentProductIndex === -1) return prevList; 
                
                const productToUpdate = prevList[currentProductIndex];
                const originalValForState = type === 'count' ? productToUpdate.count ?? 0 : productToUpdate.stock ?? 0;
                let calculatedValForState = sumValue ? (originalValForState + newValue) : newValue;
                const finalValForState = Math.max(0, calculatedValForState); // Ensure not negative

                const updatedProduct = {
                    ...productToUpdate,
                    [type]: finalValForState, // Update the specific field (count or stock)
                    lastUpdated: new Date().toISOString()
                };
                // Move updated product to the top
                const listWithoutProduct = prevList.filter((_, i) => i !== currentProductIndex);
                return [updatedProduct, ...listWithoutProduct];
            });
        });

        if(isMountedRef.current) setOpenModifyDialog(null); // Close modify dialog

         // Handle side effects (DB update for stock, discrepancy toast for count)
         if (finalValue !== undefined && productForToast) {
             if (type === 'stock') {
                 // If stock is modified, update it in IndexedDB (master catalog)
                 try {
                    const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
                    if (localCatalogProduct) {
                        const updatedDbProduct: ProductDetail = { ...localCatalogProduct, stock: finalValue };
                        await addOrUpdateProductToIndexedDB(updatedDbProduct); // Persist to IndexedDB
                        setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                    } else {
                        const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                        if (listProduct) {
                            const newDbProduct: ProductDetail = {
                                barcode: listProduct.barcode,
                                description: listProduct.description,
                                provider: listProduct.provider,
                                stock: finalValue, // Use the new stock value
                                expirationDate: listProduct.expirationDate,
                            };
                            await addOrUpdateProductToIndexedDB(newDbProduct);      
                            setCatalogProducts(prev => [...prev, newDbProduct]);
                        }
                    }
                    if(isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({ title: `Stock Actualizado` });
                            }
                        });
                    }
                 } catch (error) {
                     if(isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({
                                    variant: "destructive",
                                    title: "Error Catálogo Local",
                                    description: `No se pudo actualizar stock en catálogo local.`
                                });
                            }
                        });
                     }
                 }
             } else if (type === 'count' && productForToast) {
                 // If count is modified, check for discrepancy and show toast
                 showDiscrepancyToastIfNeeded(productForToast, finalValue);
                 if(isMountedRef.current) {
                    requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            toast({ title: "Cantidad Modificada" });
                        }
                    });
                 }
             }
         }
     }
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
}, [toast, countingList, catalogProducts, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition, currentUserId, currentWarehouseId]);


  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, 1); // Call modifyProductValue with a change of +1
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1); // Call modifyProductValue with a change of -1
  }, [modifyProductValue]);


 const handleConfirmQuantityChange = useCallback(() => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null || !currentUserId) {
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         requestAnimationFrame(() => { // Ensure focus is returned
             if (isMountedRef.current) {
                 focusBarcodeIfCounting();
             }
         });
         return;
     }

     const warehouseId = currentWarehouseId; // Ensure we use the current warehouse ID
     const barcodeToUpdate = confirmQuantityProductBarcode;
     const newValue = confirmQuantityNewValue;
     let confirmedValue: number | null = null; // To store the actual value set
     
     startTransition(() => {
        setCountingList(prevList => {
            const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
            if (index === -1) return prevList; // Product not found (should not happen)

            const listCopy = [...prevList];
            const productToUpdateCopy = { ...listCopy[index] };
            const finalConfirmedCount = Math.max(0, newValue); // Ensure count is not negative
            confirmedValue = finalConfirmedCount; // Store the value that will be set

            const productAfterConfirm = {
                ...productToUpdateCopy,
                count: finalConfirmedCount,
                lastUpdated: new Date().toISOString()
            };
            // Move updated product to the top
            listCopy[index] = productAfterConfirm;
            return [productAfterConfirm, ...listCopy.filter((item, i) => i !== index)];
        });
     });

    // Show toast and check for discrepancy after state update
    requestAnimationFrame(() => {
        if (confirmedValue !== null && isMountedRef.current) { // Ensure confirmedValue was set
            const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
            if (productInList) {
                const tempProductForToast = {...productInList, count: confirmedValue}; // Use the confirmed value for toast
                showDiscrepancyToastIfNeeded(tempProductForToast, confirmedValue); // Check for discrepancy again
                // Only show "Cantidad Modificada" if no discrepancy toast was shown OR if in Counter section
                if (!showDiscrepancyToastIfNeeded(tempProductForToast, confirmedValue) || activeSection === 'Contador') {
                     requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            toast({ title: "Cantidad Modificada" });
                        }
                     });
                }
            } else { // Fallback if product not found in list (should not happen)
                 requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        toast({ title: "Cantidad Modificada" });
                    }
                 });
            }
        }
    });

    if(isMountedRef.current){
     // Reset confirmation dialog state
     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
     setOpenModifyDialog(null); // Also close the modify value dialog
    }
    requestAnimationFrame(() => { // Ensure focus is returned
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition, currentUserId, activeSection]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         if(isMountedRef.current) setProductToDelete(product); // Set the product to be deleted
         if(isMountedRef.current) setIsDeleteDialogOpen(true); // Open deletion confirmation dialog
  }, []);

 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete || !currentUserId) return; // Guard clause

     const descriptionForToast = productToDelete.description;
     const barcodeForToast = productToDelete.barcode;
     const warehouseId = productToDelete.warehouseId; // Ensure we have warehouse context

     // Remove product from counting list using functional update with startTransition
     if(isMountedRef.current) {
        startTransition(() => {
            setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));
        });
     }

     // Show toast notification
     requestAnimationFrame(() => {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({
                        title: "Producto eliminado",
                        description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó de la lista actual.`, // Simpler message
                        variant: "default"
                    });
                }
            });
          }
      });
    // Reset dialog state
    if(isMountedRef.current){
     setIsDeleteDialogOpen(false);
     setProductToDelete(null);
    }
    requestAnimationFrame(() => { // Ensure focus is returned
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [productToDelete, toast, focusBarcodeIfCounting, startTransition, currentUserId]);

 const handleClearCurrentList = useCallback(() => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return; // Guard clause
     
     // Filter out items for the current warehouse from the counting list
     startTransition(() => {
         setCountingList(prevList => prevList.filter(p => p.warehouseId !== currentWarehouseId));
     });
     
     // Remove the list from localStorage for the current warehouse and user
     const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
     if (typeof window !== 'undefined') { // Ensure localStorage is available
        localStorage.removeItem(savedListKey);
     }

     // Show toast notification
     requestAnimationFrame(() => {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ title: "Lista Actual Borrada" });
                }
            });
          }
     });
     if(isMountedRef.current) setIsDeleteListDialogOpen(false); // Close dialog
     requestAnimationFrame(() => { // Ensure focus is returned
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, startTransition, currentUserId]);

 const handleExport = useCallback(() => {
     // Filter counting list for the current warehouse
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
        const dataToExport = currentWarehouseList.map(p => ({
            CodigoBarras: p.barcode,
            Descripcion: p.description,
            Proveedor: p.provider || 'N/A',
            Almacen: getWarehouseName(p.warehouseId), // Use helper to get warehouse name
            StockSistema: p.stock ?? 0,
            CantidadContada: p.count ?? 0,
            UltimaActualizacion: p.lastUpdated ? format(new Date(p.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
            FechaVencimiento: p.expirationDate && isValid(parseISO(p.expirationDate)) ? format(parseISO(p.expirationDate), 'yyyy-MM-dd') : 'N/A',
        }));

        if (typeof Papa === 'undefined') {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error de Exportación", description: "La librería PapaParse no está cargada." });
                }
            });
            return;
        }

        const csv = Papa.unparse(dataToExport, { header: true });
        const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" }); // Ensure UTF-8 for Excel compatibility
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);

        // Generate filename
        let fileName = '';
        // Get unique providers from the list (excluding "Desconocido" or "N/A")
        const providersInList = new Set(currentWarehouseList.map(p => p.provider).filter(p => p && p !== "Desconocido" && p !== "N/A"));
        const providerNameForFile = providersInList.size === 1 ? Array.from(providersInList)[0] : null;
        const timestamp = format(new Date(), 'yyyyMMdd', { locale: es });

        if (providerNameForFile) {
             const sanitizedProvider = providerNameForFile.replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize provider name
             fileName = `conteo_${sanitizedProvider}_${timestamp}.csv`;
        } else {
             const warehouseName = getWarehouseName(currentWarehouseId).replace(/[^a-zA-Z0-9]/g, '_'); // Sanitize warehouse name
             fileName = `conteo_${warehouseName}_${timestamp}.csv`;
        }

        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href); // Clean up blob URL
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
    requestAnimationFrame(() => { // Ensure focus is returned
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [countingList, currentWarehouseId, toast, getWarehouseName, focusBarcodeIfCounting]);

 // Removed handleSaveToHistory as the functionality was removed


 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current || !currentUserId) return; // Guard clause
     if(isMountedRef.current) setIsRefreshingStock(true); // Set loading state
     let updatedProductCount = 0;
     let addedProductCount = 0;
     try {
        // Fetch all products from the local IndexedDB catalog
        const allLocalCatalogProducts = await getAllProductsFromIndexedDB();
        
        if (isMountedRef.current) {
            setCatalogProducts(allLocalCatalogProducts); // Update the main catalog state
        }

         // Update the counting list for the current warehouse
         if(isMountedRef.current) {
            startTransition(() => {
                setCountingList(prevCountingList => {
                    const currentWarehouseItems = prevCountingList.filter(item => item.warehouseId === currentWarehouseId);
                    const otherWarehouseItems = prevCountingList.filter(item => item.warehouseId !== currentWarehouseId);

                    updatedProductCount = 0; // Reset counters for this refresh
                    addedProductCount = 0;

                    // Map over existing items in the current warehouse's list
                    let updatedCurrentWarehouseList = currentWarehouseItems.map(countingProduct => {
                        const catalogProd = allLocalCatalogProducts.find(cp => cp.barcode === countingProduct.barcode);
                        if (catalogProd) {
                            // If product found in catalog, check if any details need updating
                            if (countingProduct.description !== catalogProd.description ||
                                countingProduct.provider !== catalogProd.provider ||
                                countingProduct.stock !== (catalogProd.stock ?? 0) ||
                                countingProduct.expirationDate !== (catalogProd.expirationDate || undefined)
                               ) // Check for changes
                            {
                                updatedProductCount++;
                                return {
                                    ...countingProduct,
                                    description: catalogProd.description,
                                    provider: catalogProd.provider,
                                    stock: catalogProd.stock ?? 0,
                                    expirationDate: catalogProd.expirationDate || undefined,
                                    lastUpdated: new Date().toISOString(), // Update timestamp
                                };
                            }
                        }
                        return countingProduct; // No changes needed
                    });

                     // Add products from catalog that are not yet in the current warehouse's counting list
                     allLocalCatalogProducts.forEach(catalogProd => {
                         if (!updatedCurrentWarehouseList.some(cp => cp.barcode === catalogProd.barcode)) {
                             addedProductCount++;
                             updatedCurrentWarehouseList.push({
                                 ...catalogProd, // Spread catalog details
                                 warehouseId: currentWarehouseId, // Set current warehouse context
                                 count: 0, // Default count to 0 for newly added
                                 lastUpdated: new Date().toISOString(),
                             });
                         }
                     });

                    // Sort the updated list, e.g., by lastUpdated
                    updatedCurrentWarehouseList.sort((a, b) => new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime());

                    // Combine with items from other warehouses
                    return [...updatedCurrentWarehouseList, ...otherWarehouseItems];
                });
            });
         }

          // Show success toast
          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI update before toast
                    if (isMountedRef.current) {
                        toast({ title: "Datos Actualizados", description: `${updatedProductCount} actualizado(s), ${addedProductCount} agregado(s) desde catálogo local.` });
                    }
                });
              }
          });

     } catch (error) {
         console.error(`Error refreshing stock for warehouse ${currentWarehouseId}:`, error);
          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI update before toast
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar datos.` });
                    }
                });
              }
          });
     } finally {
         if (isMountedRef.current) {
             setIsRefreshingStock(false); // Reset loading state
         }
        requestAnimationFrame(() => { // Ensure focus is returned
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
     }
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, startTransition, currentUserId]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
     if(isMountedRef.current) setOpenModifyDialog({ type, product }); // Open dialog with product and type
 }, []);

 const handleCloseModifyDialog = () => {
     if(isMountedRef.current) setOpenModifyDialog(null); // Close dialog
     requestAnimationFrame(() => { // Ensure focus is returned
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 };

 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct) => {
     if (!product || !product.barcode || !isMountedRef.current || !currentUserId) return; // Guard clause
     if(isMountedRef.current) setIsDbLoading(true); // Set loading state
     try {
         // Attempt to get product details from IndexedDB first
         let productDataToEdit = await getProductFromIndexedDB(product.barcode);
         let source = "Local (IndexedDB)";
         
         if (productDataToEdit) {
             // Product found in DB
             if (!isMountedRef.current) return;
             setProductToEditDetail(productDataToEdit);
             setInitialStockForEdit(productDataToEdit.stock ?? 0); // Set initial stock for edit dialog
             setIsEditDetailDialogOpen(true); // Open dialog
             if(isMountedRef.current) {
                 requestAnimationFrame(() => toast({ title: `Editando desde ${source}` }));
             }
         } else {
             // Product not in DB, use data from counting list (for temporary/unknown items)
             if (!isMountedRef.current) return;
             const placeholderDetail: ProductDetail = {
                 barcode: product.barcode,
                 description: product.description,
                 provider: product.provider,
                 stock: product.stock ?? 0,
                 expirationDate: product.expirationDate,
             };
             setProductToEditDetail(placeholderDetail);
             setInitialStockForEdit(product.stock ?? 0);
             setIsEditDetailDialogOpen(true);
             requestAnimationFrame(() => {
                if(isMountedRef.current) {
                    requestAnimationFrame(() => { // Ensure UI update before toast
                        if (isMountedRef.current) {
                            toast({ variant: "default", title: "Editando Producto Temporal" });
                        }
                    });
                }
             });
         }
     } catch (error) {
         if (!isMountedRef.current) return;
         console.error("Error fetching product details for edit:", error);
         requestAnimationFrame(() => {
            if(isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI update before toast
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudieron obtener datos." });
                    }
                });
            }
         });
     } finally {
         if (isMountedRef.current) {
            setIsDbLoading(false); // Reset loading state
         }
     }
 }, [toast, currentUserId]);

 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
     if (!isMountedRef.current || !productToEditDetail || !currentUserId) return; // Guard clause
     if(isMountedRef.current) setIsDbLoading(true); // Set loading state
     try {
         // Prepare updated product data
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, // Barcode is not editable here
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || null, // Ensure null if empty
         };
         await addOrUpdateProductToIndexedDB(updatedProductData); // Save to IndexedDB       
         
         // Update local catalog state
         setCatalogProducts(prev => {
            const existingIndex = prev.findIndex(p => p.barcode === updatedProductData.barcode);
            if (existingIndex !== -1) { // Product exists, update it
                const newCatalog = [...prev];
                newCatalog[existingIndex] = updatedProductData;
                return newCatalog;
            }
            return [...prev, updatedProductData]; // Product new, add it
         });
         
         if (!isMountedRef.current) return;

         // Update the counting list as well if the product is present there
         startTransition(() => {
            setCountingList(prevList => prevList.map(item =>
                item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId 
                    ? {
                        ...item,
                        description: updatedProductData.description,
                        provider: updatedProductData.provider,
                        stock: updatedProductData.stock, // Update stock in counting list too
                        expirationDate: updatedProductData.expirationDate,
                        lastUpdated: new Date().toISOString() // Update timestamp
                      }
                    : item
            ));
         });

         // Show success toast
         requestAnimationFrame(() => {
             if(isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI update before toast
                    if (isMountedRef.current) {
                        toast({ title: "Producto Actualizado en Catálogo Local" });
                    }
                });
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
                requestAnimationFrame(() => { // Ensure UI update before toast
                    toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
                });
            }
          });
     } finally {
         if (isMountedRef.current) {
             setIsDbLoading(false); // Reset loading state
         }
         requestAnimationFrame(() => { // Ensure focus is returned
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
     }
 }, [toast, currentWarehouseId, productToEditDetail, focusBarcodeIfCounting, startTransition, currentUserId]);

 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId) return; // Guard clause
    if (!productsToCount || productsToCount.length === 0) {
        requestAnimationFrame(() => {
           if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI update before toast
                if (isMountedRef.current) {
                    toast({ title: "Vacío", description: "No hay productos para este proveedor." });
                }
            });
           }
        });
        return;
    }
   // Map database products to display products for the counting list
   const productsWithWarehouseContext: DisplayProduct[] = productsToCount.map(dbProduct => ({
       ...dbProduct, // Spread details from catalog
       warehouseId: currentWarehouseId, // Set current warehouse context
       stock: dbProduct.stock ?? 0, // Ensure stock has a default
       count: 0, // Reset count to 0 for a new count session
       lastUpdated: new Date().toISOString(),
       expirationDate: dbProduct.expirationDate || undefined, // Carry over expiration date
   }));

   if(isMountedRef.current) {
     // Replace current warehouse's counting list with products from the selected provider
     startTransition(() => {
        setCountingList(prevList => {
            const otherWarehouseItems = prevList.filter(item => item.warehouseId !== currentWarehouseId);
            let itemsForCurrentWarehouse = [...productsWithWarehouseContext];

            // Sort the new list (e.g., by description or barcode)
            // itemsForCurrentWarehouse.sort((a, b) => a.description.localeCompare(b.description));

            const newList = [...itemsForCurrentWarehouse, ...otherWarehouseItems];
              // Optional: sort the entire list if needed, e.g., by warehouse then by product
              newList.sort((a, b) => {
                    if (a.warehouseId === currentWarehouseId && b.warehouseId !== currentWarehouseId) return -1;
                    if (a.warehouseId !== currentWarehouseId && b.warehouseId === currentWarehouseId) return 1;
                    if (a.warehouseId === currentWarehouseId && b.warehouseId === currentWarehouseId) {
                        return new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime(); // Or by description/barcode
                    }
                    return 0; // Keep original order for other warehouses or implement further sorting
                });
            return newList;
        });
     });
     setActiveSection("Contador"); // Switch to counter section
     }
     // Show success toast
     requestAnimationFrame(() => {
        if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI update before toast
                if (isMountedRef.current) {
                    toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` });
                }
            });
        }
     });
    requestAnimationFrame(() => { // Ensure focus is returned
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
}, [toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, startTransition, currentUserId]);


  // Memoized filtered list for display in Counter section
  const filteredCountingList = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    // Filter only products belonging to the current warehouse
    const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
    if (!lowerSearchTerm) return currentWarehouseList; // Return all if no search term
    // Apply search filter
    return currentWarehouseList.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) || // Search by barcode
      (product.provider || '').toLowerCase().includes(lowerSearchTerm) || // Search by provider
      (product.expirationDate || '').includes(lowerSearchTerm) // Search by expiration date (basic string match)
    );
  }, [countingList, searchTerm, currentWarehouseId]);

  const handleSectionChange = useCallback((newSection: string) => {
    if(isMountedRef.current) setActiveSection(newSection);
    if (newSection === 'Contador') {
        requestAnimationFrame(() => { // Ensure focus is returned if switching to counter
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
    }
  }, [setActiveSection, focusBarcodeIfCounting]);

   // Handles warehouse change from sidebar or warehouse management
   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             startTransition(() => {
                setIsDbLoading(true); // Set loading while new warehouse data is potentially loaded
                setCurrentWarehouseId(newWarehouseId); // Update current warehouse ID
                setSearchTerm(""); // Clear search term for the new warehouse
             });
             // Save new warehouse ID to localStorage for the current user
             if (currentUserId) {
                 setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newWarehouseId);
             }
         }
   }, [currentWarehouseId, startTransition, currentUserId]); // Dependencies

    // Handles adding a new warehouse
    const handleAddWarehouse = useCallback(async (name: string) => {
        if (!isMountedRef.current || !currentUserId || !name.trim() || !db ) return; // Guard clause
        
        // Generate a unique ID for the new warehouse
        const generatedId = `wh_${format(new Date(), 'yyyyMMdd_HHmmssSSS')}`;
        const newWarehouse: Warehouse = { id: generatedId, name: name.trim() };

        // Check for duplicate names (case-insensitive)
        const isDuplicateName = warehouses.some(warehouse => warehouse.name.toLowerCase() === newWarehouse.name.toLowerCase());
        if (isDuplicateName) {
            requestAnimationFrame(() => { // Show toast on next frame
                toast({ variant: 'destructive', title: 'Error', description: 'Nombre de almacén ya existe.' });
            });
            return;
        }
        try {
            // Add to Firestore (listener will update local state)
            await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
             requestAnimationFrame(() => { // Show toast on next frame
                 toast({title: "Almacén Agregado", description: `Cambiado a: ${newWarehouse.name}`});
             });
             handleWarehouseChange(newWarehouse.id); // Switch to the new warehouse
        } catch (error) {
            // Firestore error already handled by toast in firestore-service
            // requestAnimationFrame(() => { 
            //     toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo agregar almacén.' });
            // });
        }
   }, [warehouses, currentUserId, handleWarehouseChange, toast]); // Dependencies

   // Handles updating an existing warehouse name
   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) return; // Guard clause
       try {
           // Update in Firestore (listener will update local state)
           await addOrUpdateWarehouseInFirestore(currentUserId, warehouseToUpdate);
           // Toast handled by firestore-service or parent if needed
           requestAnimationFrame(() => toast({ title: `Almacén "${warehouseToUpdate.name}" Actualizado` }));
       } catch (error) {
           // Firestore error already handled by toast in firestore-service
           // requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo actualizar el almacén en la nube.' }));
       }
   }, [toast, currentUserId]); // Dependencies

   // Handles deleting a warehouse
   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
       if (!isMountedRef.current || !currentUserId || !db || warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
            if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
                requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Operación no permitida', description: "Almacén Principal no se puede eliminar." }));
            }
           return;
       }
       try {
           // Delete from Firestore (listener will update local state and handle currentWarehouseId change)
           await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
           // Toast handled by firestore-service or parent if needed
           // requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
       } catch (error) {
           // Firestore error already handled by toast in firestore-service
           // requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo eliminar el almacén de la nube.' }));
       }
   }, [toast, currentUserId]); // Dependencies


   // Gets the current value for the modify dialog (count or stock)
   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0; // Default to 0 if no product or not mounted
        // Find the current item in the counting list to get its latest value
        const currentItem = countingList.find(
          p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId
        );
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]); // Dependencies

   // Handles clearing the master product catalog from IndexedDB
   const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current || !currentUserId) return; // Guard clause
    if(isMountedRef.current) setIsDbLoading(true); // Set loading state
    try {
      await clearProductDatabaseInIndexedDB(); // Clear IndexedDB catalog

      if(isMountedRef.current) {
        setCatalogProducts([]); // Clear local catalog state
        // Optionally, update counting list items if their details came from catalog
        startTransition(() => { 
            setCountingList(prevList => 
                prevList.map(p => {
                    // Reset details that might have come from catalog
                    return {...p, description: `Producto ${p.barcode}`, provider: "Desconocido", stock: 0, expirationDate: undefined};
                })
            );
        });
      }
      // Show success toast
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI update before toast
                if (isMountedRef.current) {
                    toast({ title: "Catálogo Local Borrado" });
                }
            });
          }
      });
    } catch (error: any) {
      // Show error toast
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI update before toast
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error al Borrar Catálogo Local", description: `No se pudieron borrar datos: ${error.message}` });
                }
            });
          }
      });
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false); // Reset loading state
        setIsClearCatalogConfirmOpen(false); // Close confirmation dialog
      }
      requestAnimationFrame(() => { // Ensure focus is returned
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
     });
    }
  }, [toast, currentUserId, focusBarcodeIfCounting, startTransition]); // Dependencies


  // Memoized list of sections for the sidebar
  const sectionItems = useMemo(() => [
    { name: 'Contador', icon: ClipboardList, label: `Contador (${getWarehouseName(currentWarehouseId)})`},
    { name: 'Catálogo de Productos', icon: PackageSearch, label: 'Catálogo de Productos' },
    { name: 'Almacenes', icon: Boxes, label: 'Almacenes' },
    { name: 'Consolidado', icon: Library, label: 'Consolidado de Inventario' }, 
    // History and Expiration sections were removed as per prior requests
  ], [getWarehouseName, currentWarehouseId]); // Dependencies

  // Handles user sign out
  const handleSignOut = () => {
    if(isMountedRef.current) {
        setIsAuthenticated(false);
        setCurrentUserId(null);
        setCountingList([]); // Clear counting list
        setCatalogProducts([]); // Clear catalog
        setWarehouses(PREDEFINED_WAREHOUSES_LIST); // Reset warehouses to predefined
        setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID); // Reset to default warehouse
        // Remove user ID from localStorage
        if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
            // Optionally, clear all localStorage items prefixed for this app if a full reset is desired
        }
        isInitialFetchDoneForUser.current = {}; // Reset initial fetch flags
        requestAnimationFrame(() => toast({title: "Sesión cerrada"}));
    }
  };


  // Props for SidebarLayout component
  const sidebarProps = {
    isMobileView: isMobile,
    isCollapsed: isSidebarCollapsed,
    activeSection,
    sectionItems,
    currentUserId: currentUserId || "", // Pass empty string if null
    warehouses,
    currentWarehouseId,
    handleWarehouseChange,
    getWarehouseName,
    onSectionChange: (section: string) => {
      handleSectionChange(section);
      if (isMobile) setMobileSheetOpen(false); // Close mobile sheet on section change
    },
    onToggleCollapse: () => setIsSidebarCollapsed(!isSidebarCollapsed), 
    onSignOut: handleSignOut, 
  };

  // Props for CounterSection component
  const counterSectionProps = {
    filteredCountingList,
    warehouseName: getWarehouseName(currentWarehouseId),
    onDeleteRequest: handleDeleteRequest,
    onOpenStockDialog: (product: DisplayProduct) => handleOpenModifyDialog(product, 'stock'),
    onOpenQuantityDialog: (product: DisplayProduct) => handleOpenModifyDialog(product, 'count'),
    onDecrement: handleDecrement,
    onIncrement: handleIncrement,
    onEditDetailRequest: handleOpenEditDetailDialog,
    countingList, // Pass full countingList for export/clear logic
    currentWarehouseId,
    // onSaveToHistory: handleSaveToHistory, // Removed, history saving is removed
    onExport: handleExport,
    onSetIsDeleteListDialogOpen: setIsDeleteListDialogOpen,
    isMobile,
    toast,
    isDbLoading: isDbLoading, // Pass combined loading state
    isTransitionPending: isTransitionPending,
  };

  // Handles user login
  const handleLogin = () => {
    // Simple fixed credentials check
    if (loginUsername === LOGIN_USER && loginPassword === LOGIN_PASSWORD) {
        if (isMountedRef.current) {
            setCurrentUserId(LOGIN_USER); // Set current user
            setIsAuthenticated(true); // Set authenticated state
            setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, LOGIN_USER); // Save user ID
            // Load or set default warehouse for this user
            const storedWarehouseId = getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${LOGIN_USER}`, DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(storedWarehouseId);
            isInitialFetchDoneForUser.current[LOGIN_USER] = false; // Reset initial fetch flag for warehouses

            requestAnimationFrame(() => {
                toast({ title: "Inicio de sesión exitoso" });
            });
            // Clear login form fields
            setLoginUsername("");
            setLoginPassword("");
        }
    } else {
        // Failed login
        if (isMountedRef.current) {
             requestAnimationFrame(() => {
                toast({ variant: "destructive", title: "Error de inicio de sesión" });
            });
        }
        setLoginPassword(""); // Clear password field
    }
  };

  // Render login form if not authenticated
  if (!isAuthenticated) {
    return (
        <div className="login-container">
            <div className="login-form bg-card p-8 rounded-lg shadow-xl w-full max-w-sm">
                <div className="flex flex-col items-center mb-6">
                    <LockKeyhole className="h-12 w-12 text-primary mb-3" />
                    <h2 className="text-2xl font-semibold text-center text-foreground">Iniciar Sesión</h2>
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
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} // Allow login on Enter key
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
      {/* Mobile Header & Sheet Trigger for Sidebar */}
      <div className="md:hidden p-4 border-b flex items-center justify-between bg-card sticky top-0 z-20">
        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Abrir menú">
              <MenuIcon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[280px] sm:w-[320px] bg-card flex flex-col">
            <SheetHeader className="sr-only"> {/* Hidden visually, for screen readers */}
              <SheetTitle>Menú Principal</SheetTitle>
            </SheetHeader>
            <SidebarLayout
              {...sidebarProps} // Pass sidebar props
            />
          </SheetContent>
        </Sheet>
        <h2 className="text-xl font-bold truncate ml-4">StockCounter Pro</h2>
        <div className="w-8"></div> {/* Spacer */}
      </div>

      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-shrink-0 border-r bg-card flex-col transition-all duration-300 ease-in-out",
        isSidebarCollapsed ? "w-20" : "w-60" // Collapsed or expanded width
      )}>
        <SidebarLayout
          {...sidebarProps} // Pass sidebar props
        />
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 overflow-y-auto">
        {/* Conditional Rendering of Sections */}
        {activeSection === 'Contador' && currentUserId && (
          <div id="contador-content" className="space-y-4 h-full flex flex-col">
            {/* Barcode Entry and Search */}
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

            <CounterSection {...counterSectionProps} />
          </div>
        )}

         {activeSection === 'Catálogo de Productos' && currentUserId && (
            <div id="database-content">
               <ProductDatabase
                  userId={currentUserId}
                  onStartCountByProvider={handleStartCountByProvider}
                  isTransitionPending={isTransitionPending || isDbLoading}
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

      {/* Dialogs */}
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
          isProcessing={isTransitionPending}
      />

      <ConfirmationDialog
          isOpen={isConfirmQuantityDialogOpen}
          onOpenChange={(open) => {
            setIsConfirmQuantityDialogOpen(open);
            if (!open) { // Reset state if dialog is closed without confirmation
                setConfirmQuantityProductBarcode(null);
                setConfirmQuantityAction(null);
                setConfirmQuantityNewValue(null);
                requestAnimationFrame(() => { // Ensure focus is returned
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
            }
          }}
          title="Confirmar Modificación"
          description={ // Dynamically generate description
             (() => {
               if (confirmQuantityNewValue === null || !confirmQuantityProductBarcode) return "¿Continuar con la modificación?";
               const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
               const stock = product?.stock ?? 0;
               const description = product?.description ?? confirmQuantityProductBarcode;

               // Logic for specific messages based on scenario (exceeds stock, etc.)
               if (stock > 0 && confirmQuantityNewValue > stock) {
                   return `La cantidad contada (${confirmQuantityNewValue}) ahora SUPERA el stock del sistema (${stock}) para "${description}". ¿Confirmar?`;
               }
               // Default confirmation message
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
              requestAnimationFrame(() => { // Ensure focus is returned
                if (isMountedRef.current) {
                    focusBarcodeIfCounting();
                }
            });
          }}
          isProcessing={isTransitionPending}
      />

      <ConfirmationDialog
         isOpen={isDeleteDialogOpen}
         onOpenChange={(open) => {
            setIsDeleteDialogOpen(open);
            if (!open) { // Reset state if dialog is closed without confirmation
                setProductToDelete(null);
                requestAnimationFrame(() => { // Ensure focus is returned
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
            }
         }}
         title="Confirmar Eliminación (Lista Actual)"
         description={ productToDelete ? `¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) del inventario actual (${getWarehouseName(productToDelete?.warehouseId)})? Esta acción no se puede deshacer.` : `¿Seguro que deseas eliminar este producto?`}
         onConfirm={confirmDelete}
         onCancel={() => {
            if(isMountedRef.current) setIsDeleteDialogOpen(false);
            requestAnimationFrame(() => { // Ensure focus is returned
                if (isMountedRef.current) {
                    focusBarcodeIfCounting();
                }
            });
         }}
         isDestructive={true} // Indicate destructive action
         isProcessing={isTransitionPending}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteListDialogOpen(open);
            if (!open) { // Ensure focus is returned
                requestAnimationFrame(() => { 
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
            }
          }}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})? Esta acción no se puede deshacer.`}
          onConfirm={handleClearCurrentList}
          onCancel={() => {
            if(isMountedRef.current) setIsDeleteListDialogOpen(false);
            requestAnimationFrame(() => { // Ensure focus is returned
                if (isMountedRef.current) {
                    focusBarcodeIfCounting();
                }
            });
          }}
          isDestructive={true} // Indicate destructive action
          isProcessing={isTransitionPending}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => {
                setIsClearCatalogConfirmOpen(open);
                if (!open) { // Ensure focus is returned
                    requestAnimationFrame(() => { 
                        if (isMountedRef.current) {
                            focusBarcodeIfCounting();
                        }
                    });
                }
            }}
            title="Confirmar Borrado Catálogos"
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
                requestAnimationFrame(() => { // Ensure focus is returned
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
            }}
            isDestructive={true} // Indicate destructive action
            isProcessing={isDbLoading || isTransitionPending} // Disable while processing
        />

      {/* Edit Product Detail Dialog (for catalog items) */}
      {productToEditDetail && currentUserId && (
        <EditProductDialog
          isOpen={isEditDetailDialogOpen}
          setIsOpen={(open) => {
              setIsEditDetailDialogOpen(open);
              if (!open) { // Reset state if dialog is closed
                  setProductToEditDetail(null);
                  requestAnimationFrame(() => { // Ensure focus is returned
                      if (isMountedRef.current) {
                          focusBarcodeIfCounting();
                      }
                  });
              }
          }}
          selectedDetail={productToEditDetail}
          setSelectedDetail={setProductToEditDetail}
          onSubmit={handleEditDetailSubmit}
          onDelete={ async (barcode) => { // Handle delete from catalog
                if (!isMountedRef.current || !currentUserId) return; // Guard clause
                if(isMountedRef.current) setIsDbLoading(true); // Set loading state
                try {
                    await deleteProductFromIndexedDB(barcode); // Delete from IndexedDB

                    if (!isMountedRef.current) return;
                    // Update local catalog state
                    setCatalogProducts(prev => prev.filter(p => p.barcode !== barcode));
                    // Remove from counting list if present in current warehouse
                    startTransition(() => {
                        setCountingList(prevList => prevList.filter(p => !(p.barcode === barcode && p.warehouseId === currentWarehouseId)));
                    });
                      // Show success toast
                      requestAnimationFrame(() => {
                        if(isMountedRef.current) {
                          requestAnimationFrame(() => { // Ensure UI update before toast
                              if (isMountedRef.current) {
                                  toast({title: "Producto eliminado del catálogo local"});
                              }
                          });
                        }
                      });
                    // Close dialog and reset state
                    if(isMountedRef.current) {
                      setIsEditDetailDialogOpen(false);
                      setProductToEditDetail(null);
                    }
                } catch (error: any) {
                      // Show error toast
                      if (!isMountedRef.current) return;
                      requestAnimationFrame(() => {
                          if(isMountedRef.current) {
                              requestAnimationFrame(() => { // Ensure UI update before toast
                                  if (isMountedRef.current) {
                                      toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
                                  }
                              });
                          }
                      });
                } finally {
                      if (isMountedRef.current) {
                          setIsDbLoading(false); // Reset loading state
                      }
                      requestAnimationFrame(() => { // Ensure focus is returned
                          if (isMountedRef.current) {
                              focusBarcodeIfCounting();
                          }
                      });
                }
            }}
          isProcessing={isDbLoading || isTransitionPending} // Disable while processing
          initialStock={initialStockForEdit} // Pass initial stock for context
          context="countingList" // Indicate context for dialog labels/behavior
          warehouseName={getWarehouseName(currentWarehouseId)} // Pass current warehouse name
        />
      )}
    </div>
  );
}
    

    

