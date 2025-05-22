
// src/app/page.tsx
"use client";

import type { DisplayProduct, ProductDetail, CountingHistoryEntry, Warehouse } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem, debounce } from "@/lib/utils";
import {
    AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle as UIDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label"; 
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
import { Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock, BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide, LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert, Filter, PanelLeftClose, PanelRightOpen, Save, Library } from "lucide-react"; // Added Library icon
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
  saveCountingHistory, 
  getCountingHistory,  
  clearCountingHistory 
} from '@/lib/database'; // Using IndexedDB for product catalog and local history
import {
  subscribeToWarehouses, // Still using Firestore for warehouses for multi-device sync if login is shared
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  getProductFromCatalog, // Using Firestore for master product catalog
  getAllProductsFromCatalog,
  addOrUpdateProductInCatalog,
  deleteProductFromCatalog,
  clearProductCatalogInFirestore,
  addProductsToCatalog, 
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
  
  // State for master product catalog (from Firestore)
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
  const [isSavingToHistory, setIsSavingToHistory] = useState(false);
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
        }, 100);
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
        setCurrentWarehouseId(storedWarehouseId); // This might be updated by Firestore listener shortly
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
    if (!currentUserId || !db) { // db check ensures Firestore is initialized
        if (isMountedRef.current) {
            // Fallback to predefined list if no user or DB not ready
            setWarehouses(PREDEFINED_WAREHOUSES_LIST);
            const storedWarehouseId = currentUserId ? getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID) : DEFAULT_WAREHOUSE_ID;
            const currentSelectionIsValid = PREDEFINED_WAREHOUSES_LIST.some(w => w.id === storedWarehouseId);
            setCurrentWarehouseId(currentSelectionIsValid ? storedWarehouseId : DEFAULT_WAREHOUSE_ID);
            setIsDbLoading(false); // No longer loading from Firestore in this path
        }
        return;
    }

    setIsDbLoading(true); // Indicate loading from Firestore
    
    const unsubscribe = subscribeToWarehouses(currentUserId, async (fetchedWarehouses) => {
      if (isMountedRef.current) {
        let finalWarehousesToSet = [...fetchedWarehouses];
        
        // Ensure predefined warehouses exist for the user in Firestore (only on initial fetch for this user session)
        if (!isInitialFetchDoneForUser.current[currentUserId] && db) { 
            isInitialFetchDoneForUser.current[currentUserId] = true; // Mark as done for this session
            
            const warehousesToAddBatch: Warehouse[] = [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predefined => {
                if (!fetchedWarehouses.some(fw => fw.id === predefined.id)) {
                    warehousesToAddBatch.push(predefined);
                }
            });

            if (warehousesToAddBatch.length > 0 && currentUserId) {
                try {
                    const batch = writeBatch(db); // db should be defined here due to earlier check
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = doc(collection(db, `users/${currentUserId}/warehouses`), wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                    // Firestore listener will pick up these changes and update `finalWarehousesToSet`
                    // No need to manually merge here, let onSnapshot be the source of truth
                } catch (err) {
                    console.error(`Failed to add predefined warehouses to Firestore for user ${currentUserId}:`, err);
                    requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                    // If batch fails, merge locally for immediate UI update, but Firestore is the source of truth
                    finalWarehousesToSet = [...fetchedWarehouses, ...warehousesToAddBatch].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);

                }
            }
            // If Firestore was empty and batch failed or wasn't needed, ensure UI has something
            if (finalWarehousesToSet.length === 0 && warehousesToAddBatch.length === 0) {
                 finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST];
            }
        }
        
        // Use fetchedWarehouses from onSnapshot as it's the source of truth from Firestore
        setWarehouses(fetchedWarehouses.length > 0 ? fetchedWarehouses : PREDEFINED_WAREHOUSES_LIST);

        const storedWarehouseId = getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, DEFAULT_WAREHOUSE_ID);
        const effectiveWarehouseList = fetchedWarehouses.length > 0 ? fetchedWarehouses : PREDEFINED_WAREHOUSES_LIST;
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
  }, [currentUserId, toast]); // Removed currentWarehouseId from dependencies


  // Load master product catalog from Firestore
  useEffect(() => {
    if (!currentUserId || !db) { // db check ensures Firestore is initialized
      if (isMountedRef.current) {
        setCatalogProducts([]); // Clear if no user or DB
        // Optionally, load from IndexedDB as a fallback if needed for offline catalog
        // getAllProductsFromIndexedDB().then(localProducts => setCatalogProducts(localProducts));
      }
      return;
    }
    setIsDbLoading(true);
    getAllProductsFromCatalog(currentUserId) 
      .then(products => {
        if (isMountedRef.current) {
          setCatalogProducts(products);
        }
      })
      .catch(error => {
        console.error("Error loading catalog from Firestore:", error);
        if (isMountedRef.current) {
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudo cargar el catálogo." }));
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsDbLoading(false);
        }
      });
  }, [currentUserId, toast]); // Re-fetch if userId changes


 // Load counting list from localStorage when warehouse or user changes
 useEffect(() => {
    if (!isMountedRef.current || !currentUserId || !currentWarehouseId) {
        if(isMountedRef.current) setIsDbLoading(false); 
        if(isMountedRef.current) setCountingList([]); 
        return;
    }

    if(isMountedRef.current) setIsDbLoading(true);
    const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
    let savedList: DisplayProduct[] = getLocalStorageItem<DisplayProduct[]>(savedListKey, []);

    if (Array.isArray(savedList) && savedList.every(item => typeof item?.barcode === 'string')) {
        const loadedList = savedList
            .map(item => ({
                ...item,
                stock: item.stock ?? 0, // Ensure stock has a default
                count: item.count ?? 0, // Ensure count has a default
                lastUpdated: item.lastUpdated || new Date().toISOString(),
                warehouseId: item.warehouseId || currentWarehouseId, // Ensure warehouseId context
                expirationDate: item.expirationDate || undefined,
            }));
        // Ensure we only set items for the *current* warehouse to avoid stale data from other warehouses
        if(isMountedRef.current) setCountingList(loadedList.filter(item => item.warehouseId === currentWarehouseId));
    } else {
        if (Array.isArray(savedList) && savedList.length > 0 && !savedList.every(item => typeof item?.barcode === 'string')) {
           // This indicates corrupted data in localStorage.
           console.warn(`Invalid data structure in localStorage for ${savedListKey}. Clearing.`);
        }
        // Clear localStorage for this key if data is invalid or not an array
        if(typeof window !== 'undefined') localStorage.removeItem(savedListKey);
        if(isMountedRef.current) setCountingList([]); // Reset to empty list
    }
    if(isMountedRef.current) setIsDbLoading(false);
 }, [currentWarehouseId, currentUserId]); // Rerun when warehouseId or userId changes

 // Debounced function to save counting list to localStorage
 const debouncedSaveCountingList = useMemo(
    () =>
      debounce((list: DisplayProduct[], warehouseId: string, userId: string) => {
        if (!warehouseId || !isMountedRef.current || !userId) return;
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}_${userId}`;
        // Filter the list to save only items belonging to the current warehouse
        const listToSave = list.filter(item => item.warehouseId === warehouseId);
        setLocalStorageItem(key, listToSave);
      }, 500), // 500ms debounce
    [] // No dependencies, debounce function itself is stable
  );

  // Effect to save counting list to localStorage
  useEffect(() => {
    // Only save if not loading, component is mounted, and we have a valid warehouse/user
    if (!isDbLoading && isMountedRef.current && currentWarehouseId && currentUserId) {
      debouncedSaveCountingList(countingList, currentWarehouseId, currentUserId);
    }
    // Cleanup function for the debounced saver
    return () => {
       debouncedSaveCountingList.clear?.(); // Assuming your debounce utility has a clear method
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
        // Only show toast if NOT in 'Contador' section to avoid focus interruption
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
        return true; // Indicate there is a discrepancy
    }
    return false;
  }, [toast, activeSection]); // Added activeSection dependency


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

    // Prevent re-processing the same barcode if scanned multiple times quickly
     if (trimmedBarcode === lastScannedBarcode) {
         requestAnimationFrame(() => { // Ensure UI updates are smooth
             if (isMountedRef.current) {
                 setBarcode("");
                 focusBarcodeIfCounting();
             }
         });
         return; // Exit early
     }
     if(isMountedRef.current) {
        if (lastScannedTimeoutRef.current) {
            clearTimeout(lastScannedTimeoutRef.current); // Clear any existing timeout
        }
        setLastScannedBarcode(trimmedBarcode); // Set the new last scanned barcode
        lastScannedTimeoutRef.current = setTimeout(() => { // Set a new timeout
            if (isMountedRef.current) setLastScannedBarcode(null); // Reset after timeout
        }, LAST_SCANNED_BARCODE_TIMEOUT_MS);
     }


    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
        // Product exists in the current counting list for this warehouse
        const productToUpdate = countingList[existingProductIndex];
        const newCount = (productToUpdate.count ?? 0) + 1;

        // Check if quantity confirmation is needed
        const productStock = productToUpdate.stock ?? 0;
        const originalCount = productToUpdate.count ?? 0;
        const needsConfirmation = newCount > productStock && originalCount <= productStock && productStock > 0;

        if (needsConfirmation) {
             if(isMountedRef.current) setConfirmQuantityProductBarcode(productToUpdate.barcode);
             if(isMountedRef.current) setConfirmQuantityAction('increment');
             if(isMountedRef.current) setConfirmQuantityNewValue(newCount);
             if(isMountedRef.current) setIsConfirmQuantityDialogOpen(true);
             playBeep(660, 100); // Confirmation beep
        } else {
            // Update product directly
            const updatedProductData: DisplayProduct = {
                ...productToUpdate,
                count: newCount,
                lastUpdated: new Date().toISOString(),
            };
             if(isMountedRef.current) {
                startTransition(() => {
                    setCountingList(currentList => {
                        // Ensure the updated product is at the top
                        const listWithoutOld = currentList.filter(item => !(item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId));
                        return [updatedProductData, ...listWithoutOld];
                    });
                });
             }
            playBeep(880, 100); // Success beep
            showDiscrepancyToastIfNeeded(updatedProductData, newCount);
        }
    } else {
        // Product is new to the counting list for this warehouse
        let newProductForList: DisplayProduct | null = null;
        try {
            // Try to find product details in the Firestore catalog first
            let catalogProd = catalogProducts.find(p => p.barcode === trimmedBarcode);
            if (!catalogProd && currentUserId) { // Check Firestore catalog if not in local state
                 catalogProd = await getProductFromCatalog(currentUserId, trimmedBarcode);
                 if (catalogProd && isMountedRef.current) { // If found in Firestore, update local catalog state
                     setCatalogProducts(prev => {
                         const existing = prev.find(p => p.barcode === catalogProd!.barcode);
                         if (existing) return prev.map(p => p.barcode === catalogProd!.barcode ? catalogProd! : p);
                         return [...prev, catalogProd!];
                     });
                 }
            }


            if (catalogProd) {
                // Product found in Firestore catalog
                newProductForList = {
                    ...catalogProd, // Spread details from catalog
                    warehouseId: currentWarehouseId,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(660, 150); // Found in DB beep
                showDiscrepancyToastIfNeeded(newProductForList); // Check for discrepancy

            } else {
                // Product not in Firestore catalog, try local IndexedDB catalog
                const localCatalogProduct = await getProductFromIndexedDB(trimmedBarcode);
                if (localCatalogProduct) {
                    newProductForList = {
                        ...localCatalogProduct,
                        warehouseId: currentWarehouseId,
                        count: 1,
                        lastUpdated: new Date().toISOString(),
                    };
                    playBeep(660, 150); // Found in local DB beep
                    showDiscrepancyToastIfNeeded(newProductForList);
                    if (isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({ variant: "default", title: "Producto Local", description: "Producto encontrado en catálogo local (IndexedDB)." });
                            }
                        });
                    }
                } else {
                    // Product is unknown
                    const descriptionForToast = `Producto desconocido ${trimmedBarcode}`;
                    newProductForList = {
                        barcode: trimmedBarcode,
                        description: descriptionForToast,
                        provider: "Desconocido",
                        warehouseId: currentWarehouseId,
                        stock: 0, // Default stock for unknown products
                        count: 1,
                        lastUpdated: new Date().toISOString(),
                        expirationDate: undefined,
                    };
                    playBeep(440, 300); // Unknown product beep
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
            }
             // Add the new product to the counting list
             if (isMountedRef.current && newProductForList) {
                 const finalProduct = newProductForList; // To satisfy TS inside startTransition
                 startTransition(() => {
                    setCountingList(currentList => [finalProduct, ...currentList.filter(item => !(item.barcode === finalProduct.barcode && item.warehouseId === currentWarehouseId))]);
                 });
             }
        } catch (error) {
            console.error("Error fetching or adding product from catalog (Firestore/IndexedDB):", error);
            if(isMountedRef.current) {
                requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error de Catálogo" });
                    }
                });
            }
            playBeep(440, 300); // Error beep
        }
    }
    // Clear barcode input and refocus
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            setBarcode("");
            focusBarcodeIfCounting();
        }
    });
  }, [barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, catalogProducts, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition]);


// Modify product value (count or stock)
const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId) return;

    let finalValue: number | undefined;
    let needsConfirmation = false;
    let productForToast: DisplayProduct | null = null;

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);

    if (productIndexInList === -1) {
         // Product not found in current list (should not happen if called from UI)
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


    // Check for confirmation if count exceeds stock
    if (type === 'count') {
      // Confirmation needed if new count > stock, original count <= stock, and stock > 0
      needsConfirmation = finalValue > (productInList.stock ?? 0) && originalValue <= (productInList.stock ?? 0) && (productInList.stock ?? 0) > 0;
    }

    if (needsConfirmation) {
        // Open confirmation dialog
        if(isMountedRef.current) setConfirmQuantityProductBarcode(productInList.barcode);
        if(isMountedRef.current) setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement'); // 'increment' or 'decrement'
        if(isMountedRef.current) setConfirmQuantityNewValue(finalValue);
        if(isMountedRef.current) setIsConfirmQuantityDialogOpen(true);
        playBeep(660, 100); // Confirmation beep
    } else {
        // Update directly
        startTransition(() => {
            setCountingList(prevList => {
                const currentProductIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                if (currentProductIndex === -1) return prevList; // Should not happen

                const productToUpdate = prevList[currentProductIndex];
                 // Calculate the updated value based on the type and change
                 const updatedValueForState = Math.max(0, (type === 'count' ? productToUpdate.count ?? 0 : productToUpdate.stock ?? 0) + change);


                const updatedProduct = {
                     ...productToUpdate,
                     [type]: updatedValueForState, // Update count or stock
                     lastUpdated: new Date().toISOString()
                };
                // Move updated product to the top of the list
                const listWithoutProduct = prevList.filter((_, i) => i !== currentProductIndex);
                return [updatedProduct, ...listWithoutProduct];
            });
        });
        
        // Handle side effects (toast, database update)
        if (finalValue !== undefined && productForToast) {
            if (type === 'stock') {
                // If stock is modified, update it in the Firestore catalog and local IndexedDB catalog
                try {
                     if (!currentUserId) throw new Error("User ID is missing");
                    // Try updating in Firestore catalog
                    const firestoreCatalogProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
                    if (firestoreCatalogProduct) {
                        const updatedDbProduct: ProductDetail = { ...firestoreCatalogProduct, stock: finalValue };
                        await addOrUpdateProductInCatalog(currentUserId, updatedDbProduct); // Update Firestore
                        // Update local catalog state for immediate UI reflection
                        setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                    } else {
                        // If not in Firestore catalog, try local IndexedDB catalog
                        const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
                        if (localCatalogProduct) {
                            const updatedLocalDbProduct: ProductDetail = { ...localCatalogProduct, stock: finalValue };
                            await addOrUpdateProductToIndexedDB(updatedLocalDbProduct); // Update IndexedDB
                        } else {
                            // If not in any catalog, but in counting list, create a new entry in Firestore catalog (and IndexedDB)
                            const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                            if (listProduct) {
                                const newDbProduct: ProductDetail = {
                                    barcode: listProduct.barcode,
                                    description: listProduct.description,
                                    provider: listProduct.provider,
                                    stock: finalValue, // The new stock value
                                    expirationDate: listProduct.expirationDate,
                                };
                                await addOrUpdateProductInCatalog(currentUserId, newDbProduct); // Add to Firestore
                                await addOrUpdateProductToIndexedDB(newDbProduct);      // Add to IndexedDB
                                // Update local catalog state
                                setCatalogProducts(prev => [...prev, newDbProduct]); 
                            }
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
                    // Handle error updating catalog
                    if(isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({
                                    variant: "destructive",
                                    title: "Error Catálogo",
                                    description: `No se pudo actualizar stock en catálogo.`
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
    }
    // Refocus barcode input
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
  }, [currentWarehouseId, toast, countingList, catalogProducts, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition, currentUserId]);


// Set product value (count or stock) to a specific new value
const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
    if (!isMountedRef.current || !currentUserId) return;
    // Validate new value
    if (newValue < 0 || isNaN(newValue)) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Valor Inválido" });
                }
            });
        }
        requestAnimationFrame(() => { // Ensure UI updates are smooth
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
    if (productIndexInList === -1) return; // Product not in list

    const productInList = countingList[productIndexInList];
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    
    // If setting count and not summing, and new value is same as original, do nothing
    if (type === 'count' && !sumValue && newValue === originalValue) {
        if(isMountedRef.current) setOpenModifyDialog(null); // Close dialog
        requestAnimationFrame(() => { // Ensure UI updates are smooth
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
        return;
    }

    // Calculate final value (either set or sum)
    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    finalValue = Math.max(0, calculatedValue); // Ensure not negative
    productForToast = { ...productInList, [type]: finalValue, lastUpdated: new Date().toISOString() };


    // Check for confirmation if count exceeds stock
    if (type === 'count') {
        // Confirmation needed if new count > stock, original count <= stock, and stock > 0
        needsConfirmation = finalValue > (productInList.stock ?? 0) && originalValue <= (productInList.stock ?? 0) && (productInList.stock ?? 0) > 0;
    }

    if (needsConfirmation) {
        // Open confirmation dialog
        if(isMountedRef.current) setConfirmQuantityProductBarcode(productInList.barcode);
        if(isMountedRef.current) setConfirmQuantityAction('set'); // Action is 'set'
        if(isMountedRef.current) setConfirmQuantityNewValue(finalValue);
        if(isMountedRef.current) setIsConfirmQuantityDialogOpen(true);
        playBeep(660, 100); // Confirmation beep
    } else {
        // Update directly
        startTransition(() => {
            setCountingList(prevList => {
                const currentProductIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                if (currentProductIndex === -1) return prevList; // Should not happen
                
                const productToUpdate = prevList[currentProductIndex];
                const originalValForState = type === 'count' ? productToUpdate.count ?? 0 : productToUpdate.stock ?? 0;
                let calculatedValForState = sumValue ? (originalValForState + newValue) : newValue;
                const finalValForState = Math.max(0, calculatedValForState); // Ensure not negative

                const updatedProduct = {
                    ...productToUpdate,
                    [type]: finalValForState, // Update count or stock
                    lastUpdated: new Date().toISOString()
                };
                // Move updated product to the top
                const listWithoutProduct = prevList.filter((_, i) => i !== currentProductIndex);
                return [updatedProduct, ...listWithoutProduct];
            });
        });

        if(isMountedRef.current) setOpenModifyDialog(null); // Close dialog

         // Handle side effects (toast, database update)
         if (finalValue !== undefined && productForToast) {
             if (type === 'stock') {
                 // If stock is modified, update it in the Firestore catalog and local IndexedDB catalog
                 try {
                     if (!currentUserId) throw new Error("User ID is missing");
                    // Try updating in Firestore catalog
                    const firestoreCatalogProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
                    if (firestoreCatalogProduct) {
                        const updatedDbProduct: ProductDetail = { ...firestoreCatalogProduct, stock: finalValue };
                        await addOrUpdateProductInCatalog(currentUserId, updatedDbProduct); // Update Firestore
                        // Update local catalog state
                        setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                    } else {
                        // If not in Firestore catalog, try local IndexedDB catalog
                        const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
                        if (localCatalogProduct) {
                            const updatedLocalDbProduct: ProductDetail = { ...localCatalogProduct, stock: finalValue };
                            await addOrUpdateProductToIndexedDB(updatedLocalDbProduct); // Update IndexedDB
                        } else {
                            // If not in any catalog, but in counting list, create a new entry in Firestore catalog (and IndexedDB)
                            const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                            if (listProduct) {
                                const newDbProduct: ProductDetail = {
                                    barcode: listProduct.barcode,
                                    description: listProduct.description,
                                    provider: listProduct.provider,
                                    stock: finalValue, // The new stock value
                                    expirationDate: listProduct.expirationDate,
                                };
                                await addOrUpdateProductInCatalog(currentUserId, newDbProduct); // Add to Firestore
                                await addOrUpdateProductToIndexedDB(newDbProduct);      // Add to IndexedDB
                                // Update local catalog state
                                setCatalogProducts(prev => [...prev, newDbProduct]);
                            }
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
                     // Handle error updating catalog
                     if(isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({
                                    variant: "destructive",
                                    title: "Error Catálogo",
                                    description: `No se pudo actualizar stock en catálogo.`
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
     // Refocus barcode input
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
}, [toast, countingList, catalogProducts, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition, currentUserId, currentWarehouseId]);


  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, 1); // Increment by 1
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1); // Decrement by 1
  }, [modifyProductValue]);


 // Handle confirmation of quantity change (when count exceeds stock)
 const handleConfirmQuantityChange = useCallback(() => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null || !currentUserId) {
         // Close dialog and refocus if parameters are invalid
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         requestAnimationFrame(() => { // Ensure UI updates are smooth
             if (isMountedRef.current) {
                 focusBarcodeIfCounting();
             }
         });
         return;
     }

     const warehouseId = currentWarehouseId; // Use current warehouse
     const barcodeToUpdate = confirmQuantityProductBarcode;
     const newValue = confirmQuantityNewValue;
     let confirmedValue: number | null = null; // To store the final confirmed value for toast
     
     // Update counting list
     startTransition(() => {
        setCountingList(prevList => {
            const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
            if (index === -1) return prevList; // Product not found (should not happen)

            const listCopy = [...prevList];
            const productToUpdateCopy = { ...listCopy[index] };
            const finalConfirmedCount = Math.max(0, newValue); // Ensure not negative
            confirmedValue = finalConfirmedCount; // Store for toast

            // Update product with confirmed count
            const productAfterConfirm = {
                ...productToUpdateCopy,
                count: finalConfirmedCount,
                lastUpdated: new Date().toISOString()
            };
            listCopy[index] = productAfterConfirm;
            // Move updated product to the top
            return [productAfterConfirm, ...listCopy.filter((item, i) => i !== index)];
        });
     });

    // Show toast after state update
    requestAnimationFrame(() => {
        if (confirmedValue !== null && isMountedRef.current) { 
            const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
            if (productInList) {
                const tempProductForToast = {...productInList, count: confirmedValue}; // Create a temporary product for toast
                showDiscrepancyToastIfNeeded(tempProductForToast, confirmedValue); // Check for discrepancy
                // Show "Quantity Modified" toast if no discrepancy or if in 'Contador' section
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

    // Reset dialog state and refocus
    if(isMountedRef.current){
     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
     setOpenModifyDialog(null); // Also close the modify dialog if it was open
    }
    requestAnimationFrame(() => { // Ensure UI updates are smooth
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition, currentUserId, activeSection]);


 // Request to delete a product from the counting list
 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         if(isMountedRef.current) setProductToDelete(product); // Set product to be deleted
         if(isMountedRef.current) setIsDeleteDialogOpen(true); // Open delete confirmation dialog
  }, []);

 // Confirm deletion of a product from the counting list
 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete || !currentUserId) return; // Guard clause

     const descriptionForToast = productToDelete.description;
     const barcodeForToast = productToDelete.barcode;
     const warehouseId = productToDelete.warehouseId; // Warehouse context

     // Remove product from counting list
     if(isMountedRef.current) {
        startTransition(() => {
            setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));
        });
     }

     // Show toast
     requestAnimationFrame(() => {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({
                        title: "Producto eliminado",
                        description: `"${descriptionForToast}" se eliminó de la lista actual.`,
                        variant: "default"
                    });
                }
            });
          }
      });
    // Reset dialog state and refocus
    if(isMountedRef.current){
     setIsDeleteDialogOpen(false);
     setProductToDelete(null);
    }
    requestAnimationFrame(() => { // Ensure UI updates are smooth
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [productToDelete, toast, focusBarcodeIfCounting, startTransition, currentUserId]);

 // Clear the current counting list for the active warehouse
 const handleClearCurrentList = useCallback(() => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return; // Guard clause
     
     // Remove items for the current warehouse from counting list
     startTransition(() => {
         setCountingList(prevList => prevList.filter(p => p.warehouseId !== currentWarehouseId));
     });
     
     // Remove from localStorage
     const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
     if (typeof window !== 'undefined') {
        localStorage.removeItem(savedListKey);
     }

     // Show toast
     requestAnimationFrame(() => {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ title: "Lista Actual Borrada" });
                }
            });
          }
     });
     // Close dialog and refocus
     if(isMountedRef.current) setIsDeleteListDialogOpen(false);
     requestAnimationFrame(() => { // Ensure UI updates are smooth
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, startTransition, currentUserId]);

 // Export current counting list to CSV
 const handleExport = useCallback(() => {
     // Filter list for current warehouse
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
        // Prepare data for export
        const dataToExport = currentWarehouseList.map(p => ({
            CodigoBarras: p.barcode,
            Descripcion: p.description,
            Proveedor: p.provider || 'N/A',
            Almacen: getWarehouseName(p.warehouseId), // Get warehouse name
            StockSistema: p.stock ?? 0,
            CantidadContada: p.count ?? 0,
            UltimaActualizacion: p.lastUpdated ? format(new Date(p.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
            FechaVencimiento: p.expirationDate && isValid(parseISO(p.expirationDate)) ? format(parseISO(p.expirationDate), 'yyyy-MM-dd') : 'N/A',
        }));

        // Generate CSV and trigger download
        const csv = Papa.unparse(dataToExport, { header: true });
        const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);

        // Generate dynamic filename
        let fileName = '';
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
    // Refocus barcode input
    requestAnimationFrame(() => { // Ensure UI updates are smooth
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [countingList, currentWarehouseId, toast, getWarehouseName, focusBarcodeIfCounting]);


  // Save current counting list to local history (IndexedDB)
  const handleSaveToHistory = useCallback(async (hideToast = false) => {
    if (!isMountedRef.current || !currentUserId) return; // Guard clause
    // Filter list for current warehouse
    const currentListForWarehouse = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (currentListForWarehouse.length === 0) {
        if (!hideToast && isMountedRef.current) {
             requestAnimationFrame(() => {
                 if(isMountedRef.current) {
                    requestAnimationFrame(() => { // Ensure UI updates are smooth
                        if (isMountedRef.current) {
                            toast({ title: "Vacío", description: "No hay productos para guardar." });
                        }
                    });
                  }
            });
        }
        requestAnimationFrame(() => { // Ensure UI updates are smooth
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
        return;
    }

    if(isMountedRef.current) setIsSavingToHistory(true); // Set loading state
    try {
        const currentWHName = getWarehouseName(currentWarehouseId); // Get current warehouse name
        // Create history entry
        const historyEntry: CountingHistoryEntry = {
            id: `${new Date().toISOString()}_${currentUserId}_${currentWarehouseId}`, // Unique ID
            userId: currentUserId,
            timestamp: new Date().toISOString(),
            warehouseId: currentWarehouseId,
            warehouseName: currentWHName,
            products: JSON.parse(JSON.stringify(currentListForWarehouse)) // Deep copy products
        };

        await saveCountingHistory(historyEntry); // Save to IndexedDB
         if (!hideToast && isMountedRef.current) {
            requestAnimationFrame(() => {
                if(isMountedRef.current) {
                    requestAnimationFrame(() => { // Ensure UI updates are smooth
                        if (isMountedRef.current) {
                            toast({ title: "Historial Guardado Localmente" });
                        }
                    });
                }
            });
        }
    } catch (error: any) {
        console.error("Error saving counting history to LocalDB:", error);
         if (!hideToast && isMountedRef.current) {
             requestAnimationFrame(() => {
                 if(isMountedRef.current) {
                    requestAnimationFrame(() => { // Ensure UI updates are smooth
                        if (isMountedRef.current) {
                            toast({ variant: "destructive", title: "Error al Guardar Historial Local", description: error.message || "Error inesperado." });
                        }
                    });
                  }
             });
        }
    } finally {
        if (isMountedRef.current) {
            setIsSavingToHistory(false); // Reset loading state
        }
        requestAnimationFrame(() => { // Ensure UI updates are smooth
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
    }
}, [countingList, currentWarehouseId, getWarehouseName, toast, currentUserId, focusBarcodeIfCounting]);


 // Refresh stock details for products in the current counting list from catalogs
 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current || !currentUserId) return; // Guard clause
     if(isMountedRef.current) setIsRefreshingStock(true); // Set loading state
     let updatedProductCount = 0;
     let addedProductCount = 0;
     try {
        // Fetch all products from Firestore catalog and local IndexedDB catalog
        const allFirestoreCatalogProducts = await getAllProductsFromCatalog(currentUserId);
        const allLocalCatalogProducts = await getAllProductsFromIndexedDB();

        // Combine catalogs, giving Firestore priority
        const combinedCatalogMap = new Map<string, ProductDetail>();
        allLocalCatalogProducts.forEach(p => combinedCatalogMap.set(p.barcode, p)); // Add local first
        allFirestoreCatalogProducts.forEach(p => combinedCatalogMap.set(p.barcode, p)); // Firestore overwrites if same barcode

        const finalCatalogProducts = Array.from(combinedCatalogMap.values());
        
        // Update local catalog state for other parts of the app
        if (isMountedRef.current) {
            setCatalogProducts(finalCatalogProducts); 
        }

         // Update counting list with refreshed catalog data
         if(isMountedRef.current) {
            startTransition(() => {
                setCountingList(prevCountingList => {
                    // Separate items for current warehouse from others
                    const currentWarehouseItems = prevCountingList.filter(item => item.warehouseId === currentWarehouseId);
                    const otherWarehouseItems = prevCountingList.filter(item => item.warehouseId !== currentWarehouseId);

                    updatedProductCount = 0; // Reset counters
                    addedProductCount = 0;

                    // Update existing items in current warehouse list
                    let updatedCurrentWarehouseList = currentWarehouseItems.map(countingProduct => {
                        const catalogProd = finalCatalogProducts.find(cp => cp.barcode === countingProduct.barcode);
                        if (catalogProd) {
                            // Check if any detail needs updating
                            if (countingProduct.description !== catalogProd.description ||
                                countingProduct.provider !== catalogProd.provider ||
                                countingProduct.stock !== (catalogProd.stock ?? 0) ||
                                countingProduct.expirationDate !== (catalogProd.expirationDate || undefined)
                               )
                            {
                                updatedProductCount++;
                                return {
                                    ...countingProduct,
                                    description: catalogProd.description,
                                    provider: catalogProd.provider,
                                    stock: catalogProd.stock ?? 0,
                                    expirationDate: catalogProd.expirationDate || undefined,
                                    lastUpdated: new Date().toISOString(),
                                };
                            }
                        }
                        return countingProduct; // No changes needed
                    });

                     // Add new products from catalog that are not in the current counting list
                     finalCatalogProducts.forEach(catalogProd => {
                         if (!updatedCurrentWarehouseList.some(cp => cp.barcode === catalogProd.barcode)) {
                             addedProductCount++;
                             updatedCurrentWarehouseList.push({
                                 ...catalogProd,
                                 warehouseId: currentWarehouseId, // Set warehouse context
                                 count: 0, // Default count for new items
                                 lastUpdated: new Date().toISOString(),
                             });
                         }
                     });

                    // Sort updated list by lastUpdated timestamp (newest first)
                    updatedCurrentWarehouseList.sort((a, b) => new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime());

                    // Combine with items from other warehouses
                    return [...updatedCurrentWarehouseList, ...otherWarehouseItems];
                });
            });
         }

          // Show success toast
          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI updates are smooth
                    if (isMountedRef.current) {
                        toast({ title: "Datos Actualizados", description: `${updatedProductCount} actualizado(s), ${addedProductCount} agregado(s) desde catálogos.` });
                    }
                });
              }
          });

     } catch (error) {
         console.error(`Error refreshing stock for warehouse ${currentWarehouseId}:`, error);
          // Show error toast
          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI updates are smooth
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
        // Refocus barcode input
        requestAnimationFrame(() => { // Ensure UI updates are smooth
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
     }
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, startTransition, currentUserId]);


 // Open modify value dialog (for count or stock)
 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
     if(isMountedRef.current) setOpenModifyDialog({ type, product }); // Set dialog state
 }, []);

 // Close modify value dialog
 const handleCloseModifyDialog = () => {
     if(isMountedRef.current) setOpenModifyDialog(null); // Reset dialog state
     requestAnimationFrame(() => { // Ensure UI updates are smooth
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 };

 // Open edit product detail dialog
 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct) => {
     if (!product || !product.barcode || !isMountedRef.current || !currentUserId) return; // Guard clause
     if(isMountedRef.current) setIsDbLoading(true); // Set loading state
     try {
         // Try to find product in local catalog state first
         let productDataToEdit = catalogProducts.find(p => p.barcode === product.barcode);
         let source = "Local Catalog State";

         if (!productDataToEdit) { // If not in local state, try Firestore catalog
             productDataToEdit = await getProductFromCatalog(currentUserId, product.barcode);
             source = "Firestore";
             if (productDataToEdit && isMountedRef.current) { // If found in Firestore, update local catalog state
                 setCatalogProducts(prev => {
                     const existing = prev.find(p => p.barcode === productDataToEdit!.barcode);
                     if (existing) return prev.map(p => p.barcode === productDataToEdit!.barcode ? productDataToEdit! : p);
                     return [...prev, productDataToEdit!];
                 });
             }
         }
         
         if (!productDataToEdit) { // If not in Firestore, try local IndexedDB catalog
            productDataToEdit = await getProductFromIndexedDB(product.barcode);
            source = "Local (IndexedDB)";
         }


         if (productDataToEdit) {
             // Product found, set state for edit dialog
             if (!isMountedRef.current) return;
             setProductToEditDetail(productDataToEdit);
             setInitialStockForEdit(productDataToEdit.stock ?? 0); // Set initial stock for dialog
             setIsEditDetailDialogOpen(true); // Open dialog
             // Show toast if data fetched from DB (not local state)
             if(isMountedRef.current && (source === "Firestore" || source === "Local (IndexedDB)")) {
                 requestAnimationFrame(() => toast({ title: `Editando desde ${source}` }));
             }
         } else {
             // Product not found anywhere, create placeholder for editing (likely for a new, unknown product)
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
                    requestAnimationFrame(() => { // Ensure UI updates are smooth
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
         // Show error toast
         requestAnimationFrame(() => {
            if(isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI updates are smooth
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudieron obtener datos." });
                    }
                });
            }
         });
     } finally {
         if (isMountedRef.current) {
            setIsDbLoading(false); // Reset loading state
         }
     }
 }, [toast, catalogProducts, currentUserId]);

 // Handle submission of edited product details
 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
     if (!isMountedRef.current || !productToEditDetail || !currentUserId) return; // Guard clause
     if(isMountedRef.current) setIsDbLoading(true); // Set loading state
     try {
         // Prepare updated product data
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, // Barcode is not editable
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || undefined,
         };
         // Update in Firestore catalog and local IndexedDB catalog
         await addOrUpdateProductInCatalog(currentUserId, updatedProductData); 
         await addOrUpdateProductToIndexedDB(updatedProductData);       
         
         // Update local catalog state
         setCatalogProducts(prev => {
            const existingIndex = prev.findIndex(p => p.barcode === updatedProductData.barcode);
            if (existingIndex !== -1) { // If product exists, update it
                const newCatalog = [...prev];
                newCatalog[existingIndex] = updatedProductData;
                return newCatalog;
            }
            return [...prev, updatedProductData]; // If new, add it
         });
         
         if (!isMountedRef.current) return;

         // Update product details in the current counting list if it exists there
         startTransition(() => {
            setCountingList(prevList => prevList.map(item =>
                item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId // Match by barcode and current warehouse
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
                requestAnimationFrame(() => { // Ensure UI updates are smooth
                    if (isMountedRef.current) {
                        toast({ title: "Producto Actualizado en Catálogos" });
                    }
                });
             }
         });
         // Close dialog and reset state
         if(isMountedRef.current){
            setIsEditDetailDialogOpen(false);
            setProductToEditDetail(null);
         }
     } catch (error: any) {
         if (!isMountedRef.current) return;
          // Show error toast
          requestAnimationFrame(() => {
            if (isMountedRef.current) {
                requestAnimationFrame(() => { // Ensure UI updates are smooth
                    toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
                });
            }
          });
     } finally {
         if (isMountedRef.current) {
             setIsDbLoading(false); // Reset loading state
         }
         // Refocus barcode input
         requestAnimationFrame(() => { // Ensure UI updates are smooth
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
     }
 }, [toast, currentWarehouseId, productToEditDetail, focusBarcodeIfCounting, startTransition, currentUserId]);

 // Start counting products for a specific provider
 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId) return; // Guard clause
    if (!productsToCount || productsToCount.length === 0) {
        // Show toast if no products for provider
        requestAnimationFrame(() => {
           if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                if (isMountedRef.current) {
                    toast({ title: "Vacío", description: "No hay productos para este proveedor." });
                }
            });
           }
        });
        return;
    }
   // Map catalog products to display products for counting list
   const productsWithWarehouseContext: DisplayProduct[] = productsToCount.map(dbProduct => ({
       ...dbProduct,
       warehouseId: currentWarehouseId, // Set current warehouse context
       stock: dbProduct.stock ?? 0,
       count: 0, // Initialize count to 0
       lastUpdated: new Date().toISOString(),
       expirationDate: dbProduct.expirationDate || undefined,
   }));

   // Update counting list, replacing items for current warehouse
   if(isMountedRef.current) {
     startTransition(() => {
        setCountingList(prevList => {
            // Keep items from other warehouses
            const otherWarehouseItems = prevList.filter(item => item.warehouseId !== currentWarehouseId);
            // New list for current warehouse
            let itemsForCurrentWarehouse = [...productsWithWarehouseContext];

            // Combine and sort
            const newList = [...itemsForCurrentWarehouse, ...otherWarehouseItems];
              newList.sort((a, b) => {
                    // Sort current warehouse items to top, then by lastUpdated
                    if (a.warehouseId === currentWarehouseId && b.warehouseId !== currentWarehouseId) return -1;
                    if (a.warehouseId !== currentWarehouseId && b.warehouseId === currentWarehouseId) return 1;
                    if (a.warehouseId === currentWarehouseId && b.warehouseId === currentWarehouseId) {
                        return new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime();
                    }
                    return 0; // Keep original order for other warehouse items
                });
            return newList;
        });
     });
     setActiveSection("Contador"); // Switch to Contador section
     }
     // Show success toast
     requestAnimationFrame(() => {
        if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                if (isMountedRef.current) {
                    toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` });
                }
            });
        }
     });
    // Refocus barcode input
    requestAnimationFrame(() => { // Ensure UI updates are smooth
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
}, [toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, startTransition, currentUserId]);


  // Filtered counting list based on search term and current warehouse
  const filteredCountingList = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    // Filter by current warehouse first
    const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
    if (!lowerSearchTerm) return currentWarehouseList; // Return all if no search term
    // Apply search term filter
    return currentWarehouseList.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) || // Barcode can be searched as is
      (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
      (product.expirationDate || '').includes(lowerSearchTerm) // Expiration date searched as is
    );
  }, [countingList, searchTerm, currentWarehouseId]);

  // Handle change of active section
  const handleSectionChange = useCallback((newSection: string) => {
    if(isMountedRef.current) setActiveSection(newSection);
    // Refocus barcode input if switching to Contador section
    if (newSection === 'Contador') {
        requestAnimationFrame(() => { // Ensure UI updates are smooth
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
    }
  }, [setActiveSection, focusBarcodeIfCounting]);

   // Handle change of active warehouse
   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             // Update warehouse with transition for smooth UI
             startTransition(() => {
                setIsDbLoading(true); // Set loading state (e.g., for counting list fetch)
                setCurrentWarehouseId(newWarehouseId); // Update current warehouse ID
                setSearchTerm(""); // Clear search term when changing warehouse
             });
             // Save new warehouse ID to localStorage
             if (currentUserId) {
                 setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newWarehouseId);
             }
         }
   }, [currentWarehouseId, setCurrentWarehouseId, startTransition, currentUserId]); // Added currentUserId to dependencies

    // Add a new warehouse
    const handleAddWarehouse = useCallback(async (name: string) => {
        if (!isMountedRef.current || !currentUserId || !name.trim() || !db ) return; // Guard clause, db check for Firestore
        
        // Generate unique ID for new warehouse
        const generatedId = `wh_${format(new Date(), 'yyyyMMdd_HHmmssSSS')}`;
        const newWarehouse: Warehouse = { id: generatedId, name: name.trim() };

        // Check for duplicate warehouse name (case-insensitive)
        const isDuplicateName = warehouses.some(warehouse => warehouse.name.toLowerCase() === newWarehouse.name.toLowerCase());
        if (isDuplicateName) {
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                toast({ variant: 'destructive', title: 'Error', description: 'Nombre de almacén ya existe.' });
            });
            return;
        }
        try {
            // Add warehouse to Firestore
            await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
             // Show success toast and switch to new warehouse
             requestAnimationFrame(() => { // Ensure UI updates are smooth
                 toast({title: "Almacén Agregado", description: `Cambiado a: ${newWarehouse.name}`});
             });
             handleWarehouseChange(newWarehouse.id); // Switch to the new warehouse
        } catch (error) {
            // Error toast is handled by addOrUpdateWarehouseInFirestore or here if needed
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo agregar almacén.' });
            });
        }
   }, [warehouses, currentUserId, handleWarehouseChange, toast]); // Added warehouses, handleWarehouseChange, toast

   // Update an existing warehouse
   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) return; // Guard clause, db check for Firestore
       try {
           // Update warehouse in Firestore
           await addOrUpdateWarehouseInFirestore(currentUserId, warehouseToUpdate);
           // Show success toast
           requestAnimationFrame(() => toast({ title: `Almacén "${warehouseToUpdate.name}" Actualizado` }));
       } catch (error) {
           // Error toast is handled by addOrUpdateWarehouseInFirestore or here if needed
           requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo actualizar el almacén en la nube.' }));
       }
   }, [toast, currentUserId]); // Added toast, currentUserId

   // Delete a warehouse
   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
       if (!isMountedRef.current || !currentUserId || !db || warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
            // Prevent deletion of default warehouse
            if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
                requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Operación no permitida', description: "Almacén Principal no se puede eliminar." }));
            }
           return;
       }
       try {
           // Delete warehouse from Firestore
           await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
           // Show success toast
           requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
           // If deleted warehouse was active, switch to default
           if (warehouseIdToDelete === currentWarehouseId) {
               handleWarehouseChange(DEFAULT_WAREHOUSE_ID); 
           }
       } catch (error) {
           // Error toast is handled by deleteWarehouseFromFirestore or here if needed
           requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo eliminar el almacén de la nube.' }));
       }
   }, [toast, currentUserId, currentWarehouseId, handleWarehouseChange]); // Added dependencies


   // Get current value for modify dialog (count or stock)
   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0; // Default to 0 if no product or not mounted
        // Find current item in counting list
        const currentItem = countingList.find(
          p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId
        );
        // Return stock or count based on type
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]); // Added dependencies

   // Clear master product catalog (Firestore and local IndexedDB)
   const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current || !currentUserId) return; // Guard clause
    if(isMountedRef.current) setIsDbLoading(true); // Set loading state
    try {
      // Clear Firestore catalog
      await clearProductCatalogInFirestore(currentUserId);
      // Clear local IndexedDB catalog
      await clearProductDatabaseInIndexedDB();

      // Reset local catalog state and update counting list
      if(isMountedRef.current) {
        setCatalogProducts([]); // Clear local catalog state
        startTransition(() => { // Update counting list with transition
            setCountingList(prevList => 
                prevList.map(p => {
                    // Reset product details in counting list to defaults
                    return {...p, description: `Producto ${p.barcode}`, provider: "Desconocido", stock: 0, expirationDate: undefined};
                })
            );
        });
      }
      // Show success toast
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                if (isMountedRef.current) {
                    toast({ title: "Catálogos de Productos Borrados" });
                }
            });
          }
      });
    } catch (error: any) {
      // Show error toast
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: `No se pudieron borrar datos: ${error.message}` });
                }
            });
          }
      });
    } finally {
      // Reset dialog and loading state, refocus
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setIsClearCatalogConfirmOpen(false);
      }
      requestAnimationFrame(() => { // Ensure UI updates are smooth
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
     });
    }
  }, [toast, currentUserId, focusBarcodeIfCounting, startTransition]); // Added dependencies


  // Sidebar section items definition
  const sectionItems = useMemo(() => [
    { name: 'Contador', icon: ClipboardList, label: `Contador (${getWarehouseName(currentWarehouseId)})`},
    { name: 'Catálogo de Productos', icon: PackageSearch, label: 'Catálogo de Productos' },
    { name: 'Almacenes', icon: Boxes, label: 'Almacenes' },
    { name: 'Informe Consolidado', icon: Library, label: 'Informe Consolidado' },
  ], [getWarehouseName, currentWarehouseId]); // Added dependencies

  // Handle user sign out
  const handleSignOut = () => {
    if(isMountedRef.current) {
        // Reset all user-specific state
        setIsAuthenticated(false);
        setCurrentUserId(null);
        setCountingList([]); 
        setCatalogProducts([]);
        setWarehouses(PREDEFINED_WAREHOUSES_LIST); // Reset to predefined warehouses
        setCurrentWarehouseId(DEFAULT_WAREHOUSE_ID); // Reset to default warehouse
        // Clear user ID from localStorage
        if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
            // Optionally clear other user-specific localStorage items
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
    currentUserId: currentUserId || "", // Pass currentUserId or empty string
    warehouses,
    currentWarehouseId,
    handleWarehouseChange,
    getWarehouseName,
    onSectionChange: (section: string) => {
      handleSectionChange(section);
      if (isMobile) setMobileSheetOpen(false); // Close mobile sheet on section change
    },
    onToggleCollapse: () => setIsSidebarCollapsed(!isSidebarCollapsed), // Toggle sidebar collapse
    onSignOut: handleSignOut, // Pass sign out handler
  };

  // Props for CounterSection component
  const counterSectionProps = {
    barcode,
    setBarcode,
    onAddProduct: handleAddProduct,
    onRefreshStock: handleRefreshStock,
    isLoading: isDbLoading || isTransitionPending, // Combine loading states
    isRefreshingStock,
    inputRef: barcodeInputRef,
    searchTerm,
    setSearchTerm,
    filteredCountingList,
    warehouseName: getWarehouseName(currentWarehouseId),
    onDeleteRequest: handleDeleteRequest,
    onOpenStockDialog: (product: DisplayProduct) => handleOpenModifyDialog(product, 'stock'),
    onOpenQuantityDialog: (product: DisplayProduct) => handleOpenModifyDialog(product, 'count'),
    onDecrement: handleDecrement,
    onIncrement: handleIncrement,
    onEditDetailRequest: handleOpenEditDetailDialog,
    countingList,
    currentWarehouseId,
    isSavingToHistory,
    onSaveToHistory: handleSaveToHistory,
    onExport: handleExport,
    onSetIsDeleteListDialogOpen: setIsDeleteListDialogOpen,
    isMobile,
    toast,
    isDbLoading: isDbLoading, 
    isTransitionPending: isTransitionPending,
  };

  // Handle user login
  const handleLogin = () => {
    // Validate credentials
    if (loginUsername === LOGIN_USER && loginPassword === LOGIN_PASSWORD) {
        if (isMountedRef.current) {
            // Set user state and save to localStorage
            setCurrentUserId(LOGIN_USER); 
            setIsAuthenticated(true);
            setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, LOGIN_USER);
            // Load warehouse ID for this user or default
            const storedWarehouseId = getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${LOGIN_USER}`, DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(storedWarehouseId);
            isInitialFetchDoneForUser.current[LOGIN_USER] = false; // Reset initial fetch flag for new session

            // Show success toast and clear form
            requestAnimationFrame(() => {
                toast({ title: "Inicio de sesión exitoso" });
            });
            setLoginUsername("");
            setLoginPassword("");
        }
    } else {
        // Show error toast and clear password
        if (isMountedRef.current) {
             requestAnimationFrame(() => {
                toast({ variant: "destructive", title: "Error de inicio de sesión" });
            });
        }
        setLoginPassword("");
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
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()} // Login on Enter key
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

  // Render main application UI if authenticated
  return (
    <div className="flex flex-col md:flex-row h-screen bg-background text-foreground">
      {/* Mobile Header with Sheet Trigger */}
      <div className="md:hidden p-4 border-b flex items-center justify-between bg-card sticky top-0 z-20">
        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Abrir menú">
              <MenuIcon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-[280px] sm:w-[320px] bg-card flex flex-col">
            <SheetHeader className="sr-only"> {/* Screen-reader only title */}
              <SheetTitle>Menú Principal</SheetTitle>
            </SheetHeader>
            <SidebarLayout
              {...sidebarProps} // Pass sidebar props
            />
          </SheetContent>
        </Sheet>
        <h2 className="text-xl font-semibold truncate ml-4">StockCounter Pro</h2>
        <div className="w-8"></div> {/* Spacer for balance */}
      </div>

      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-shrink-0 border-r bg-card flex-col transition-all duration-300 ease-in-out",
        isSidebarCollapsed ? "w-20" : "w-60" // Adjust width based on collapse state
      )}>
        <SidebarLayout
          {...sidebarProps} // Pass sidebar props
        />
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 overflow-y-auto">
        {/* Render active section based on state */}
        {activeSection === 'Contador' && currentUserId && <CounterSection {...counterSectionProps} />}

         {activeSection === 'Catálogo de Productos' && currentUserId && (
            <div id="database-content">
               <ProductDatabase
                  userId={currentUserId}
                  onStartCountByProvider={handleStartCountByProvider}
                  isTransitionPending={isTransitionPending || isDbLoading}
                  catalogProducts={catalogProducts}
                  setCatalogProducts={setCatalogProducts}
                  onClearDatabaseRequest={() => {if(isMountedRef.current) setIsClearCatalogConfirmOpen(true)}}
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
           {activeSection === 'Informe Consolidado' && currentUserId && (
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
            if (!open) { // Reset state if dialog is closed without confirming
                setConfirmQuantityProductBarcode(null);
                setConfirmQuantityAction(null);
                setConfirmQuantityNewValue(null);
                requestAnimationFrame(() => { // Ensure UI updates are smooth
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

               if ((confirmQuantityAction === 'set' || confirmQuantityAction === 'increment') && stock > 0 && confirmQuantityNewValue > stock) {
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
              requestAnimationFrame(() => { // Ensure UI updates are smooth
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
            if (!open) { // Reset state if dialog is closed
                setProductToDelete(null);
                requestAnimationFrame(() => { // Ensure UI updates are smooth
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
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                if (isMountedRef.current) {
                    focusBarcodeIfCounting();
                }
            });
         }}
         isDestructive={true} // Mark as destructive action
         isProcessing={isTransitionPending}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteListDialogOpen(open);
            if (!open) { // Refocus if closed
                requestAnimationFrame(() => { // Ensure UI updates are smooth
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
            requestAnimationFrame(() => { // Ensure UI updates are smooth
                if (isMountedRef.current) {
                    focusBarcodeIfCounting();
                }
            });
          }}
          isDestructive={true} // Mark as destructive
          isProcessing={isTransitionPending}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => {
                setIsClearCatalogConfirmOpen(open);
                if (!open) { // Refocus if closed
                    requestAnimationFrame(() => { // Ensure UI updates are smooth
                        if (isMountedRef.current) {
                            focusBarcodeIfCounting();
                        }
                    });
                }
            }}
            title="Confirmar Borrado Catálogos"
            description={ // Rich description with alert icon
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-destructive">
                         <AlertTriangle className="h-5 w-5"/>
                         <span className="font-semibold">¡Acción Irreversible!</span>
                    </div>
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos del catálogo en Firestore y del catálogo local (IndexedDB) para el usuario '{currentUserId}'.</p>
                    <p>Esta acción no se puede deshacer.</p>
                 </div>
            }
            confirmText="Sí, Borrar Catálogos"
            onConfirm={handleClearCatalog}
            onCancel={() => {
                if(isMountedRef.current) setIsClearCatalogConfirmOpen(false);
                requestAnimationFrame(() => { // Ensure UI updates are smooth
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
            }}
            isDestructive={true} // Mark as destructive
            isProcessing={isDbLoading || isTransitionPending} // Processing if DB is loading or transition pending
        />

      {/* Edit Product Detail Dialog (only rendered if productToEditDetail is set) */}
      {productToEditDetail && currentUserId && (
        <EditProductDialog
          isOpen={isEditDetailDialogOpen}
          setIsOpen={(open) => {
              setIsEditDetailDialogOpen(open);
              if (!open) { // Reset state and refocus if closed
                  setProductToEditDetail(null);
                  requestAnimationFrame(() => { // Ensure UI updates are smooth
                      if (isMountedRef.current) {
                          focusBarcodeIfCounting();
                      }
                  });
              }
          }}
          selectedDetail={productToEditDetail}
          setSelectedDetail={setProductToEditDetail}
          onSubmit={handleEditDetailSubmit}
          onDelete={ async (barcode) => { // Handle deletion from catalog
                if (!isMountedRef.current || !currentUserId) return; // Guard clause
                if(isMountedRef.current) setIsDbLoading(true); // Set loading state
                try {
                    // Delete from Firestore and IndexedDB catalogs
                    await deleteProductFromCatalog(currentUserId, barcode); 
                    await deleteProductFromIndexedDB(barcode);

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
                          requestAnimationFrame(() => { // Ensure UI updates are smooth
                              if (isMountedRef.current) {
                                  toast({title: "Producto eliminado de catálogos"});
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
                      if (!isMountedRef.current) return;
                      // Show error toast
                      requestAnimationFrame(() => {
                          if(isMountedRef.current) {
                              requestAnimationFrame(() => { // Ensure UI updates are smooth
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
                      // Refocus barcode input
                      requestAnimationFrame(() => { // Ensure UI updates are smooth
                          if (isMountedRef.current) {
                              focusBarcodeIfCounting();
                          }
                      });
                }
            }}
          isProcessing={isDbLoading || isTransitionPending} // Processing if DB loading or transition pending
          initialStock={initialStockForEdit} // Pass initial stock for editing
          context="countingList" // Context indicates it's called from counting list
          warehouseName={getWarehouseName(currentWarehouseId)} // Pass warehouse name for context
        />
      )}
    </div>
  );
}
    

    
