// src/app/page.tsx
"use client";

import type { DisplayProduct, ProductDetail, CountingHistoryEntry } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem, debounce } from "@/lib/utils";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
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
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale'; // Import Spanish locale for date formatting
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, AlertCircle, Search, Check, AppWindow, Database, Boxes, Loader2, History as HistoryIcon, CalendarIcon, Save, Edit, Download, BarChart, Settings, AlertTriangle, Camera } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { playBeep } from '@/lib/helpers';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
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
  clearCountingHistory,
} from '@/lib/database';
import { CountingHistoryViewer } from '@/components/counting-history-viewer';
import { DiscrepancyReportViewer } from '@/components/discrepancy-report-viewer';
import Papa from 'papaparse';

// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_SAVE_DEBOUNCE_MS = 500;

// --- Main Component ---

export default function Home() {
  // --- Refs ---
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(false);

  // --- LocalStorage Hooks ---
  const [warehouses, setWarehouses] = useLocalStorage<Array<{ id: string; name: string }>>(
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

  // --- Effects ---

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!currentWarehouseId || !isMountedRef.current) {
        setIsDbLoading(false);
        setCountingList([]);
        return;
    }
    setIsDbLoading(true);
    const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`;
    let savedList: DisplayProduct[] = getLocalStorageItem<DisplayProduct[]>(savedListKey, []);

    if (Array.isArray(savedList) && savedList.every(item => typeof item?.barcode === 'string')) {
        const loadedList = savedList
            .map(item => ({
                ...item,
                stock: item.stock ?? 0,
                count: item.count ?? 0,
                lastUpdated: item.lastUpdated || new Date().toISOString(),
                warehouseId: item.warehouseId || currentWarehouseId
            }));
        setCountingList(loadedList.filter(item => item.warehouseId === currentWarehouseId));
    } else {
        if (savedList === null || (Array.isArray(savedList) && savedList.length > 0)) { // Only warn if data was present but invalid
             console.warn(`Invalid data structure in localStorage for warehouse ${currentWarehouseId}. Clearing.`);
        }
        localStorage.removeItem(savedListKey);
        setCountingList([]);
    }
    setIsDbLoading(false);
 }, [currentWarehouseId]);

 const debouncedSaveCountingList = useMemo(
    () =>
      debounce((list: DisplayProduct[], warehouseId: string) => {
        if (!warehouseId || !isMountedRef.current) return;
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}`;
        const listToSave = list.filter(item => item.warehouseId === warehouseId);
        setLocalStorageItem(key, listToSave);
      }, LOCAL_STORAGE_SAVE_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    if (!isDbLoading && isMountedRef.current && currentWarehouseId) {
      debouncedSaveCountingList(countingList, currentWarehouseId);
    }
    return () => {
       debouncedSaveCountingList.clear?.();
    };
  }, [countingList, currentWarehouseId, isDbLoading, debouncedSaveCountingList]);


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
        toast({
            title: "Alerta de Discrepancia",
            description: `${product.description}: Contado ${countToCheck}, Stock ${stockToCheck}.`,
            variant: "default",
            duration: 6000,
        });
        return true;
    }
    return false;
  }, [toast]);


  // --- Callbacks ---

 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    if (!isMountedRef.current) return;

    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

    if (!trimmedBarcode) {
      toast({ variant: "default", title: "Código vacío", description: "Por favor, introduce un código de barras." });
      setBarcode("");
      requestAnimationFrame(() => barcodeInputRef.current?.focus());
      return;
    }
    if (!currentWarehouseId) {
        toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén." });
        return;
    }

     if (trimmedBarcode === lastScannedBarcode) {
         setBarcode("");
         requestAnimationFrame(() => barcodeInputRef.current?.focus());
         return;
     }
     setLastScannedBarcode(trimmedBarcode);
     const clearLastScannedTimeout = setTimeout(() => {
         if (isMountedRef.current) setLastScannedBarcode(null);
     }, 800);

    let descriptionForToast = '';
    let productWasInList = false;

    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
        productWasInList = true;
        const productToUpdate = countingList[existingProductIndex];
        descriptionForToast = productToUpdate.description;
        const newCount = (productToUpdate.count ?? 0) + 1;

        const productStock = productToUpdate.stock ?? 0;
        const originalCount = productToUpdate.count ?? 0;
        const needsConfirmation = newCount > productStock && originalCount <= productStock && productStock > 0;

        if (needsConfirmation) {
             setConfirmQuantityProductBarcode(productToUpdate.barcode);
             setConfirmQuantityAction('increment');
             setConfirmQuantityNewValue(newCount);
             setIsConfirmQuantityDialogOpen(true);
             playBeep(660, 100);
        } else {
            const updatedProductData: DisplayProduct = {
                ...productToUpdate,
                count: newCount,
                lastUpdated: new Date().toISOString(),
            };
            setCountingList(currentList => [updatedProductData, ...currentList.filter((_, index) => index !== existingProductIndex)]);
            playBeep(880, 100);
            if (!showDiscrepancyToastIfNeeded(updatedProductData, newCount)) {
                toast({ title: "Cantidad aumentada", description: `${descriptionForToast} cantidad aumentada a ${newCount}.` });
            }
        }
    } else {
        setIsDbLoading(true);
        let newProductForList: DisplayProduct | null = null;
        try {
            const dbProduct = await getProductFromDB(trimmedBarcode);
            if (dbProduct) {
                newProductForList = {
                    ...dbProduct,
                    warehouseId: currentWarehouseId,
                    stock: dbProduct.stock ?? 0,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(660, 150);
                const discrepancyShown = showDiscrepancyToastIfNeeded(newProductForList);
                let message = `${newProductForList.description} agregado al inventario (${getWarehouseName(currentWarehouseId)}).`;
                if (discrepancyShown && newProductForList.stock > 0) message += " Se detectó una discrepancia inicial."
                toast({ title: "Producto agregado", description: message });

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
                };
                playBeep(440, 300);
                toast({
                    variant: "destructive",
                    title: "Producto Desconocido",
                    description: `Producto ${trimmedBarcode} no encontrado. Agregado temporalmente. Edita en 'Base de Datos'.`,
                    duration: 7000,
                });
            }
             if (isMountedRef.current && newProductForList) {
                 const finalProduct = newProductForList;
                 setCountingList(currentList => [finalProduct, ...currentList]);
             }
        } catch (error) {
            console.error("Error fetching or adding product from IndexedDB:", error);
            toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo verificar o agregar el producto." });
            playBeep(440, 300);
        } finally {
             if (isMountedRef.current) setIsDbLoading(false);
        }
    }
    setBarcode("");
    requestAnimationFrame(() => barcodeInputRef.current?.focus());
    return () => clearTimeout(clearLastScannedTimeout);
  }, [barcode, currentWarehouseId, getWarehouseName, lastScannedBarcode, toast, countingList, showDiscrepancyToastIfNeeded]);


const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current) return;

    let productDescription = '';
    let finalValue: number | undefined;
    let needsConfirmation = false;
    let toastTitle = '';
    let toastDescription = '';
    let productForToast: DisplayProduct | null = null;

    setCountingList(prevList => {
        const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
        if (productIndex === -1) {
             return prevList;
        }

        const product = prevList[productIndex];
        productForToast = product; // Store for toast
        productDescription = product.description;
        const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
        finalValue = Math.max(0, originalValue + change);
        const productStock = product.stock ?? 0;

        needsConfirmation = type === 'count' && change > 0 && finalValue > productStock && originalValue <= productStock && productStock > 0;

        if (needsConfirmation) {
            setConfirmQuantityProductBarcode(product.barcode);
            setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
            setConfirmQuantityNewValue(finalValue);
            setIsConfirmQuantityDialogOpen(true);
            return prevList;
        } else {
            const updatedProduct = {
                 ...product,
                 [type]: finalValue,
                 lastUpdated: new Date().toISOString()
            };
            productForToast = updatedProduct; // Update for toast
            const listWithoutProduct = prevList.filter((_, i) => i !== productIndex);
            return [updatedProduct, ...listWithoutProduct];
        }
    });

    if (!needsConfirmation && finalValue !== undefined && productForToast) {
        if (type === 'stock') {
            try {
                const dbProduct = await getProductFromDB(barcodeToUpdate);
                if (dbProduct) {
                    const updatedDbProduct: ProductDetail = { ...dbProduct, stock: finalValue };
                    await addOrUpdateProductToDB(updatedDbProduct);
                    toast({
                         title: `Stock (DB) Actualizado`,
                         description: `Stock de ${productDescription} actualizado a ${finalValue} en la base de datos.`
                     });
                } else {
                      const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                      if(listProduct) {
                           const newDbProduct: ProductDetail = {
                                barcode: listProduct.barcode,
                                description: listProduct.description,
                                provider: listProduct.provider,
                                stock: finalValue
                            };
                            await addOrUpdateProductToDB(newDbProduct);
                            toast({
                                 title: `Stock (DB) Establecido`,
                                 description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock} en la base de datos.`
                             });
                      }
                }
            } catch (error) {
                toast({
                    variant: "destructive",
                    title: "Error DB",
                    description: `No se pudo actualizar el stock en la base de datos para ${productDescription}.`
                });
            }
        } else if (type === 'count') {
            if (!showDiscrepancyToastIfNeeded(productForToast, finalValue)) {
                toast({
                    title: "Cantidad Modificada",
                    description: `Cantidad de ${productDescription} (${getWarehouseName(currentWarehouseId)}) cambiada a ${finalValue}.`,
                    duration: 3000
                });
            }
        }
     }
  }, [currentWarehouseId, getWarehouseName, toast, countingList, showDiscrepancyToastIfNeeded]);


const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
    if (!isMountedRef.current) return;
    if (newValue < 0 || isNaN(newValue)) {
        toast({ variant: "destructive", title: "Valor Inválido", description: "La cantidad o stock debe ser un número positivo." });
        return;
    }

    let productDescription = '';
    let finalValue: number | undefined;
    let needsConfirmation = false;
    let productForToast: DisplayProduct | null = null;

    setCountingList(prevList => {
        const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
        if (productIndex === -1) return prevList;

        const product = prevList[productIndex];
        productForToast = product;
        productDescription = product.description;
        const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
        let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
        finalValue = Math.max(0, calculatedValue);
        const productStock = product.stock ?? 0;

        needsConfirmation = type === 'count' && finalValue > productStock && originalValue <= productStock && productStock > 0;

        if (needsConfirmation) {
            setConfirmQuantityProductBarcode(product.barcode);
            setConfirmQuantityAction('set');
            setConfirmQuantityNewValue(finalValue);
            setIsConfirmQuantityDialogOpen(true);
            return prevList;
        } else {
            const updatedProduct = {
                ...product,
                [type]: finalValue,
                lastUpdated: new Date().toISOString()
            };
            productForToast = updatedProduct;
            const listWithoutProduct = prevList.filter((_, i) => i !== productIndex);
            setOpenModifyDialog(null);
            return [updatedProduct, ...listWithoutProduct];
        }
    });

    if (!needsConfirmation && finalValue !== undefined && productForToast) {
         if (type === 'stock') {
             try {
                 const dbProduct = await getProductFromDB(barcodeToUpdate);
                 if (dbProduct) {
                     const updatedDbProduct: ProductDetail = { ...dbProduct, stock: finalValue };
                     await addOrUpdateProductToDB(updatedDbProduct);
                      toast({
                          title: `Stock (DB) Actualizado`,
                          description: `Stock de ${productDescription} actualizado a ${finalValue} en la base de datos.`
                      });
                 } else {
                       const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                       if(listProduct) {
                            const newDbProduct: ProductDetail = {
                                 barcode: listProduct.barcode,
                                 description: listProduct.description,
                                 provider: listProduct.provider,
                                 stock: finalValue
                             };
                             await addOrUpdateProductToDB(newDbProduct);
                              toast({
                                  title: `Stock (DB) Establecido`,
                                  description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock} en la base de datos.`
                              });
                       }
                 }
             } catch (error) {
                 toast({
                     variant: "destructive",
                     title: "Error DB",
                     description: `No se pudo actualizar el stock en la base de datos para ${productDescription}.`
                 });
             }
         } else if (type === 'count') {
             const actionText = sumValue ? "sumada a" : "establecida en";
             if (!showDiscrepancyToastIfNeeded(productForToast, finalValue)) {
                 toast({
                     title: "Cantidad Modificada",
                     description: `Cantidad de ${productDescription} (${getWarehouseName(currentWarehouseId)}) ${actionText} ${finalValue}.`,
                     duration: 3000
                 });
             }
         }
     }
}, [currentWarehouseId, getWarehouseName, toast, countingList, showDiscrepancyToastIfNeeded]);


  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, 1);
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1);
  }, [modifyProductValue]);


 const handleConfirmQuantityChange = useCallback(() => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null) {
         setIsConfirmQuantityDialogOpen(false);
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

     setCountingList(prevList => {
         const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (index === -1) return prevList;

         const updatedList = [...prevList];
         const product = updatedList[index];
         const finalConfirmedCount = Math.max(0, newValue);
         confirmedValue = finalConfirmedCount;

         productAfterConfirm = {
             ...product,
             count: finalConfirmedCount,
             lastUpdated: new Date().toISOString()
         };
         updatedList[index] = productAfterConfirm;
         return [updatedList[index], ...updatedList.filter((_, i) => i !== index)];
     });

     requestAnimationFrame(() => {
        if (productAfterConfirm) { // productAfterConfirm is now populated from setCountingList's new state
            if (!showDiscrepancyToastIfNeeded(productAfterConfirm)) {
                toast({
                    title: "Cantidad Modificada",
                    description: `Cantidad de ${productDescription} (${getWarehouseName(warehouseId)}) cambiada a ${confirmedValue}.`
                });
            }
        }
    });

     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
     setOpenModifyDialog(null);
 }, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, getWarehouseName, countingList, showDiscrepancyToastIfNeeded]);


 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         setProductToDelete(product);
         setIsDeleteDialogOpen(true);
  }, []);

 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete) return;

     const descriptionForToast = productToDelete.description;
     const barcodeForToast = productToDelete.barcode;
     const warehouseId = productToDelete.warehouseId;

     setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));

     requestAnimationFrame(() => {
         toast({
              title: "Producto eliminado (Lista Actual)",
              description: `${descriptionForToast} (${barcodeForToast}) ha sido eliminado del inventario actual (${getWarehouseName(warehouseId)}).`,
              variant: "default"
          });
      });

     setIsDeleteDialogOpen(false);
     setProductToDelete(null);
 }, [productToDelete, toast, getWarehouseName]);

 const handleClearCurrentList = useCallback(() => {
     if (!isMountedRef.current || !currentWarehouseId) return;
     setCountingList(prevList => prevList.filter(p => p.warehouseId !== currentWarehouseId));
     requestAnimationFrame(() => {
         toast({
             title: "Lista Actual Borrada",
             description: `Se han eliminado todos los productos del inventario para ${getWarehouseName(currentWarehouseId)}.`,
             variant: "default"
         });
     });
     setIsDeleteListDialogOpen(false);
 }, [currentWarehouseId, getWarehouseName, toast]);

 const handleExport = useCallback(() => {
     const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
     if (currentWarehouseList.length === 0) {
        toast({ title: "Vacío", description: "No hay productos en el inventario actual para exportar." });
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
        }));

        const csv = Papa.unparse(dataToExport, { header: true });
        const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);

        let fileName = '';
        const providersInList = new Set(currentWarehouseList.map(p => p.provider).filter(p => p && p !== "Desconocido"));
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
        toast({ title: "Exportado", description: `Inventario para ${getWarehouseName(currentWarehouseId)} exportado a ${fileName}.` });
    } catch (error) {
        console.error("Error exporting inventory:", error);
        toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
    }
 }, [countingList, currentWarehouseId, toast, getWarehouseName]);


  const handleSaveToHistory = useCallback(async (hideToast = false) => {
    if (!isMountedRef.current) return;
    const currentListForWarehouse = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (currentListForWarehouse.length === 0) {
        if (!hideToast) {
             requestAnimationFrame(() => {
                 toast({ title: "Vacío", description: "No hay productos en el inventario actual para guardar en el historial." });
            });
        }
        return;
    }

    setIsSavingToHistory(true);
    try {
        const currentWHName = getWarehouseName(currentWarehouseId);
        const historyEntry: CountingHistoryEntry = {
            id: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            warehouseId: currentWarehouseId,
            warehouseName: currentWHName,
            products: JSON.parse(JSON.stringify(currentListForWarehouse))
        };

        await saveCountingHistory(historyEntry);
         if (!hideToast) {
            requestAnimationFrame(() => {
                toast({ title: "Historial Guardado", description: `Conteo para ${currentWHName} guardado en el historial local.` });
            });
        }
    } catch (error: any) {
        console.error("Error saving counting history:", error);
         if (!hideToast) {
             requestAnimationFrame(() => {
                 toast({ variant: "destructive", title: "Error al Guardar Historial", description: error.message || "Ocurrió un error inesperado." });
             });
        }
    } finally {
        if (isMountedRef.current) {
            setIsSavingToHistory(false);
        }
    }
}, [countingList, currentWarehouseId, getWarehouseName, toast]);


 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current) return;
     setIsRefreshingStock(true);
     let updatedProductCount = 0;
     let addedProductCount = 0;
     try {
         const allDbProducts = await getAllProductsFromDB();
         const dbProductMap = new Map(allDbProducts.map(p => [p.barcode, p]));

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
                         countingProduct.stock !== (dbProduct.stock ?? 0))
                     {
                         updatedProductCount++;
                         return {
                             ...countingProduct,
                             description: dbProduct.description,
                             provider: dbProduct.provider,
                             stock: dbProduct.stock ?? 0,
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

          requestAnimationFrame(() => {
              toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) y ${addedProductCount} agregado(s) desde la base de datos para ${getWarehouseName(currentWarehouseId)}.` });
          });

     } catch (error) {
         console.error(`Error refreshing stock and details for warehouse ${currentWarehouseId}:`, error);
          requestAnimationFrame(() => {
              toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar los datos desde la base de datos local para ${getWarehouseName(currentWarehouseId)}. ` });
          });
     } finally {
         if (isMountedRef.current) {
             setIsRefreshingStock(false);
         }
     }
 }, [currentWarehouseId, toast, getWarehouseName]);


 const handleOpenModifyDialog = useCallback((product: DisplayProduct, type: 'count' | 'stock') => {
     setOpenModifyDialog({ type, product });
 }, []);

 const handleCloseModifyDialog = () => {
     setOpenModifyDialog(null);
 };

 const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct) => {
     if (!product || !product.barcode || !isMountedRef.current) return;
     setIsDbLoading(true);
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
                 stock: product.stock ?? 0
             };
             setProductToEditDetail(placeholderDetail);
             setInitialStockForEdit(product.stock ?? 0);
             setIsEditDetailDialogOpen(true);
             requestAnimationFrame(() => {
                toast({ variant: "default", title: "Editando Producto Temporal", description: "Guarde los cambios para añadirlo a la base de datos." });
             });
         }
     } catch (error) {
         if (!isMountedRef.current) return;
         console.error("Error fetching product details for edit:", error);
         requestAnimationFrame(() => {
            toast({ variant: "destructive", title: "Error DB", description: "No se pudieron obtener los datos del producto para editar." });
         });
     } finally {
         if (isMountedRef.current) {
            setIsDbLoading(false);
         }
     }
 }, [toast]);

 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
     if (!isMountedRef.current || !productToEditDetail) return;
     setIsDbLoading(true);
     try {
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode,
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0,
         };
         await addOrUpdateProductToDB(updatedProductData);
         if (!isMountedRef.current) return;
         setCountingList(prevList => prevList.map(item =>
             item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId
                 ? {
                     ...item,
                     description: updatedProductData.description,
                     provider: updatedProductData.provider,
                     stock: updatedProductData.stock,
                     lastUpdated: new Date().toISOString()
                   }
                 : item
         ));
         requestAnimationFrame(() => {
             toast({
                 title: "Producto Actualizado",
                 description: `${updatedProductData.description} ha sido actualizado en la base de datos.`,
             });
         });
         setIsEditDetailDialogOpen(false);
         setProductToEditDetail(null);
     } catch (error: any) {
         if (!isMountedRef.current) return;
          requestAnimationFrame(() => {
             toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
          });
     } finally {
         if (isMountedRef.current) {
             setIsDbLoading(false);
         }
     }
 }, [toast, currentWarehouseId, productToEditDetail]);

 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
     if (!isMountedRef.current) return;
     if (!productsToCount || productsToCount.length === 0) {
         requestAnimationFrame(() => {
            toast({ title: "Vacío", description: "No hay productos para este proveedor." });
         });
         return;
     }
     const productsWithWarehouseContext: DisplayProduct[] = productsToCount.map(dbProduct => ({
         ...dbProduct,
         warehouseId: currentWarehouseId,
         stock: dbProduct.stock ?? 0,
         count: 0,
         lastUpdated: new Date().toISOString(),
     }));
     setCountingList(prevList => {
         const otherWarehouseItems = prevList.filter(item => item.warehouseId !== currentWarehouseId);
         const newList = [...productsWithWarehouseContext, ...otherWarehouseItems];
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
     setActiveSection("Contador");
      requestAnimationFrame(() => {
         toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para ${getWarehouseName(currentWarehouseId)}.` });
      });
 }, [toast, setActiveSection, currentWarehouseId, getWarehouseName]);


  const filteredCountingList = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);
    if (!lowerSearchTerm) return currentWarehouseList;
    return currentWarehouseList.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) ||
      (product.provider || '').toLowerCase().includes(lowerSearchTerm)
    );
  }, [countingList, searchTerm, currentWarehouseId]);

  const handleSectionChange = useCallback((newSection: string) => {
    setActiveSection(newSection);
    if (newSection === 'Contador') {
       requestAnimationFrame(() => barcodeInputRef.current?.focus());
    }
  }, [setActiveSection]);

   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
         if (newWarehouseId !== currentWarehouseId) {
             setIsDbLoading(true);
             setCurrentWarehouseId(newWarehouseId);
             setSearchTerm("");
         }
   }, [currentWarehouseId, setCurrentWarehouseId]);

   const handleAddWarehouse = useCallback((newWarehouse: { id: string; name: string }) => {
         setWarehouses(prevWarehouses => {
             const isDuplicate = prevWarehouses.some(warehouse => warehouse.id === newWarehouse.id);
             if (isDuplicate) {
                 requestAnimationFrame(() => {
                    toast({ variant: 'destructive', title: 'Error', description: 'ID de almacén ya existe.' });
                 });
                 return prevWarehouses;
             }
             const updatedWarehouses = [...prevWarehouses, newWarehouse];
             handleWarehouseChange(newWarehouse.id);
             requestAnimationFrame(() => {
                 toast({title: "Almacén Agregado", description: `Cambiado al nuevo almacén: ${newWarehouse.name}`});
              });
             return updatedWarehouses;
         });
   }, [setWarehouses, handleWarehouseChange, toast]);

   const handleUpdateWarehouses = useCallback((updatedWarehouses: { id: string; name: string }[]) => {
         setWarehouses(updatedWarehouses);
         if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
             const newCurrentId = updatedWarehouses[0]?.id || 'main';
             if (newCurrentId !== currentWarehouseId) {
                 handleWarehouseChange(newCurrentId);
                  requestAnimationFrame(() => {
                     toast({title: "Almacén Actualizado", description: `Almacén actual cambiado a ${getWarehouseName(newCurrentId)}.`});
                  });
             } else if (updatedWarehouses.length === 0) {
                  const defaultWarehouse = { id: 'main', name: 'Almacén Principal' };
                  setWarehouses([defaultWarehouse]);
                  handleWarehouseChange(defaultWarehouse.id);
                   requestAnimationFrame(() => {
                      toast({title: "Almacenes Actualizados", description: "Se restauró el almacén principal."});
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
    setIsDbLoading(true);
    try {
      await clearAllDatabases();
      requestAnimationFrame(() => {
          toast({ title: "Base de Datos Borrada", description: "Todos los productos y el historial han sido eliminados." });
      });
      setCountingList([]);
    } catch (error: any) {
      requestAnimationFrame(() => {
          toast({ variant: "destructive", title: "Error al Borrar", description: `No se pudo borrar la base de datos: ${error.message}` });
      });
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
      }
       setIsClearAllDataConfirmOpen(false);
    }
  }, [toast]);


  // --- Main Component Render ---
  return (
    <div className="container mx-auto p-4">
       <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
         <h1 className="text-2xl font-bold text-gray-700 dark:text-gray-200">StockCounter Pro</h1>
         <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
            <Select value={activeSection} onValueChange={handleSectionChange}>
                <SelectTrigger className="w-full sm:w-auto min-w-[180px] max-w-[250px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                    <SelectValue placeholder="Seleccionar Sección" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="Contador">
                        <div className="flex items-center gap-2">
                            <AppWindow className="h-4 w-4"/> Contador ({getWarehouseName(currentWarehouseId)})
                         </div>
                    </SelectItem>
                    <SelectItem value="Base de Datos">
                         <div className="flex items-center gap-2">
                            <Database className="h-4 w-4"/> Base de Datos
                        </div>
                    </SelectItem>
                    <SelectItem value="Almacenes">
                          <div className="flex items-center gap-2">
                            <Boxes className="h-4 w-4"/> Almacenes
                         </div>
                    </SelectItem>
                    <SelectItem value="Historial">
                          <div className="flex items-center gap-2">
                            <HistoryIcon className="h-4 w-4"/> Historial
                         </div>
                    </SelectItem>
                    <SelectItem value="Informes">
                          <div className="flex items-center gap-2">
                              <BarChart className="h-4 w-4" /> Informes
                          </div>
                    </SelectItem>
                </SelectContent>
            </Select>
            {warehouses.length > 0 && (
               <div className="flex items-center gap-2 w-full sm:w-auto">
                   <WarehouseIcon className="h-5 w-5 text-gray-600 dark:text-gray-400"/>
                    <Select value={currentWarehouseId} onValueChange={handleWarehouseChange}>
                        <SelectTrigger className="w-full sm:w-auto min-w-[180px] max-w-[250px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                            <SelectValue placeholder="Seleccionar Almacén" />
                        </SelectTrigger>
                        <SelectContent>
                            {warehouses.map((warehouse) => (
                            <SelectItem key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                            </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
               </div>
            )}
         </div>
      </div>

      <div className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
        {activeSection === 'Contador' && (
            <div id="contador-content">
                <BarcodeEntry
                    barcode={barcode}
                    setBarcode={setBarcode}
                    onAddProduct={() => handleAddProduct()}
                    onRefreshStock={handleRefreshStock}
                    isLoading={isDbLoading || isRefreshingStock || isSavingToHistory}
                    isRefreshingStock={isRefreshingStock}
                    inputRef={barcodeInputRef}
                />
                 <div className="relative mb-4">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Buscar en inventario actual..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                         className="pl-8 w-full bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600"
                        aria-label="Buscar en lista de conteo"
                        disabled={isDbLoading || isRefreshingStock}
                    />
                </div>
               <CountingListTable
                    countingList={filteredCountingList}
                    warehouseName={getWarehouseName(currentWarehouseId)}
                    isLoading={isDbLoading}
                    onDeleteRequest={handleDeleteRequest}
                    onOpenStockDialog={(product) => handleOpenModifyDialog(product, 'stock')}
                    onOpenQuantityDialog={(product) => handleOpenModifyDialog(product, 'count')}
                    onDecrement={handleDecrement}
                    onIncrement={handleIncrement}
                    onEditDetailRequest={handleOpenEditDetailDialog}
                    tableHeightClass="h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]"
                />

               <div className="mt-4 flex flex-wrap justify-center md:justify-end gap-2">
                    <Button
                        onClick={() => handleSaveToHistory()}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isSavingToHistory}
                        variant="outline"
                        className="flex items-center gap-1 w-full sm:w-auto"
                    >
                        {isSavingToHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {isSavingToHistory ? "Guardando..." : "Guardar Historial"}
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading}
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
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading}
                        variant="destructive"
                         className="flex items-center gap-1 w-full sm:w-auto"
                    >
                        <Trash className="h-4 w-4" /> Borrar Lista
                    </Button>
                </div>
            </div>
        )}

         {activeSection === 'Base de Datos' && (
            <div id="database-content">
               <ProductDatabase
                  onStartCountByProvider={handleStartCountByProvider}
               />
            </div>
         )}

          {activeSection === 'Almacenes' && (
             <div id="warehouses-content">
                 <WarehouseManagement
                    warehouses={warehouses}
                    onAddWarehouse={handleAddWarehouse}
                    onUpdateWarehouses={handleUpdateWarehouses}
                    onClearDatabaseRequest={() => setIsClearAllDataConfirmOpen(true)}
                  />
             </div>
           )}

            {activeSection === 'Historial' && (
                <div id="history-content">
                    <CountingHistoryViewer
                        getWarehouseName={getWarehouseName}
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
      </div>

      <ModifyValueDialog
          isOpen={!!openModifyDialog}
          setIsOpen={(open) => !open && handleCloseModifyDialog()}
          type={openModifyDialog?.type || 'count'}
          product={openModifyDialog?.product || null}
          warehouseName={getWarehouseName(currentWarehouseId)}
          currentValue={getCurrentValueForDialog(openModifyDialog?.type || 'count')}
          onIncrement={handleIncrement}
          onDecrement={handleDecrement}
          onSet={handleSetProductValue}
          onClose={handleCloseModifyDialog}
      />

      <ConfirmationDialog
          isOpen={isConfirmQuantityDialogOpen}
          onOpenChange={setIsConfirmQuantityDialogOpen}
          title="Confirmar Modificación"
          description={
             (() => {
               if (confirmQuantityNewValue === null || !confirmQuantityProductBarcode) return "¿Continuar con la modificación?";
               const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
               const stock = product?.stock ?? 0;
               const description = product?.description ?? confirmQuantityProductBarcode;

               if (confirmQuantityAction === 'set' || confirmQuantityAction === 'increment' || confirmQuantityAction === 'decrement') {
                   const isOverStock = stock > 0 && confirmQuantityNewValue > stock;
                   const isUnderStock = stock > 0 && confirmQuantityNewValue < stock && confirmQuantityNewValue >= 0; // Check also for positive new value

                   if (isOverStock) {
                       return `La cantidad contada (${confirmQuantityNewValue}) ahora SUPERA el stock del sistema (${stock}) para "${description}". ¿Confirmar?`;
                   } else if (isUnderStock) {
                       return `La cantidad contada (${confirmQuantityNewValue}) ahora es MENOR al stock del sistema (${stock}) para "${description}". ¿Confirmar?`;
                   }
               }
               return `Está a punto de modificar la cantidad contada para "${description}". ¿Continuar?`;
             })()
          }
          onConfirm={handleConfirmQuantityChange}
          onCancel={() => {
              setIsConfirmQuantityDialogOpen(false);
              setConfirmQuantityProductBarcode(null);
              setConfirmQuantityAction(null);
              setConfirmQuantityNewValue(null);
          }}
      />

      <ConfirmationDialog
         isOpen={isDeleteDialogOpen}
         onOpenChange={setIsDeleteDialogOpen}
         title="Confirmar Eliminación (Lista Actual)"
         description={`¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) del inventario actual (${getWarehouseName(productToDelete?.warehouseId)})? Esta acción no se puede deshacer.`}
         onConfirm={confirmDelete}
         onCancel={() => setIsDeleteDialogOpen(false)}
         isDestructive={true}
      />

      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={setIsDeleteListDialogOpen}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})? Esta acción no se puede deshacer.`}
          onConfirm={handleClearCurrentList}
          onCancel={() => setIsDeleteListDialogOpen(false)}
          isDestructive={true}
      />

        <ConfirmationDialog
            isOpen={isClearAllDataConfirmOpen}
            onOpenChange={setIsClearAllDataConfirmOpen}
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
            onCancel={() => setIsClearAllDataConfirmOpen(false)}
            isDestructive={true}
            isProcessing={isDbLoading}
        />

      <EditProductDialog
         isOpen={isEditDetailDialogOpen}
         setIsOpen={setIsEditDetailDialogOpen}
         selectedDetail={productToEditDetail}
         setSelectedDetail={setProductToEditDetail}
         onSubmit={handleEditDetailSubmit}
         onDelete={ async (barcode) => {
              if (!isMountedRef.current) return;
               setIsDbLoading(true);
               try {
                   await deleteProductFromDB(barcode);
                   if (!isMountedRef.current) return;
                   setCountingList(prevList => prevList.filter(p => !(p.barcode === barcode && p.warehouseId === currentWarehouseId)));
                    requestAnimationFrame(() => {
                       toast({title: "Producto Eliminado (DB)", description: `Producto ${barcode} eliminado de la base de datos.`});
                    });
                   setIsEditDetailDialogOpen(false);
                   setProductToEditDetail(null);
               } catch (error: any) {
                    if (!isMountedRef.current) return;
                    requestAnimationFrame(() => {
                        toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
                    });
               } finally {
                    if (isMountedRef.current) {
                        setIsDbLoading(false);
                    }
                    setIsDeleteDialogOpen(false);
                    setProductToDelete(null);
               }
           }}
         isProcessing={isDbLoading}
         initialStock={initialStockForEdit}
         context="countingList"
         warehouseName={getWarehouseName(currentWarehouseId)}
      />
    </div>
  );
}

