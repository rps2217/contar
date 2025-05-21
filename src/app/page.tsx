
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
import { Minus, Plus, Trash, RefreshCw, Search, Boxes, Loader2, History as HistoryIcon, CalendarIcon, Save, Edit, Download, BarChart, Settings, AlertTriangle, XCircle, Menu as MenuIcon, User, ShieldAlert, Filter, PanelLeftClose, PanelRightOpen, PackageSearch, CalendarClock, BookOpenText, Users2, ClipboardList, MoreVertical, Warehouse as WarehouseIconLucide } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo, useTransition } from "react";
import { playBeep } from '@/lib/helpers';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { EditProductDialog } from '@/components/edit-product-dialog';
import {
  addOrUpdateProductToDB,
  getProductFromDB,
  getAllProductsFromDB,
  deleteProductFromDB,
  saveCountingHistory,
  clearAllDatabases,
  getCountingHistory,
  clearCountingHistory as clearFullCountingHistory,
} from '@/lib/database';
import { CountingHistoryViewer } from '@/components/counting-history-viewer';
import { DiscrepancyReportViewer } from '@/components/discrepancy-report-viewer';
import { ExpirationControl } from '@/components/expiration-control';
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


// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY = 'stockCounterPro_sidebarCollapsed';
const LOCAL_STORAGE_USER_ID_KEY = 'stockCounterPro_userId';
const LOCAL_STORAGE_SAVE_DEBOUNCE_MS = 500;
const LAST_SCANNED_BARCODE_TIMEOUT_MS = 300;

// --- Main Component ---

export default function Home() {
  // --- Refs ---
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(false);
  const lastScannedTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- React Transition Hook ---
  const [isTransitionPending, startTransition] = useTransition();


  // --- LocalStorage Hooks ---
  const [warehouses, setWarehouses] = useLocalStorage<Array<Warehouse>>(
      LOCAL_STORAGE_WAREHOUSES_KEY,
      [{ id: 'main', name: 'Almacén Principal' }]
  );
  const [currentWarehouseId, setCurrentWarehouseId] = useLocalStorage<string>(
      LOCAL_STORAGE_WAREHOUSE_KEY,
      warehouses[0]?.id || 'main'
  );
  const [activeSection, setActiveSection] = useLocalStorage<string>(
      LOCAL_STORAGE_ACTIVE_SECTION_KEY,
      'Contador'
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage<boolean>(
    LOCAL_STORAGE_SIDEBAR_COLLAPSED_KEY,
    false
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showUserIdInput, setShowUserIdInput] = useState(false);


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
  const [isClearAllDataConfirmOpen, setIsClearAllDataConfirmOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const isMobile = useIsMobile();


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
        }, 100); // Adjusted to 100ms
    }
  }, [activeSection]);

  // --- Effects ---

 useEffect(() => {
    isMountedRef.current = true;
    const storedUserId = getLocalStorageItem<string | null>(LOCAL_STORAGE_USER_ID_KEY, null);
    if (storedUserId) {
        setCurrentUserId(storedUserId);
    } else {
        const newUserId = `user_${Math.random().toString(36).substring(2, 11)}`;
        setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, newUserId);
        setCurrentUserId(newUserId);
        if (isMountedRef.current) {
          requestAnimationFrame(() => {
             if (isMountedRef.current) {
                toast({title: "ID de Usuario", description: `ID de usuario generado: ${newUserId}. Puedes cambiarlo en la barra lateral.`});
             }
          });
        }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBarcodeIfCounting]);

  useEffect(() => {
      if (isMountedRef.current && currentUserId !== null) {
          setLocalStorageItem(LOCAL_STORAGE_USER_ID_KEY, currentUserId);
      }
  }, [currentUserId]);


  useEffect(() => {
    if (!currentWarehouseId || !isMountedRef.current) {
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
        if (savedList === null || (Array.isArray(savedList) && savedList.length > 0)) {
             // console.warn(`Invalid data structure in localStorage for warehouse ${currentWarehouseId}. Clearing.`);
        }
        if(typeof window !== 'undefined') localStorage.removeItem(savedListKey);
        if(isMountedRef.current) setCountingList([]);
    }
    if(isMountedRef.current) setIsDbLoading(false);
 }, [currentWarehouseId, currentUserId]);

 const debouncedSaveCountingList = useMemo(
    () =>
      debounce((list: DisplayProduct[], warehouseId: string, userId: string | null) => {
        if (!warehouseId || !isMountedRef.current || !userId) return;
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}_${userId}`;
        const listToSave = list.filter(item => item.warehouseId === warehouseId);
        setLocalStorageItem(key, listToSave);
      }, LOCAL_STORAGE_SAVE_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    if (!isDbLoading && isMountedRef.current && currentWarehouseId && currentUserId) {
      debouncedSaveCountingList(countingList, currentWarehouseId, currentUserId);
    }
    return () => {
       debouncedSaveCountingList.clear?.();
    };
  }, [countingList, currentWarehouseId, isDbLoading, debouncedSaveCountingList, currentUserId]);


  // --- Helper Functions ---
  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
        if (!warehouseId) return 'N/A';
        const warehouse = warehouses.find(w => w.id === warehouseId);
        return warehouse ? warehouse.name : `Almacén (${warehouseId})`;
  }, [warehouses]);

  const showDiscrepancyToastIfNeeded = useCallback((product: DisplayProduct, newCountVal?: number) => {
    const countToCheck = newCountVal !== undefined ? newCountVal : (product.count ?? 0);
    const stockToCheck = product.stock ?? 0;

    if (stockToCheck > 0 && countToCheck !== stockToCheck) {
        if (isMountedRef.current && activeSection !== 'Contador') { // Only show toast if not in Counter section
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
        return true; // Still return true to indicate discrepancy for other logic
    }
    return false;
  }, [toast, activeSection]);


  // --- Callbacks ---

 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    if (!isMountedRef.current) return;

    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      if(isMountedRef.current) {
        requestAnimationFrame(() => {
            if (isMountedRef.current) {
                toast({ variant: "default", title: "Código vacío", description: "Por favor, introduce un código de barras." });
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
    if (!currentWarehouseId) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén." });
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

    let descriptionForToast = '';

    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
        const productToUpdate = countingList[existingProductIndex];
        descriptionForToast = productToUpdate.description;
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
        if(isMountedRef.current) setIsDbLoading(true);
        let newProductForList: DisplayProduct | null = null;
        try {
            const dbProduct = await getProductFromDB(trimmedBarcode);
            if (dbProduct) {
                newProductForList = {
                    ...dbProduct,
                    description: dbProduct.description || `Producto ${trimmedBarcode}`,
                    provider: dbProduct.provider || "Desconocido",
                    stock: dbProduct.stock ?? 0,
                    warehouseId: currentWarehouseId,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                    expirationDate: dbProduct.expirationDate || undefined,
                };
                playBeep(660, 150);
                showDiscrepancyToastIfNeeded(newProductForList);

            } else {
                descriptionForToast = `Producto desconocido ${trimmedBarcode}`;
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
                                description: `Producto ${trimmedBarcode} no encontrado. Agregado temporalmente. Edita en 'Catálogo de Productos'.`,
                            });
                        }
                    });
                }
            }
             if (isMountedRef.current && newProductForList) {
                 const finalProduct = newProductForList;
                 startTransition(() => {
                    setCountingList(currentList => [finalProduct, ...currentList.filter(item => !(item.barcode === finalProduct.barcode && item.warehouseId === currentWarehouseId))]);
                 });
             }
        } catch (error) {
            console.error("Error fetching or adding product from IndexedDB:", error);
            if(isMountedRef.current) {
                requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo verificar o agregar el producto." });
                    }
                });
            }
            playBeep(440, 300);
        } finally {
             if (isMountedRef.current) setIsDbLoading(false);
        }
    }
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            setBarcode("");
            focusBarcodeIfCounting();
        }
    });
  }, [barcode, currentWarehouseId, lastScannedBarcode, toast, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition]);


const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current) return;

    let productDescription = '';
    let finalValue: number | undefined;
    let needsConfirmation = false;
    let productForToast: DisplayProduct | null = null;

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);

    if (productIndexInList === -1) {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error", description: `Producto ${barcodeToUpdate} no encontrado en la lista para ${getWarehouseName(currentWarehouseId)}.`});
                }
            });
        }
         return;
    }
    
    const productInList = countingList[productIndexInList];
    productDescription = productInList.description;
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
                    const dbProduct = await getProductFromDB(barcodeToUpdate);
                    if (dbProduct) {
                        const updatedDbProduct: ProductDetail = { ...dbProduct, stock: finalValue };
                        await addOrUpdateProductToDB(updatedDbProduct);
                        if(isMountedRef.current) {
                            requestAnimationFrame(() => {
                               if (isMountedRef.current) {
                                    toast({
                                         title: `Stock Actualizado`,
                                         description: `Stock de ${productDescription} actualizado a ${finalValue}.`
                                     });
                                }
                            });
                        }
                    } else {
                          const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                          if(listProduct) { 
                               const newDbProduct: ProductDetail = {
                                    barcode: listProduct.barcode,
                                    description: listProduct.description,
                                    provider: listProduct.provider,
                                    stock: finalValue,
                                    expirationDate: listProduct.expirationDate,
                                };
                                await addOrUpdateProductToDB(newDbProduct);
                                if(isMountedRef.current) {
                                    requestAnimationFrame(() => {
                                       if (isMountedRef.current) {
                                            toast({
                                                 title: `Stock Establecido`,
                                                 description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock}.`
                                             });
                                        }
                                    });
                                }
                          }
                    }
                } catch (error) {
                    if(isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({
                                    variant: "destructive",
                                    title: "Error DB",
                                    description: `No se pudo actualizar el stock en la base de datos para ${productDescription}.`
                                });
                            }
                        });
                    }
                }
            } else if (type === 'count' && productForToast ) {
                 if (!showDiscrepancyToastIfNeeded(productForToast, finalValue)) {
                    // No explicit toast here
                 }
            }
        }
    }
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
  }, [currentWarehouseId, getWarehouseName, toast, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition]);


const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
    if (!isMountedRef.current) return;
    if (newValue < 0 || isNaN(newValue)) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Valor Inválido", description: "La cantidad o stock debe ser un número positivo." });
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

    let productDescription = '';
    let finalValue: number | undefined;
    let needsConfirmation = false;
    let productForToast: DisplayProduct | null = null;

    const productIndexInList = countingList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
    if (productIndexInList === -1) return;

    const productInList = countingList[productIndexInList];
    productDescription = productInList.description;
    const originalValue = type === 'count' ? productInList.count ?? 0 : productInList.stock ?? 0;
    
    // Optimization: If setting count (not summing) and new value is same as original, do nothing.
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
                     const dbProduct = await getProductFromDB(barcodeToUpdate);
                     if (dbProduct) {
                         const updatedDbProduct: ProductDetail = { ...dbProduct, stock: finalValue };
                         await addOrUpdateProductToDB(updatedDbProduct);
                          if(isMountedRef.current) {
                            requestAnimationFrame(() => {
                                if (isMountedRef.current) {
                                    toast({
                                      title: `Stock Actualizado`,
                                      description: `Stock de ${productDescription} actualizado a ${finalValue}.`
                                    });
                                }
                            });
                          }
                     } else {
                           const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                           if(listProduct) {
                                const newDbProduct: ProductDetail = {
                                     barcode: listProduct.barcode,
                                     description: listProduct.description,
                                     provider: listProduct.provider,
                                     stock: finalValue,
                                     expirationDate: listProduct.expirationDate,
                                 };
                                 await addOrUpdateProductToDB(newDbProduct);
                                  if(isMountedRef.current) {
                                    requestAnimationFrame(() => {
                                       if (isMountedRef.current) {
                                            toast({
                                                title: `Stock Establecido`,
                                                description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock}.`
                                            });
                                        }
                                    });
                                  }
                           }
                     }
                 } catch (error) {
                     if(isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({
                                    variant: "destructive",
                                    title: "Error DB",
                                    description: `No se pudo actualizar el stock en la base de datos para ${productDescription}.`
                                });
                            }
                        });
                     }
                 }
             } else if (type === 'count' && productForToast) {
                 const actionText = sumValue ? "sumada a" : "establecida en";
                 if (!showDiscrepancyToastIfNeeded(productForToast, finalValue)) {
                     if(isMountedRef.current) {
                        requestAnimationFrame(() => {
                            if (isMountedRef.current) {
                                toast({
                                    title: "Cantidad Modificada",
                                    description: `Cantidad de ${productDescription} (${getWarehouseName(currentWarehouseId)}) ${actionText} ${finalValue}.`,
                                });
                            }
                        });
                     }
                 }
             }
         }
     }
     requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
}, [currentWarehouseId, getWarehouseName, toast, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition]);


  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, 1);
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1);
  }, [modifyProductValue]);


 const handleConfirmQuantityChange = useCallback(() => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null) {
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
     let productDescription = '';
     let confirmedValue: number | null = null;
     let productAfterConfirm: DisplayProduct | null = null;

     const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
     if (productInList) {
         productDescription = productInList.description;
     } else {
         productDescription = barcodeToUpdate;
     }
     
     startTransition(() => {
        setCountingList(prevList => {
            const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
            if (index === -1) return prevList;

            const listCopy = [...prevList];
            const productToUpdateCopy = { ...listCopy[index] };
            const finalConfirmedCount = Math.max(0, newValue);
            confirmedValue = finalConfirmedCount; 

            productAfterConfirm = {
                ...productToUpdateCopy,
                count: finalConfirmedCount,
                lastUpdated: new Date().toISOString()
            };
            listCopy[index] = productAfterConfirm;
            return [productAfterConfirm, ...listCopy.filter((item, i) => i !== index)];
        });
     });

    requestAnimationFrame(() => {
        if (productInList && confirmedValue !== null && isMountedRef.current) { 
            const tempProductForToast = {...productInList, count: confirmedValue};
            if (!showDiscrepancyToastIfNeeded(tempProductForToast, confirmedValue)) {
                requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        toast({
                            title: "Cantidad Modificada",
                            description: `Cantidad de ${productDescription} (${getWarehouseName(warehouseId)}) cambiada a ${confirmedValue}.`
                        });
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
 }, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, getWarehouseName, countingList, showDiscrepancyToastIfNeeded, focusBarcodeIfCounting, startTransition]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         if(isMountedRef.current) setProductToDelete(product);
         if(isMountedRef.current) setIsDeleteDialogOpen(true);
  }, []);

 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete) return;

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
                        description: `"${descriptionForToast}" se eliminó de la lista actual.`,
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
 }, [productToDelete, toast, getWarehouseName, focusBarcodeIfCounting, startTransition]);

 const handleClearCurrentList = useCallback(() => {
     if (!isMountedRef.current || !currentWarehouseId) return;
     if(isMountedRef.current) {
        startTransition(() => {
            setCountingList(prevList => prevList.filter(p => p.warehouseId !== currentWarehouseId));
        });
     }
     requestAnimationFrame(() => {
         if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({
                        title: "Lista Actual Borrada",
                        description: `Se han eliminado todos los productos del inventario para ${getWarehouseName(currentWarehouseId)}.`,
                        variant: "default"
                    });
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
 }, [currentWarehouseId, getWarehouseName, toast, focusBarcodeIfCounting, startTransition]);

 const handleExport = useCallback(() => {
     const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
     if (currentWarehouseList.length === 0) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ title: "Vacío", description: "No hay productos en el inventario actual para exportar." });
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
                    toast({ title: "Exportado", description: `Inventario para ${getWarehouseName(currentWarehouseId)} exportado a ${fileName}.` });
                }
            });
        }
    } catch (error) {
        console.error("Error exporting inventory:", error);
        if(isMountedRef.current) {
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
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
    if (!isMountedRef.current) return;
    const currentListForWarehouse = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (currentListForWarehouse.length === 0) {
        if (!hideToast && isMountedRef.current) {
             requestAnimationFrame(() => {
                 if(isMountedRef.current) {
                    requestAnimationFrame(() => { 
                        if (isMountedRef.current) {
                            toast({ title: "Vacío", description: "No hay productos en el inventario actual para guardar en el historial." });
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
            id: new Date().toISOString(),
            userId: currentUserId || undefined,
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
                            toast({ title: "Historial Guardado", description: `Conteo para ${currentWHName} (Usuario: ${currentUserId || 'N/A'}) guardado.` });
                        }
                    });
                }
            });
        }
    } catch (error: any) {
        console.error("Error saving counting history:", error);
         if (!hideToast && isMountedRef.current) {
             requestAnimationFrame(() => {
                 if(isMountedRef.current) {
                    requestAnimationFrame(() => { 
                        if (isMountedRef.current) {
                            toast({ variant: "destructive", title: "Error al Guardar Historial", description: error.message || "Ocurrió un error inesperado." });
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
     if (!currentWarehouseId || !isMountedRef.current) return;
     if(isMountedRef.current) setIsRefreshingStock(true);
     let updatedProductCount = 0;
     let addedProductCount = 0;
     try {
         const allDbProducts = await getAllProductsFromDB();
         const dbProductMap = new Map(allDbProducts.map(p => [p.barcode, p]));

         if(isMountedRef.current) {
            startTransition(() => {
                setCountingList(prevCountingList => {
                    const currentWarehouseItems = prevCountingList.filter(item => item.warehouseId === currentWarehouseId);
                    const otherWarehouseItems = prevCountingList.filter(item => item.warehouseId !== currentWarehouseId);

                    updatedProductCount = 0;
                    addedProductCount = 0;

                    let updatedCurrentWarehouseList = currentWarehouseItems.map(countingProduct => {
                        const dbProduct = dbProductMap.get(countingProduct.barcode);
                        if (dbProduct) {
                            if (countingProduct.description !== dbProduct.description ||
                                countingProduct.provider !== dbProduct.provider ||
                                countingProduct.stock !== (dbProduct.stock ?? 0) ||
                                countingProduct.expirationDate !== (dbProduct.expirationDate || undefined)
                               )
                            {
                                updatedProductCount++;
                                return {
                                    ...countingProduct,
                                    description: dbProduct.description,
                                    provider: dbProduct.provider,
                                    stock: dbProduct.stock ?? 0,
                                    expirationDate: dbProduct.expirationDate || undefined,
                                    lastUpdated: new Date().toISOString(),
                                };
                            }
                        }
                        return countingProduct;
                    });

                     allDbProducts.forEach(dbProduct => {
                         if (!updatedCurrentWarehouseList.some(cp => cp.barcode === dbProduct.barcode)) {
                             addedProductCount++;
                             updatedCurrentWarehouseList.push({
                                 ...dbProduct,
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
                        toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) y ${addedProductCount} agregado(s) desde la base de datos para ${getWarehouseName(currentWarehouseId)}.` });
                    }
                });
              }
          });

     } catch (error) {
         console.error(`Error refreshing stock and details for warehouse ${currentWarehouseId}:`, error);
          requestAnimationFrame(() => {
              if(isMountedRef.current) {
                requestAnimationFrame(() => { 
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar los datos desde la base de datos local para ${getWarehouseName(currentWarehouseId)}. ` });
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
 }, [currentWarehouseId, toast, getWarehouseName, focusBarcodeIfCounting, startTransition]);


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
     if (!product || !product.barcode || !isMountedRef.current) return;
     if(isMountedRef.current) setIsDbLoading(true);
     try {
         const dbProduct = await getProductFromDB(product.barcode);
         if (dbProduct) {
             if (!isMountedRef.current) return;
             setProductToEditDetail(dbProduct);
             setInitialStockForEdit(dbProduct.stock ?? 0);
             setIsEditDetailDialogOpen(true);
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
                            toast({ variant: "default", title: "Editando Producto Temporal", description: "Este producto no está en la base de datos. Guarde los cambios para añadirlo." });
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
                        toast({ variant: "destructive", title: "Error DB", description: "No se pudieron obtener los datos del producto para editar." });
                    }
                });
            }
         });
     } finally {
         if (isMountedRef.current) {
            setIsDbLoading(false);
         }
     }
 }, [toast]);

 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
     if (!isMountedRef.current || !productToEditDetail) return;
     if(isMountedRef.current) setIsDbLoading(true);
     try {
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode,
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
             expirationDate: data.expirationDate || undefined,
         };
         await addOrUpdateProductToDB(updatedProductData);
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
                        toast({
                            title: "Producto Actualizado",
                        });
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
             if(isMountedRef.current) {
                requestAnimationFrame(() => { 
                    if (isMountedRef.current) {
                        toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
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
 }, [toast, currentWarehouseId, productToEditDetail, focusBarcodeIfCounting, startTransition]);

 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
    if (!isMountedRef.current) return;
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
                    toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para ${getWarehouseName(currentWarehouseId)}.` });
                }
            });
        }
     });
    requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
    });
}, [toast, setActiveSection, currentWarehouseId, getWarehouseName, focusBarcodeIfCounting, startTransition]);


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
         if (newWarehouseId !== currentWarehouseId) {
             if(isMountedRef.current) setIsDbLoading(true);
             if(isMountedRef.current) setCurrentWarehouseId(newWarehouseId);
             if(isMountedRef.current) setSearchTerm("");
         }
         requestAnimationFrame(() => {
            if (isMountedRef.current) {
                focusBarcodeIfCounting();
            }
        });
   }, [currentWarehouseId, setCurrentWarehouseId, focusBarcodeIfCounting]);

   const handleAddWarehouse = useCallback((newWarehouse: { id: string; name: string }) => {
        if(isMountedRef.current) {
            setWarehouses(prevWarehouses => {
                const isDuplicate = prevWarehouses.some(warehouse => warehouse.id === newWarehouse.id);
                if (isDuplicate) {
                    requestAnimationFrame(() => {
                       if(isMountedRef.current) {
                        requestAnimationFrame(() => { 
                            if (isMountedRef.current) {
                                toast({ variant: 'destructive', title: 'Error', description: 'ID de almacén ya existe.' });
                            }
                        });
                       }
                    });
                    return prevWarehouses;
                }
                const updatedWarehouses = [...prevWarehouses, newWarehouse];
                handleWarehouseChange(newWarehouse.id);
                requestAnimationFrame(() => {
                    if(isMountedRef.current) {
                        requestAnimationFrame(() => { 
                            if (isMountedRef.current) {
                                toast({title: "Almacén Agregado", description: `Cambiado al nuevo almacén: ${newWarehouse.name}`});
                            }
                        });
                    }
                 });
                return updatedWarehouses;
            });
        }
   }, [setWarehouses, handleWarehouseChange, toast]);

   const handleUpdateWarehouses = useCallback((updatedWarehouses: { id: string; name: string }[]) => {
        if(isMountedRef.current) setWarehouses(updatedWarehouses);
         if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
             const newCurrentId = updatedWarehouses[0]?.id || 'main';
             if (newCurrentId !== currentWarehouseId) {
                 handleWarehouseChange(newCurrentId);
                  requestAnimationFrame(() => {
                     if(isMountedRef.current) {
                        requestAnimationFrame(() => { 
                            if (isMountedRef.current) {
                                toast({title: "Almacén Actualizado", description: `Almacén actual cambiado a ${getWarehouseName(newCurrentId)}.`});
                            }
                        });
                     }
                  });
             } else if (updatedWarehouses.length === 0) {
                  const defaultWarehouse = { id: 'main', name: 'Almacén Principal' };
                  if(isMountedRef.current) setWarehouses([defaultWarehouse]);
                  handleWarehouseChange(defaultWarehouse.id);
                   requestAnimationFrame(() => {
                      if(isMountedRef.current) {
                        requestAnimationFrame(() => { 
                            if (isMountedRef.current) {
                                toast({title: "Almacenes Actualizados", description: "Se restauró el almacén principal."});
                            }
                        });
                      }
                   });
             }
         }
   }, [currentWarehouseId, setWarehouses, handleWarehouseChange, toast, getWarehouseName]);

   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        const currentItem = countingList.find(
          p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId
        );
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]);

   const handleClearAllData = useCallback(async () => {
    if (!isMountedRef.current) return;
    if(isMountedRef.current) setIsDbLoading(true);
    try {
      await clearAllDatabases();
      warehouses.forEach(warehouse => {
        if(typeof window !== 'undefined') localStorage.removeItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouse.id}_${currentUserId}`);
      });
      if(isMountedRef.current) {
        startTransition(() => {
            setCountingList([]);
        });
      }
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { 
                if (isMountedRef.current) {
                    toast({ title: "Base de Datos Borrada", description: "Todos los productos, el historial de conteos y las listas de inventario locales han sido eliminados." });
                }
            });
          }
      });
    } catch (error: any) {
      requestAnimationFrame(() => {
          if(isMountedRef.current) {
            requestAnimationFrame(() => { 
                if (isMountedRef.current) {
                    toast({ variant: "destructive", title: "Error al Borrar", description: `No se pudo borrar la base de datos: ${error.message}` });
                }
            });
          }
      });
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
        setIsClearAllDataConfirmOpen(false);
      }
      requestAnimationFrame(() => {
        if (isMountedRef.current) {
            focusBarcodeIfCounting();
        }
     });
    }
  }, [toast, warehouses, currentUserId, focusBarcodeIfCounting, startTransition]);


  const sectionItems = useMemo(() => [
    { name: 'Contador', icon: ClipboardList, label: `Contador (${getWarehouseName(currentWarehouseId)})`},
    { name: 'Catálogo de Productos', icon: PackageSearch, label: 'Catálogo de Productos' },
    { name: 'Almacenes', icon: Boxes, label: 'Almacenes' },
    { name: 'Gestión de Vencimientos', icon: CalendarClock, label: 'Gestión de Vencimientos' },
    { name: 'Historial', icon: HistoryIcon, label: 'Historial' },
    { name: 'Informes', icon: BarChart, label: 'Informes' },
  ], [getWarehouseName, currentWarehouseId]);

  const sidebarProps = {
    activeSection,
    sectionItems,
    currentUserId: currentUserId || "",
    setCurrentUserId,
    showUserIdInput,
    setShowUserIdInput,
    warehouses,
    currentWarehouseId,
    handleWarehouseChange,
    getWarehouseName,
    isDbLoading,
  };

  const counterSectionProps = {
    barcode,
    setBarcode,
    onAddProduct: handleAddProduct,
    onRefreshStock: handleRefreshStock,
    isLoading: isDbLoading || isTransitionPending || isRefreshingStock,
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


  // --- Main Component Render ---
  return (
    <div className="flex flex-col md:flex-row h-screen bg-background text-foreground">
      {/* Mobile Header & Sheet */}
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
              isMobileView={true}
              isCollapsed={false}
              onSectionChange={(section) => {
                handleSectionChange(section);
                setMobileSheetOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
        <h2 className="text-xl font-semibold truncate ml-4">StockCounter Pro</h2>
        <div className="w-8"></div>
      </div>

      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-shrink-0 border-r bg-card flex-col transition-all duration-300 ease-in-out",
        isSidebarCollapsed ? "w-20" : "w-60"
      )}>
        <SidebarLayout
          {...sidebarProps}
          isMobileView={false}
          isCollapsed={isSidebarCollapsed}
          onSectionChange={handleSectionChange}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 overflow-y-auto">
        {activeSection === 'Contador' && <CounterSection {...counterSectionProps} />}

         {activeSection === 'Catálogo de Productos' && (
            <div id="database-content">
               <ProductDatabase
                  onStartCountByProvider={handleStartCountByProvider}
                  isTransitionPending={isTransitionPending}
               />
            </div>
         )}

          {activeSection === 'Almacenes' && (
             <div id="warehouses-content">
                 <WarehouseManagement
                    warehouses={warehouses}
                    onAddWarehouse={handleAddWarehouse}
                    onUpdateWarehouses={handleUpdateWarehouses}
                    onClearDatabaseRequest={() => {if(isMountedRef.current) setIsClearAllDataConfirmOpen(true)}}
                  />
             </div>
           )}

            {activeSection === 'Gestión de Vencimientos' && (
                 <div id="expiration-control-content">
                    <ExpirationControl />
                 </div>
            )}

            {activeSection === 'Historial' && (
                <div id="history-content">
                    <CountingHistoryViewer
                        getWarehouseName={getWarehouseName}
                        currentUserId={currentUserId || undefined}
                    />
                </div>
            )}

           {activeSection === 'Informes' && (
                <div id="discrepancy-report-content">
                    <DiscrepancyReportViewer
                        getWarehouseName={getWarehouseName}
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
            isOpen={isClearAllDataConfirmOpen}
            onOpenChange={(open) => {
                setIsClearAllDataConfirmOpen(open);
                if (!open) {
                    requestAnimationFrame(() => {
                        if (isMountedRef.current) {
                            focusBarcodeIfCounting();
                        }
                    });
                }
            }}
            title="Confirmar Borrado Completo"
            description={
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-destructive">
                         <AlertTriangle className="h-5 w-5"/>
                         <span className="font-semibold">¡Acción Irreversible!</span>
                    </div>
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos de la base de datos y <span className="font-bold">TODO</span> el historial de conteos.</p>
                    <p>Esta acción no se puede deshacer.</p>
                 </div>
            }
            confirmText="Sí, Borrar Todo"
            onConfirm={handleClearAllData}
            onCancel={() => {
                if(isMountedRef.current) setIsClearAllDataConfirmOpen(false);
                requestAnimationFrame(() => {
                    if (isMountedRef.current) {
                        focusBarcodeIfCounting();
                    }
                });
            }}
            isDestructive={true}
            isProcessing={isDbLoading || isTransitionPending}
        />

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
              if (!isMountedRef.current) return;
               if(isMountedRef.current) setIsDbLoading(true);
               try {
                   await deleteProductFromDB(barcode);
                   if (!isMountedRef.current) return;
                   startTransition(() => {
                       setCountingList(prevList => prevList.filter(p => !(p.barcode === barcode && p.warehouseId === currentWarehouseId)));
                   });
                    requestAnimationFrame(() => {
                       if(isMountedRef.current) {
                        requestAnimationFrame(() => { 
                            if (isMountedRef.current) {
                                toast({title: "Producto eliminado de DB"});
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
    </div>
  );
}


