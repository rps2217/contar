
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
import { WarehouseManagement } from "@/components/warehouse-management"; // Updated component
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, CalendarClock, BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide, LockKeyhole, CheckCircle, PackageSearch, AlertTriangle, Menu as MenuIcon, User, ShieldAlert, Filter, PanelLeftClose, PanelRightOpen, Save } from "lucide-react"; // Added Save
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
} from '@/lib/database'; 
import {
  subscribeToWarehouses, 
  addOrUpdateWarehouseInFirestore,
  deleteWarehouseFromFirestore,
  getProductFromCatalog, 
  getAllProductsFromCatalog,
  addOrUpdateProductInCatalog,
  deleteProductFromCatalog,
  clearProductCatalogInFirestore,
  addProductsToCatalog, 
} from '@/lib/firestore-service';
import Papa from 'papaparse';
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
import { writeBatch } from 'firebase/firestore';


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

  const [warehouses, setWarehouses] = useState<Warehouse[]>(PREDEFINED_WAREHOUSES_LIST); // Initialize with predefined
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(DEFAULT_WAREHOUSE_ID);
  const [catalogProducts, setCatalogProducts] = useState<ProductDetail[]>([]);


  // --- UI State ---
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
  const isInitialWarehouseFetchDoneForUser = useRef<Record<string, boolean>>({});


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
            setWarehouses(PREDEFINED_WAREHOUSES_LIST);
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
        
        if (!isInitialWarehouseFetchDoneForUser.current[currentUserId]) {
            isInitialWarehouseFetchDoneForUser.current[currentUserId] = true; 
            
            const warehousesToAddBatch: Warehouse[] = [];
            PREDEFINED_WAREHOUSES_LIST.forEach(predefined => {
                if (!fetchedWarehouses.some(fw => fw.id === predefined.id)) {
                    warehousesToAddBatch.push(predefined);
                }
            });

            if (warehousesToAddBatch.length > 0 && db && currentUserId) { // Ensure currentUserId is valid
                try {
                    const batch = writeBatch(db);
                    warehousesToAddBatch.forEach(wh => {
                        const warehouseDocRef = db.collection(`users/${currentUserId}/warehouses`).doc(wh.id);
                        batch.set(warehouseDocRef, wh);
                    });
                    await batch.commit();
                    // Firestore listener will subsequently pick up these changes.
                    // No need to manually merge `finalWarehousesToSet` here from the batch.
                } catch (err) {
                    console.error(`Failed to add predefined warehouses to Firestore for user ${currentUserId}:`, err);
                    requestAnimationFrame(() => toast({ variant: "destructive", title: "Error DB", description: `No se pudieron agregar almacenes predefinidos.`}));
                    // Fallback: if batch fails, merge locally for UI consistency for this session
                    finalWarehousesToSet = [...fetchedWarehouses, ...warehousesToAddBatch].filter((v,i,a)=>a.findIndex(t=>(t.id === v.id))===i);
                }
            }
             // If after potential batch add, Firestore still returns empty (e.g. first ever load + batch failed or no predefined needed)
            // ensure the local state still has the base predefined list for UI.
            if (finalWarehousesToSet.length === 0 && warehousesToAddBatch.length === 0) { // No fetched, no added
                 finalWarehousesToSet = [...PREDEFINED_WAREHOUSES_LIST];
            }
        }
        
        setWarehouses(finalWarehousesToSet.length > 0 ? finalWarehousesToSet : PREDEFINED_WAREHOUSES_LIST);

        // Logic to determine currentWarehouseId based on localStorage and fetched/predefined list
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
      // Do not reset isInitialWarehouseFetchDoneForUser.current[currentUserId] on unsubscribe
      // as it's per-user-session, not per-subscription. It's reset on new login.
    };
  }, [currentUserId, toast]);


  useEffect(() => {
    if (!currentUserId || !isMountedRef.current) {
      if (isMountedRef.current) setCatalogProducts([]);
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
  }, [currentUserId, toast]);


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
                stock: item.stock ?? 0,
                count: item.count ?? 0,
                lastUpdated: item.lastUpdated || new Date().toISOString(),
                warehouseId: item.warehouseId || currentWarehouseId, 
                expirationDate: item.expirationDate || undefined,
            }));
        if(isMountedRef.current) setCountingList(loadedList.filter(item => item.warehouseId === currentWarehouseId));
    } else {
        if (Array.isArray(savedList) && savedList.length > 0 && !savedList.every(item => typeof item?.barcode === 'string')) {
           console.warn(`Invalid data structure in localStorage for ${savedListKey}. Clearing.`);
        }
        if(typeof window !== 'undefined') localStorage.removeItem(savedListKey);
        if(isMountedRef.current) setCountingList([]);
    }
    if(isMountedRef.current) setIsDbLoading(false);
 }, [currentWarehouseId, currentUserId]);

 const debouncedSaveCountingList = useMemo(
    () =>
      debounce((list: DisplayProduct[], warehouseId: string, userId: string) => {
        if (!warehouseId || !isMountedRef.current || !userId) return;
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}_${userId}`;
        const listToSave = list.filter(item => item.warehouseId === warehouseId);
        setLocalStorageItem(key, listToSave);
      }, 500),
    []
  );

  useEffect(() => {
    if (!isDbLoading && isMountedRef.current && currentWarehouseId && currentUserId) {
      debouncedSaveCountingList(countingList, currentWarehouseId, currentUserId);
    }
    return () => {
       debouncedSaveCountingList.clear?.();
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

    if (existingProductIndex !== -1) {
        const productToUpdate = countingList[existingProductIndex];
        const newCount = (productToUpdate.count ?? 0) + 1;

        const productStock = productToUpdate.stock ?? 0;
        const originalCount = productToUpdate.count ?? 0;
        const needsConfirmation = newCount > productStock && originalCount <= productStock && productStock > 0;

        if (needsConfirmation) {
             if(isMountedRef.current) setConfirmQuantityProductBarcode(productToUpdate.barcode);
             if(isMountedRef.current) setConfirmQuantityAction('increment');
             if(isMountedRef.current) setConfirmQuantityNewValue(newCount);
             if(isMountedRef.current) setIsConfirmQuantityDialogOpen(true);
             playBeep(660, 100);
        } else {
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
            playBeep(880, 100);
            showDiscrepancyToastIfNeeded(updatedProductData, newCount);
        }
    } else {
        let newProductForList: DisplayProduct | null = null;
        try {
            const catalogProduct = catalogProducts.find(p => p.barcode === trimmedBarcode);
            if (catalogProduct) {
                newProductForList = {
                    ...catalogProduct,
                    warehouseId: currentWarehouseId,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(660, 150);
                showDiscrepancyToastIfNeeded(newProductForList);

            } else {
                const localCatalogProduct = await getProductFromIndexedDB(trimmedBarcode);
                if (localCatalogProduct) {
                    newProductForList = {
                        ...localCatalogProduct,
                        warehouseId: currentWarehouseId,
                        count: 1,
                        lastUpdated: new Date().toISOString(),
                    };
                    playBeep(660, 150);
                    showDiscrepancyToastIfNeeded(newProductForList);
                    if (isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({ variant: "default", title: "Producto Local", description: "Producto encontrado en catálogo local." });
                            }
                        });
                    }
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
             if (isMountedRef.current && newProductForList) {
                 const finalProduct = newProductForList;
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
            playBeep(440, 300);
        }
    }
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            setBarcode("");
            focusBarcodeIfCounting();
        }
    });
  }, [barcode, currentWarehouseId, currentUserId, lastScannedBarcode, toast, countingList, catalogProducts, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition]);


const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current || !currentUserId) return;

    let finalValue: number | undefined;
    let needsConfirmation = false;
    let productForToast: DisplayProduct | null = null;

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);

    if (productIndexInList === -1) {
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
    const calculatedNewValue = Math.max(0, originalValue + change);
    finalValue = calculatedNewValue;
    productForToast = { ...productInList, [type]: finalValue, lastUpdated: new Date().toISOString() };


    if (type === 'count') {
      needsConfirmation = finalValue > (productInList.stock ?? 0) && originalValue <= (productInList.stock ?? 0) && (productInList.stock ?? 0) > 0;
    }

    if (needsConfirmation) {
        if(isMountedRef.current) setConfirmQuantityProductBarcode(productInList.barcode);
        if(isMountedRef.current) setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
        if(isMountedRef.current) setConfirmQuantityNewValue(finalValue);
        if(isMountedRef.current) setIsConfirmQuantityDialogOpen(true);
        playBeep(660, 100);
    } else {
        startTransition(() => {
            setCountingList(prevList => {
                const currentProductIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                if (currentProductIndex === -1) return prevList;

                const productToUpdate = prevList[currentProductIndex];
                 const updatedValueForState = Math.max(0, (type === 'count' ? productToUpdate.count ?? 0 : productToUpdate.stock ?? 0) + change);


                const updatedProduct = {
                     ...productToUpdate,
                     [type]: updatedValueForState,
                     lastUpdated: new Date().toISOString()
                };
                const listWithoutProduct = prevList.filter((_, i) => i !== currentProductIndex);
                return [updatedProduct, ...listWithoutProduct];
            });
        });
        
        if (finalValue !== undefined && productForToast) {
            if (type === 'stock') {
                try {
                     if (!currentUserId) throw new Error("User ID is missing");
                    const firestoreCatalogProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
                    if (firestoreCatalogProduct) {
                        const updatedDbProduct: ProductDetail = { ...firestoreCatalogProduct, stock: finalValue };
                        await addOrUpdateProductInCatalog(currentUserId, updatedDbProduct);
                        setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                    } else {
                        const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
                        if (localCatalogProduct) {
                            const updatedLocalDbProduct: ProductDetail = { ...localCatalogProduct, stock: finalValue };
                            await addOrUpdateProductToIndexedDB(updatedLocalDbProduct);
                        } else {
                            const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                            if (listProduct) {
                                const newDbProduct: ProductDetail = {
                                    barcode: listProduct.barcode,
                                    description: listProduct.description,
                                    provider: listProduct.provider,
                                    stock: finalValue,
                                    expirationDate: listProduct.expirationDate,
                                };
                                await addOrUpdateProductInCatalog(currentUserId, newDbProduct); 
                                await addOrUpdateProductToIndexedDB(newDbProduct);      
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
                 showDiscrepancyToastIfNeeded(productForToast, finalValue);
            }
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
        requestAnimationFrame(() => {
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
    if (productIndexInList === -1) return;

    const productInList = countingList[productIndexInList];
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    
    if (type === 'count' && !sumValue && newValue === originalValue) {
        if(isMountedRef.current) setOpenModifyDialog(null);
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
        return;
    }

    let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
    finalValue = Math.max(0, calculatedValue);
    productForToast = { ...productInList, [type]: finalValue, lastUpdated: new Date().toISOString() };


    if (type === 'count') {
        needsConfirmation = finalValue > (productInList.stock ?? 0) && originalValue <= (productInList.stock ?? 0) && (productInList.stock ?? 0) > 0;
    }

    if (needsConfirmation) {
        if(isMountedRef.current) setConfirmQuantityProductBarcode(productInList.barcode);
        if(isMountedRef.current) setConfirmQuantityAction('set');
        if(isMountedRef.current) setConfirmQuantityNewValue(finalValue);
        if(isMountedRef.current) setIsConfirmQuantityDialogOpen(true);
        playBeep(660, 100);
    } else {
        startTransition(() => {
            setCountingList(prevList => {
                const currentProductIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                if (currentProductIndex === -1) return prevList;
                
                const productToUpdate = prevList[currentProductIndex];
                const originalValForState = type === 'count' ? productToUpdate.count ?? 0 : productToUpdate.stock ?? 0;
                let calculatedValForState = sumValue ? (originalValForState + newValue) : newValue;
                const finalValForState = Math.max(0, calculatedValForState);

                const updatedProduct = {
                    ...productToUpdate,
                    [type]: finalValForState,
                    lastUpdated: new Date().toISOString()
                };
                const listWithoutProduct = prevList.filter((_, i) => i !== currentProductIndex);
                return [updatedProduct, ...listWithoutProduct];
            });
        });

        if(isMountedRef.current) setOpenModifyDialog(null); 

         if (finalValue !== undefined && productForToast) {
             if (type === 'stock') {
                 try {
                     if (!currentUserId) throw new Error("User ID is missing");
                    const firestoreCatalogProduct = catalogProducts.find(p => p.barcode === barcodeToUpdate);
                    if (firestoreCatalogProduct) {
                        const updatedDbProduct: ProductDetail = { ...firestoreCatalogProduct, stock: finalValue };
                        await addOrUpdateProductInCatalog(currentUserId, updatedDbProduct);
                        setCatalogProducts(prev => prev.map(p => p.barcode === barcodeToUpdate ? updatedDbProduct : p));
                    } else {
                        const localCatalogProduct = await getProductFromIndexedDB(barcodeToUpdate);
                        if (localCatalogProduct) {
                            const updatedLocalDbProduct: ProductDetail = { ...localCatalogProduct, stock: finalValue };
                            await addOrUpdateProductToIndexedDB(updatedLocalDbProduct);
                        } else {
                            const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                            if (listProduct) {
                                const newDbProduct: ProductDetail = {
                                    barcode: listProduct.barcode,
                                    description: listProduct.description,
                                    provider: listProduct.provider,
                                    stock: finalValue,
                                    expirationDate: listProduct.expirationDate,
                                };
                                await addOrUpdateProductInCatalog(currentUserId, newDbProduct); 
                                await addOrUpdateProductToIndexedDB(newDbProduct);      
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
     modifyProductValue(barcode, type, 1);
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1);
  }, [modifyProductValue]);


 const handleConfirmQuantityChange = useCallback(() => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null || !currentUserId) {
         if(isMountedRef.current) setIsConfirmQuantityDialogOpen(false);
         requestAnimationFrame(() => {
             if (isMountedRef.current) {
                 focusBarcodeIfCounting();
             }
         });
         return;
     }

     const warehouseId = currentWarehouseId;
     const barcodeToUpdate = confirmQuantityProductBarcode;
     const newValue = confirmQuantityNewValue;
     let confirmedValue: number | null = null;
     
     startTransition(() => {
        setCountingList(prevList => {
            const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
            if (index === -1) return prevList;

            const listCopy = [...prevList];
            const productToUpdateCopy = { ...listCopy[index] };
            const finalConfirmedCount = Math.max(0, newValue);
            confirmedValue = finalConfirmedCount; 

            const productAfterConfirm = {
                ...productToUpdateCopy,
                count: finalConfirmedCount,
                lastUpdated: new Date().toISOString()
            };
            listCopy[index] = productAfterConfirm;
            return [productAfterConfirm, ...listCopy.filter((item, i) => i !== index)];
        });
     });

    requestAnimationFrame(() => {
        if (confirmedValue !== null && isMountedRef.current) { 
            const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
            if (productInList) {
                const tempProductForToast = {...productInList, count: confirmedValue};
                showDiscrepancyToastIfNeeded(tempProductForToast, confirmedValue);
                if (!showDiscrepancyToastIfNeeded(tempProductForToast, confirmedValue) || activeSection === 'Contador') {
                     requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            toast({ title: "Cantidad Modificada" });
                        }
                     });
                }
            } else { 
                 requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        toast({ title: "Cantidad Modificada" });
                    }
                 });
            }
        }
    });

    if(isMountedRef.current){
     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
     setOpenModifyDialog(null);
    }
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition, currentUserId, activeSection]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         if(isMountedRef.current) setProductToDelete(product);
         if(isMountedRef.current) setIsDeleteDialogOpen(true);
  }, []);

 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete || !currentUserId) return;

     const descriptionForToast = productToDelete.description;
     const barcodeForToast = productToDelete.barcode;
     const warehouseId = productToDelete.warehouseId;

     if(isMountedRef.current) {
        startTransition(() => {
            setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));
        });
     }

     requestAnimationFrame(() => {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({
                        title: "Producto eliminado",
                        description: `"${descriptionForToast}" (${barcodeForToast}) se eliminó de la lista.`,
                        variant: "default"
                    });
                }
            });
          }
      });
    if(isMountedRef.current){
     setIsDeleteDialogOpen(false);
     setProductToDelete(null);
    }
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [productToDelete, toast, focusBarcodeIfCounting, startTransition, currentUserId]);

 const handleClearCurrentList = useCallback(() => {
     if (!isMountedRef.current || !currentWarehouseId || !currentUserId) return;
     
     startTransition(() => {
         setCountingList(prevList => prevList.filter(p => p.warehouseId !== currentWarehouseId));
     });
     
     const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}_${currentUserId}`;
     if (typeof window !== 'undefined') {
        localStorage.removeItem(savedListKey);
     }

     requestAnimationFrame(() => {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ title: "Lista Actual Borrada" });
                }
            });
          }
     });
     if(isMountedRef.current) setIsDeleteListDialogOpen(false);
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, startTransition, currentUserId]);

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
        const dataToExport = currentWarehouseList.map(p => ({
            CodigoBarras: p.barcode,
            Descripcion: p.description,
            Proveedor: p.provider || 'N/A',
            Almacen: getWarehouseName(p.warehouseId),
            StockSistema: p.stock ?? 0,
            CantidadContada: p.count ?? 0,
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
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 }, [countingList, currentWarehouseId, toast, getWarehouseName, focusBarcodeIfCounting]);


  const handleSaveToHistory = useCallback(async (hideToast = false) => {
    if (!isMountedRef.current || !currentUserId) return;
    const currentListForWarehouse = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (currentListForWarehouse.length === 0) {
        if (!hideToast && isMountedRef.current) {
             requestAnimationFrame(() => {
                 if(isMountedRef.current) {
                    requestAnimationFrame(() => { 
                        if (isMountedRef.current) {
                            toast({ title: "Vacío", description: "No hay productos para guardar." });
                        }
                    });
                  }
            });
        }
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
        return;
    }

    if(isMountedRef.current) setIsSavingToHistory(true);
    try {
        const currentWHName = getWarehouseName(currentWarehouseId);
        const historyEntry: CountingHistoryEntry = {
            id: `${new Date().toISOString()}_${currentUserId}_${currentWarehouseId}`, 
            userId: currentUserId,
            timestamp: new Date().toISOString(),
            warehouseId: currentWarehouseId,
            warehouseName: currentWHName,
            products: JSON.parse(JSON.stringify(currentListForWarehouse)) 
        };

        await saveCountingHistory(historyEntry); 
         if (!hideToast && isMountedRef.current) {
            requestAnimationFrame(() => {
                if(isMountedRef.current) {
                    requestAnimationFrame(() => { 
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
                    requestAnimationFrame(() => { 
                        if (isMountedRef.current) {
                            toast({ variant: "destructive", title: "Error al Guardar Historial Local", description: error.message || "Error inesperado." });
                        }
                    });
                  }
             });
        }
    } finally {
        if (isMountedRef.current) {
            setIsSavingToHistory(false);
        }
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
    }
}, [countingList, currentWarehouseId, getWarehouseName, toast, currentUserId, focusBarcodeIfCounting]);


 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current || !currentUserId) return;
     if(isMountedRef.current) setIsRefreshingStock(true);
     let updatedProductCount = 0;
     let addedProductCount = 0;
     try {
        const allFirestoreCatalogProducts = await getAllProductsFromCatalog(currentUserId);
        const allLocalCatalogProducts = await getAllProductsFromIndexedDB();

        const combinedCatalogMap = new Map<string, ProductDetail>();
        allLocalCatalogProducts.forEach(p => combinedCatalogMap.set(p.barcode, p));
        allFirestoreCatalogProducts.forEach(p => combinedCatalogMap.set(p.barcode, p)); 

        const finalCatalogProducts = Array.from(combinedCatalogMap.values());
        
        if (isMountedRef.current) {
            setCatalogProducts(finalCatalogProducts); 
        }

         if(isMountedRef.current) {
            startTransition(() => {
                setCountingList(prevCountingList => {
                    const currentWarehouseItems = prevCountingList.filter(item => item.warehouseId === currentWarehouseId);
                    const otherWarehouseItems = prevCountingList.filter(item => item.warehouseId !== currentWarehouseId);

                    updatedProductCount = 0;
                    addedProductCount = 0;

                    let updatedCurrentWarehouseList = currentWarehouseItems.map(countingProduct => {
                        const catalogProd = finalCatalogProducts.find(cp => cp.barcode === countingProduct.barcode);
                        if (catalogProd) {
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
                        return countingProduct;
                    });

                     finalCatalogProducts.forEach(catalogProd => {
                         if (!updatedCurrentWarehouseList.some(cp => cp.barcode === catalogProd.barcode)) {
                             addedProductCount++;
                             updatedCurrentWarehouseList.push({
                                 ...catalogProd,
                                 warehouseId: currentWarehouseId,
                                 count: 0,
                                 lastUpdated: new Date().toISOString(),
                             });
                         }
                     });

                    updatedCurrentWarehouseList.sort((a, b) => new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime());

                    return [...updatedCurrentWarehouseList, ...otherWarehouseItems];
                });
            });
         }

          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                requestAnimationFrame(() => { 
                    if (isMountedRef.current) {
                        toast({ title: "Datos Actualizados", description: `${updatedProductCount} actualizado(s), ${addedProductCount} agregado(s) desde catálogos.` });
                    }
                });
              }
          });

     } catch (error) {
         console.error(`Error refreshing stock for warehouse ${currentWarehouseId}:`, error);
          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                requestAnimationFrame(() => { 
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar datos.` });
                    }
                });
              }
          });
     } finally {
         if (isMountedRef.current) {
             setIsRefreshingStock(false);
         }
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
     }
 }, [currentWarehouseId, toast, focusBarcodeIfCounting, startTransition, currentUserId]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
     if(isMountedRef.current) setOpenModifyDialog({ type, product });
 }, []);

 const handleCloseModifyDialog = () => {
     if(isMountedRef.current) setOpenModifyDialog(null);
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
 };

 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct) => {
     if (!product || !product.barcode || !isMountedRef.current || !currentUserId) return;
     if(isMountedRef.current) setIsDbLoading(true);
     try {
         let productDataToEdit = catalogProducts.find(p => p.barcode === product.barcode);
         let source = "Firestore";

         if (!productDataToEdit) {
             productDataToEdit = await getProductFromIndexedDB(product.barcode);
             source = "Local (IndexedDB)";
         }

         if (productDataToEdit) {
             if (!isMountedRef.current) return;
             setProductToEditDetail(productDataToEdit);
             setInitialStockForEdit(productDataToEdit.stock ?? 0);
             setIsEditDetailDialogOpen(true);
             if(isMountedRef.current && source !== "Firestore") {
                 requestAnimationFrame(() => toast({ title: "Editando desde Catálogo Local" }));
             }
         } else {
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
                    requestAnimationFrame(() => { 
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
                requestAnimationFrame(() => { 
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error Catálogo", description: "No se pudieron obtener datos." });
                    }
                });
            }
         });
     } finally {
         if (isMountedRef.current) {
            setIsDbLoading(false);
         }
     }
 }, [toast, catalogProducts, currentUserId]);

 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
     if (!isMountedRef.current || !productToEditDetail || !currentUserId) return;
     if(isMountedRef.current) setIsDbLoading(true);
     try {
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode,
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || undefined,
         };
         await addOrUpdateProductInCatalog(currentUserId, updatedProductData); 
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
         
         if (!isMountedRef.current) return;

         startTransition(() => {
            setCountingList(prevList => prevList.map(item =>
                item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId
                    ? {
                        ...item,
                        description: updatedProductData.description,
                        provider: updatedProductData.provider,
                        stock: updatedProductData.stock,
                        expirationDate: updatedProductData.expirationDate,
                        lastUpdated: new Date().toISOString()
                      }
                    : item
            ));
         });

         requestAnimationFrame(() => {
             if(isMountedRef.current) {
                requestAnimationFrame(() => { 
                    if (isMountedRef.current) {
                        toast({ title: "Producto Actualizado en Catálogos" });
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
                requestAnimationFrame(() => {
                    toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
                });
            }
          });
     } finally {
         if (isMountedRef.current) {
             setIsDbLoading(false);
         }
         requestAnimationFrame(() => {
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
     }
 }, [toast, currentWarehouseId, productToEditDetail, focusBarcodeIfCounting, startTransition, currentUserId]);

 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current || !currentUserId) return;
    if (!productsToCount || productsToCount.length === 0) {
        requestAnimationFrame(() => {
           if(isMountedRef.current) {
            requestAnimationFrame(() => { 
                if (isMountedRef.current) {
                    toast({ title: "Vacío", description: "No hay productos para este proveedor." });
                }
            });
           }
        });
        return;
    }
   const productsWithWarehouseContext: DisplayProduct[] = productsToCount.map(dbProduct => ({
       ...dbProduct,
       warehouseId: currentWarehouseId,
       stock: dbProduct.stock ?? 0,
       count: 0,
       lastUpdated: new Date().toISOString(),
       expirationDate: dbProduct.expirationDate || undefined,
   }));

   if(isMountedRef.current) {
     startTransition(() => {
        setCountingList(prevList => {
            const otherWarehouseItems = prevList.filter(item => item.warehouseId !== currentWarehouseId);
            let itemsForCurrentWarehouse = [...productsWithWarehouseContext];

            const newList = [...itemsForCurrentWarehouse, ...otherWarehouseItems];
              newList.sort((a, b) => {
                    if (a.warehouseId === currentWarehouseId && b.warehouseId !== currentWarehouseId) return -1;
                    if (a.warehouseId !== currentWarehouseId && b.warehouseId === currentWarehouseId) return 1;
                    if (a.warehouseId === currentWarehouseId && b.warehouseId === currentWarehouseId) {
                        return new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime();
                    }
                    return 0;
                });
            return newList;
        });
     });
     setActiveSection("Contador");
     }
     requestAnimationFrame(() => {
        if(isMountedRef.current) {
            requestAnimationFrame(() => { 
                if (isMountedRef.current) {
                    toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` });
                }
            });
        }
     });
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
}, [toast, setActiveSection, currentWarehouseId, focusBarcodeIfCounting, startTransition, currentUserId]);


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
    if (newSection === 'Contador') {
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
    }
  }, [setActiveSection, focusBarcodeIfCounting]);

   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
        if (!isMountedRef.current) return;
         if (newWarehouseId !== currentWarehouseId) {
             startTransition(() => {
                setIsDbLoading(true); 
                setCurrentWarehouseId(newWarehouseId);
                setSearchTerm(""); 
             });
             if (currentUserId) {
                 setLocalStorageItem(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${currentUserId}`, newWarehouseId);
             }
         }
   }, [currentWarehouseId, setCurrentWarehouseId, startTransition, currentUserId]);

    const handleAddWarehouse = useCallback(async (name: string) => {
        if (!isMountedRef.current || !currentUserId || !name.trim()) return;
        
        const generatedId = `wh_${format(new Date(), 'yyyyMMdd_HHmmssSSS')}`;
        const newWarehouse: Warehouse = { id: generatedId, name: name.trim() };

        const isDuplicateName = warehouses.some(warehouse => warehouse.name.toLowerCase() === newWarehouse.name.toLowerCase());
        if (isDuplicateName) {
            requestAnimationFrame(() => {
                toast({ variant: 'destructive', title: 'Error', description: 'Nombre de almacén ya existe.' });
            });
            return;
        }
        try {
            await addOrUpdateWarehouseInFirestore(currentUserId, newWarehouse);
             requestAnimationFrame(() => {
                 toast({title: "Almacén Agregado", description: `Cambiado a: ${newWarehouse.name}`});
             });
             handleWarehouseChange(newWarehouse.id); 
        } catch (error) {
            requestAnimationFrame(() => {
                toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo agregar almacén.' });
            });
        }
   }, [warehouses, currentUserId, handleWarehouseChange, toast]);

   const handleUpdateWarehouse = useCallback(async (warehouseToUpdate: Warehouse) => {
       if (!isMountedRef.current || !currentUserId || !db) return;
       try {
           await addOrUpdateWarehouseInFirestore(currentUserId, warehouseToUpdate);
           requestAnimationFrame(() => toast({ title: `Almacén "${warehouseToUpdate.name}" Actualizado` }));
       } catch (error) {
           requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo actualizar el almacén en la nube.' }));
       }
   }, [toast, currentUserId]);

   const handleDeleteWarehouse = useCallback(async (warehouseIdToDelete: string) => {
       if (!isMountedRef.current || !currentUserId || !db || warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
            if (warehouseIdToDelete === DEFAULT_WAREHOUSE_ID) {
                requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Operación no permitida', description: "Almacén Principal no se puede eliminar." }));
            }
           return;
       }
       try {
           await deleteWarehouseFromFirestore(currentUserId, warehouseIdToDelete);
           requestAnimationFrame(() => toast({ title: "Almacén Eliminado" }));
           if (warehouseIdToDelete === currentWarehouseId) {
               handleWarehouseChange(DEFAULT_WAREHOUSE_ID); 
           }
       } catch (error) {
           requestAnimationFrame(() => toast({ variant: 'destructive', title: 'Error DB', description: 'No se pudo eliminar el almacén de la nube.' }));
       }
   }, [toast, currentUserId, currentWarehouseId, handleWarehouseChange]);


   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        const currentItem = countingList.find(
          p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId
        );
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]);

   const handleClearCatalog = useCallback(async () => {
    if (!isMountedRef.current || !currentUserId) return;
    if(isMountedRef.current) setIsDbLoading(true);
    try {
      await clearProductCatalogInFirestore(currentUserId);
      await clearProductDatabaseInIndexedDB();

      if(isMountedRef.current) {
        setCatalogProducts([]); 
        startTransition(() => { 
            setCountingList(prevList => 
                prevList.map(p => {
                    return {...p, description: `Producto ${p.barcode}`, provider: "Desconocido", stock: 0, expirationDate: undefined};
                })
            );
        });
      }
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { 
                if (isMountedRef.current) {
                    toast({ title: "Catálogos de Productos Borrados" });
                }
            });
          }
      });
    } catch (error: any) {
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { 
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error al Borrar Catálogo", description: `No se pudieron borrar datos: ${error.message}` });
                }
            });
          }
      });
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setIsClearCatalogConfirmOpen(false);
      }
      requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
     });
    }
  }, [toast, currentUserId, focusBarcodeIfCounting, startTransition]);


  const sectionItems = useMemo(() => [
    { name: 'Contador', icon: ClipboardList, label: `Contador (${getWarehouseName(currentWarehouseId)})`},
    { name: 'Catálogo de Productos', icon: PackageSearch, label: 'Catálogo de Productos' },
    { name: 'Almacenes', icon: Boxes, label: 'Almacenes' },
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
            // Clear last used warehouse for the signed-out user
            // No need to clear specific warehouse for 'null' user.
        }
        isInitialWarehouseFetchDoneForUser.current = {}; // Reset for all users
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

  const counterSectionProps = {
    barcode,
    setBarcode,
    onAddProduct: handleAddProduct,
    onRefreshStock: handleRefreshStock,
    isLoading: isDbLoading || isTransitionPending,
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

  const handleLogin = () => {
    if (loginUsername === LOGIN_USER && loginPassword === LOGIN_PASSWORD) {
        if (isMountedRef.current) {
            setCurrentUserId(LOGIN_USER); 
            setIsAuthenticated(true);
            setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, LOGIN_USER);
            const storedWarehouseId = getLocalStorageItem<string>(`${LOCAL_STORAGE_CURRENT_WAREHOUSE_ID_KEY_PREFIX}${LOGIN_USER}`, DEFAULT_WAREHOUSE_ID);
            setCurrentWarehouseId(storedWarehouseId);
            isInitialWarehouseFetchDoneForUser.current[LOGIN_USER] = false; // Reset for this new login session

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
        <h2 className="text-xl font-semibold truncate ml-4">StockCounter Pro</h2>
        <div className="w-8"></div> 
      </div>

      <aside className={cn(
        "hidden md:flex flex-shrink-0 border-r bg-card flex-col transition-all duration-300 ease-in-out",
        isSidebarCollapsed ? "w-20" : "w-60"
      )}>
        <SidebarLayout
          {...sidebarProps}
        />
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
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
          isProcessing={isTransitionPending}
      />

      <ConfirmationDialog
          isOpen={isConfirmQuantityDialogOpen}
          onOpenChange={(open) => {
            setIsConfirmQuantityDialogOpen(open);
            if (!open) {
                setConfirmQuantityProductBarcode(null);
                setConfirmQuantityAction(null);
                setConfirmQuantityNewValue(null);
                requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
            }
          }}
          title="Confirmar Modificación"
          description={
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
              requestAnimationFrame(() => {
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
            if (!open) {
                setProductToDelete(null);
                requestAnimationFrame(() => {
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
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    focusBarcodeIfCounting();
                }
            });
         }}
         isDestructive={true}
         isProcessing={isTransitionPending}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteListDialogOpen(open);
            if (!open) {
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
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    focusBarcodeIfCounting();
                }
            });
          }}
          isDestructive={true}
          isProcessing={isTransitionPending}
      />

        <ConfirmationDialog
            isOpen={isClearCatalogConfirmOpen}
            onOpenChange={(open) => {
                setIsClearCatalogConfirmOpen(open);
                if (!open) {
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
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos del catálogo en Firestore y del catálogo local (IndexedDB) para el usuario '{currentUserId}'.</p>
                    <p>Esta acción no se puede deshacer.</p>
                 </div>
            }
            confirmText="Sí, Borrar Catálogos"
            onConfirm={handleClearCatalog}
            onCancel={() => {
                if(isMountedRef.current) setIsClearCatalogConfirmOpen(false);
                requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
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
                  requestAnimationFrame(() => {
                      if (isMountedRef.current) {
                          focusBarcodeIfCounting();
                      }
                  });
              }
          }}
          selectedDetail={productToEditDetail}
          setSelectedDetail={setProductToEditDetail}
          onSubmit={handleEditDetailSubmit}
          onDelete={ async (barcode) => { 
                if (!isMountedRef.current || !currentUserId) return;
                if(isMountedRef.current) setIsDbLoading(true);
                try {
                    await deleteProductFromCatalog(currentUserId, barcode); 
                    await deleteProductFromIndexedDB(barcode);

                    if (!isMountedRef.current) return;
                    setCatalogProducts(prev => prev.filter(p => p.barcode !== barcode));
                    startTransition(() => {
                        setCountingList(prevList => prevList.filter(p => !(p.barcode === barcode && p.warehouseId === currentWarehouseId)));
                    });
                      requestAnimationFrame(() => {
                        if(isMountedRef.current) {
                          requestAnimationFrame(() => { 
                              if (isMountedRef.current) {
                                  toast({title: "Producto eliminado de catálogos"});
                              }
                          });
                        }
                      });
                    if(isMountedRef.current) {
                      setIsEditDetailDialogOpen(false);
                      setProductToEditDetail(null);
                    }
                } catch (error: any) {
                      if (!isMountedRef.current) return;
                      requestAnimationFrame(() => {
                          if(isMountedRef.current) {
                              requestAnimationFrame(() => { 
                                  if (isMountedRef.current) {
                                      toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
                                  }
                              });
                          }
                      });
                } finally {
                      if (isMountedRef.current) {
                          setIsDbLoading(false);
                      }
                      requestAnimationFrame(() => {
                          if (isMountedRef.current) {
                              focusBarcodeIfCounting();
                          }
                      });
                }
            }}
          isProcessing={isDbLoading || isTransitionPending}
          initialStock={initialStockForEdit}
          context="countingList" 
          warehouseName={getWarehouseName(currentWarehouseId)}
        />
      )}
    </div>
  );
}
    