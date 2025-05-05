"use client";

import type { DisplayProduct, InventoryItem, ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
import { format } from 'date-fns';
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, Camera, AlertCircle, Search, Check, AppWindow, Database, Boxes, UploadCloud, Loader2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    addOrUpdateInventoryItem,
    getDisplayProductForWarehouse,
    getProductDetail,
    addOrUpdateProductDetail,
    getInventoryItemsForWarehouse,
} from '@/lib/indexeddb-helpers';
import { backupToGoogleSheet } from './actions/backup-actions';
import { playBeep } from '@/lib/helpers';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { ScannerDialog } from '@/components/scanner-dialog';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { useLocalStorage } from '@/hooks/use-local-storage';

// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_BACKUP_SHEET_ID_KEY = 'stockCounterPro_backupSheetId'; // Storing Sheet ID

// --- Main Component ---

export default function Home() {
  const [barcode, setBarcode] = useState("");
  const [warehouses, setWarehouses] = useLocalStorage<Array<{ id: string; name: string }>>(
      LOCAL_STORAGE_WAREHOUSES_KEY,
      [{ id: 'main', name: 'Almacén Principal' }]
  );
  const [currentWarehouseId, setCurrentWarehouseId] = useLocalStorage<string>(
      LOCAL_STORAGE_WAREHOUSE_KEY,
      warehouses[0]?.id || 'main'
  );
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [openQuantityDialog, setOpenQuantityDialog] = useState(false);
  const [openStockDialog, setOpenStockDialog] = useState(false);
  const [selectedProductForDialog, setSelectedProductForDialog] = useState<DisplayProduct | null>(null);
  const [isConfirmQuantityDialogOpen, setIsConfirmQuantityDialogOpen] = useState(false);
  const [confirmQuantityAction, setConfirmQuantityAction] = useState<'increment' | 'decrement' | 'set' | null>(null);
  const [confirmQuantityProductBarcode, setConfirmQuantityProductBarcode] = useState<string | null>(null);
  const [confirmQuantityNewValue, setConfirmQuantityNewValue] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true);
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [activeSection, setActiveSection] = useLocalStorage<string>(
      LOCAL_STORAGE_ACTIVE_SECTION_KEY,
      'Contador'
  );
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSheetId, setBackupSheetId] = useLocalStorage<string>( // Using Sheet ID now
      LOCAL_STORAGE_BACKUP_SHEET_ID_KEY,
      ''
  );

   const getWarehouseName = useCallback((warehouseId: string) => {
        if (!warehouseId) return 'N/A';
        const warehouse = warehouses.find(w => w.id === warehouseId);
        return warehouse ? warehouse.name : `Almacén (${warehouseId})`;
    }, [warehouses]);

 // Handles adding or incrementing a product in the counting list for the current warehouse
 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r/g, '');

    if (!trimmedBarcode) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un código de barras válido.",
      });
      setBarcode("");
      requestAnimationFrame(() => {
          barcodeInputRef.current?.focus();
      });
      return;
    }

    if (!currentWarehouseId) {
        toast({
            variant: "destructive",
            title: "Error",
            description: "No se ha seleccionado ningún almacén.",
        });
        return;
    }

    let productExists = false;
    setCountingList(prevList => {
        const existingProductIndex = prevList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

        if (existingProductIndex !== -1) {
            productExists = true;
            const productToUpdate = prevList[existingProductIndex];
            const newCount = productToUpdate.count + 1;
            const updatedProductData: DisplayProduct = {
                ...productToUpdate,
                count: newCount,
                lastUpdated: new Date().toISOString(),
            };

            const updatedList = [...prevList];
            updatedList.splice(existingProductIndex, 1);
            updatedList.unshift(updatedProductData);

            toast({
                title: "Cantidad aumentada",
                description: `${updatedProductData.description} cantidad aumentada a ${newCount}.`,
            });
            playBeep(880, 100);
            return updatedList;

        } else {
            return prevList;
        }
    });

     if (!productExists) {
        try {
             const displayProduct = await getDisplayProductForWarehouse(trimmedBarcode, currentWarehouseId);

             if (displayProduct) {
                const newProductForList: DisplayProduct = {
                    ...displayProduct,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                 };
                  setCountingList(prev => [newProductForList, ...prev]);
                 toast({
                     title: "Producto agregado",
                     description: `${newProductForList.description} agregado al inventario (${getWarehouseName(currentWarehouseId)}).`,
                 });
                 playBeep(660, 150);
             } else {
                 playBeep(440, 300);
                 const newProductDetail: ProductDetail = {
                    barcode: trimmedBarcode,
                    description: `Producto desconocido ${trimmedBarcode}`,
                    provider: "Desconocido",
                };
                const newInventoryItem: InventoryItem = {
                    barcode: trimmedBarcode,
                    warehouseId: currentWarehouseId,
                    stock: 0,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                 };

                 await addOrUpdateProductDetail(newProductDetail);
                 await addOrUpdateInventoryItem(newInventoryItem);

                  const newDisplayProduct: DisplayProduct = {
                      ...newProductDetail,
                      ...newInventoryItem,
                  };
                   setCountingList(prev => [newDisplayProduct, ...prev]);

                 toast({
                     variant: "destructive",
                     title: "Producto desconocido",
                     description: `Producto ${trimmedBarcode} no encontrado. Agregado con stock 0 al inventario (${getWarehouseName(currentWarehouseId)}).`,
                     duration: 5000,
                 });
             }

        } catch (error) {
             console.error("Error fetching or adding product:", error);
             toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo verificar o agregar el producto." });
        }
    }

    setBarcode("");
    requestAnimationFrame(() => {
        barcodeInputRef.current?.focus();
    });

 }, [barcode, currentWarehouseId, toast, getWarehouseName, setCountingList]); // Include setCountingList in dependencies


  // --- Barcode Scanner Hook ---
  const handleScanSuccess = useCallback((detectedBarcode: string) => {
    setIsScanning(false);
    requestAnimationFrame(() => {
      setBarcode(detectedBarcode);
      // Call handleAddProduct directly to ensure it uses the latest scope
      handleAddProduct(detectedBarcode);
    });
  }, [handleAddProduct, setIsScanning, setBarcode]); // Depend on handleAddProduct


  const {
    isInitializing: isScannerInitializing,
    hasPermission: hasCameraPermission,
    startScanning,
    stopScanning,
  } = useBarcodeScanner({
    onScanSuccess: handleScanSuccess,
    videoRef: videoRef,
    isEnabled: isScanning,
  });

  // --- Warehouse and Data Loading ---

  const getLocalStorageKeyForWarehouse = (warehouseId: string) => {
    return `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}`;
  };

  const loadWarehouseData = useCallback(async (warehouseId: string) => {
    if (!warehouseId) return;
    setIsDbLoading(true);
    console.log(`page.tsx: Loading data for warehouse: ${warehouseId}...`);
    try {
         if (typeof window !== 'undefined') {
            const savedListKey = getLocalStorageKeyForWarehouse(warehouseId);
            const savedList = localStorage.getItem(savedListKey);
            let loadedList: DisplayProduct[] = [];
            if (savedList) {
                 try {
                     const parsedList: DisplayProduct[] = JSON.parse(savedList);
                     if (Array.isArray(parsedList) && parsedList.every(item =>
                         typeof item === 'object' && item !== null &&
                         typeof item.barcode === 'string' &&
                         (typeof item.warehouseId === 'undefined' || item.warehouseId === warehouseId) &&
                         typeof item.description === 'string' &&
                         typeof item.count === 'number' &&
                         typeof item.stock === 'number'
                     )) {
                        loadedList = parsedList
                            .filter(item => typeof item.warehouseId === 'undefined' || item.warehouseId === warehouseId)
                            .map(item => ({ ...item, warehouseId: warehouseId }));
                         console.log(`Loaded ${loadedList.length} items for warehouse ${warehouseId} from localStorage.`);
                    } else {
                         console.warn(`Invalid data structure in localStorage for warehouse ${warehouseId}. Clearing.`);
                         localStorage.removeItem(savedListKey);
                     }
                 } catch (parseError) {
                      console.error(`Error parsing localStorage data for warehouse ${warehouseId}:`, parseError);
                      localStorage.removeItem(savedListKey);
                 }
            } else {
                console.log(`No counting list found in localStorage for warehouse ${warehouseId}. Starting fresh.`);
            }
             setCountingList(loadedList);
        }

    } catch (error) {
        console.error(`page.tsx: Failed to load data for warehouse ${warehouseId}:`, error);
        toast({
            variant: "destructive",
            title: "Error de Carga",
            description: `No se pudieron cargar los datos para el almacén seleccionado (${warehouseId}).`,
            duration: 9000,
        });
        setCountingList([]);
    } finally {
        setIsDbLoading(false);
        if (!isScanning && barcodeInputRef.current) {
            barcodeInputRef.current.focus();
        }
    }
  }, [toast, isScanning, setCountingList]); // Include setCountingList

  // Load data when the component mounts or warehouse changes
  useEffect(() => {
    if (currentWarehouseId) {
        loadWarehouseData(currentWarehouseId);
    }
  }, [currentWarehouseId, loadWarehouseData]);

  // Save counting list to localStorage whenever it changes for the current warehouse
  useEffect(() => {
    if (typeof window !== 'undefined' && !isDbLoading && currentWarehouseId) {
        try {
            const key = getLocalStorageKeyForWarehouse(currentWarehouseId);
            const listToSave = countingList.filter(item => item.warehouseId === currentWarehouseId);
            localStorage.setItem(key, JSON.stringify(listToSave));
        } catch (error) {
            console.error(`Failed to save counting list to localStorage for warehouse ${currentWarehouseId}:`, error);
            toast({
                variant: "destructive",
                title: "Error de Almacenamiento Local",
                description: "No se pudo guardar el estado del inventario actual.",
                duration: 5000,
            });
        }
    }
  }, [countingList, currentWarehouseId, toast, isDbLoading]);



 // Modify product count or stock, handling confirmation dialog
 const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    let productToConfirm: DisplayProduct | null = null;
    let needsConfirmation = false;
    let originalValue = -1;
    let updatedProductDescription = '';
    const warehouseId = currentWarehouseId;
    let finalValue = 0;

    setCountingList(prevList => {
        const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
        if (index === -1) return prevList;

        const updatedList = [...prevList];
        const product = updatedList[index];
        updatedProductDescription = product.description;


        if (type === 'count') {
            originalValue = product.count;
            finalValue = Math.max(0, product.count + change);

            if (product.stock !== 0) {
                const changingToMatch = change > 0 && finalValue === product.stock;
                const changingFromMatch = change < 0 && product.count === product.stock;
                if (changingToMatch || changingFromMatch) {
                    productToConfirm = { ...product };
                    needsConfirmation = true;
                }
            }

            if (needsConfirmation) {
                return prevList;
            } else {
                updatedList[index] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
            }

        } else { // type === 'stock'
            originalValue = product.stock;
            finalValue = Math.max(0, product.stock + change);
            updatedList[index] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
        }

        return updatedList;
    });

     if (type === 'stock') {
         try {
             // Find the current state AFTER the potential update from setCountingList
             const currentProductState = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
             const newStockValue = finalValue;

             const itemToUpdate: InventoryItem = {
                barcode: barcodeToUpdate,
                warehouseId: warehouseId,
                stock: newStockValue,
                count: currentProductState?.count ?? 0,
                lastUpdated: new Date().toISOString()
            };
             await addOrUpdateInventoryItem(itemToUpdate);
             toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${newStockValue} en la base de datos.` });
         } catch (error) {
             console.error("Failed to update stock in DB:", error);
             toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
             setCountingList(prevList => {
                const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                if (index === -1) return prevList;
                const revertedList = [...prevList];
                revertedList[index] = { ...revertedList[index], stock: originalValue };
                return revertedList;
             });
         }
    }

    if (needsConfirmation && productToConfirm && type === 'count') {
        setConfirmQuantityProductBarcode(productToConfirm.barcode);
        setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
        const potentialNewCount = Math.max(0, productToConfirm.count + change);
        setConfirmQuantityNewValue(potentialNewCount);
        setIsConfirmQuantityDialogOpen(true);
    } else if (type === 'count' && !needsConfirmation) {
         const currentCountValue = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId)?.count ?? 0;
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) cambiada a ${currentCountValue}.` });
    }

 }, [countingList, currentWarehouseId, toast, getWarehouseName, setCountingList]); // Include setCountingList


 // Handler to set product count or stock directly, handling confirmation dialog
 const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
     if (newValue < 0 || isNaN(newValue)) {
         toast({ variant: "destructive", title: "Valor Inválido", description: "La cantidad o stock debe ser un número positivo." });
         return;
     }

     const warehouseId = currentWarehouseId;
     let needsConfirmation = false;
     let productToConfirm: DisplayProduct | null = null;
     let updatedProductDescription = '';
     let originalValue = -1;
     let finalValue = 0;

     setCountingList(prevList => {
         const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (index === -1) return prevList;

         const updatedList = [...prevList];
         const product = updatedList[index];
         updatedProductDescription = product.description;


         if (type === 'count') {
             originalValue = product.count;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
             finalValue = Math.max(0, finalValue);

             if (product.stock !== 0 && finalValue === product.stock && originalValue !== product.stock) {
                 needsConfirmation = true;
                 productToConfirm = { ...product };
             }

             if (needsConfirmation) {
                return prevList;
             } else {
                 updatedList[index] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
             }
         } else { // type === 'stock'
             originalValue = product.stock;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
             finalValue = Math.max(0, finalValue);
             updatedList[index] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
         }
         return updatedList;
     });

     if (type === 'stock') {
         try {
              const currentProductState = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
              const newStockValue = finalValue;

              const itemToUpdate: InventoryItem = {
                 barcode: barcodeToUpdate,
                 warehouseId: warehouseId,
                 stock: newStockValue,
                 count: currentProductState?.count ?? 0,
                 lastUpdated: new Date().toISOString()
             };
             await addOrUpdateInventoryItem(itemToUpdate);
             toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${newStockValue} en la base de datos.` });
         } catch (error) {
             console.error("Failed to update stock in DB:", error);
             toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
             setCountingList(prevList => {
                 const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                 if (index === -1) return prevList;
                 const revertedList = [...prevList];
                 revertedList[index] = { ...revertedList[index], stock: originalValue };
                 return revertedList;
             });
         }
     }

     if (needsConfirmation && productToConfirm && type === 'count') {
         setConfirmQuantityProductBarcode(productToConfirm.barcode);
         setConfirmQuantityAction('set');
         setConfirmQuantityNewValue(finalValue);
         setIsConfirmQuantityDialogOpen(true);
     } else if (type === 'count' && !needsConfirmation) {
         const actionText = sumValue ? "sumada a" : "establecida en";
         const currentCountValue = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId)?.count ?? 0;
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) ${actionText} ${currentCountValue}.` });
     }

     if (type === 'count') setOpenQuantityDialog(false);
     if (type === 'stock') setOpenStockDialog(false);
     setSelectedProductForDialog(null);

 }, [countingList, currentWarehouseId, toast, getWarehouseName, setCountingList]); // Include setCountingList


 // Specific handler for increment button click
 const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    modifyProductValue(barcode, type, 1);
 }, [modifyProductValue]);

 // Specific handler for decrement button click
 const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    modifyProductValue(barcode, type, -1);
 }, [modifyProductValue]);

 // Handler for confirming the quantity change after the dialog
 const handleConfirmQuantityChange = useCallback(() => {
    let descriptionForToast = '';
    let finalConfirmedCount = 0;
    const warehouseId = currentWarehouseId;

    if (confirmQuantityProductBarcode && confirmQuantityAction !== null) {
        setCountingList(prevList => {
            const index = prevList.findIndex(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === warehouseId);
            if (index === -1) return prevList;

            const updatedList = [...prevList];
            const product = updatedList[index];
            descriptionForToast = product.description;
            finalConfirmedCount = confirmQuantityNewValue !== null ? Math.max(0, confirmQuantityNewValue) : 0;

            updatedList[index] = {
                ...product,
                count: finalConfirmedCount,
                lastUpdated: new Date().toISOString()
            };
            return updatedList;
        });
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${descriptionForToast} (${getWarehouseName(warehouseId)}) cambiada a ${finalConfirmedCount}.` });
    } else {
        console.warn("Confirmation attempted with invalid state:", { confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue });
    }
    setIsConfirmQuantityDialogOpen(false);
    setConfirmQuantityProductBarcode(null);
    setConfirmQuantityAction(null);
    setConfirmQuantityNewValue(null);
}, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, toast, getWarehouseName, confirmQuantityNewValue, setCountingList]); // Include setCountingList


 // --- Deletion Handlers ---
 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
        setProductToDelete(product);
        setIsDeleteDialogOpen(true);
 }, []);

 const confirmDelete = useCallback(() => {
    if (productToDelete) {
        const descriptionForToast = productToDelete.description;
        const warehouseId = productToDelete.warehouseId;
        setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));
        toast({
            title: "Producto eliminado",
            description: `${descriptionForToast} ha sido eliminado del inventario actual (${getWarehouseName(warehouseId)}).`,
            variant: "default"
        });
    }
    setIsDeleteDialogOpen(false);
    setProductToDelete(null);
 }, [productToDelete, toast, getWarehouseName, setCountingList]);


 // --- Export Functionality ---
 const handleExport = useCallback(() => {
    if (countingList.length === 0) {
        toast({ title: "Vacío", description: "No hay productos en el inventario actual para exportar." });
        return;
    }
    try {
        const dataToExport = countingList.map(p => ({
            ...p,
            warehouseName: getWarehouseName(p.warehouseId)
        }));

        const csvData = convertToCSV(dataToExport);
        const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
        link.setAttribute("download", `inventory_count_${currentWarehouseId}_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        toast({ title: "Exportado", description: `Inventario para ${getWarehouseName(currentWarehouseId)} exportado a CSV.` });
    } catch (error) {
        console.error("Error exporting inventory:", error);
        toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
    }
 }, [countingList, currentWarehouseId, toast, getWarehouseName]);


 // --- Backup to Google Sheet (Server Action) ---
 const handleBackupToGoogleSheet = useCallback(async () => {
    if (countingList.length === 0) {
        toast({ title: "Vacío", description: "No hay productos en el inventario actual para respaldar." });
        return;
    }
     if (!backupSheetId.trim()) {
        toast({
            variant: "destructive",
            title: "ID de Hoja Requerido",
            description: "Por favor, introduce el ID de la Hoja de Google para el respaldo.",
        });
        return;
    }
    setIsBackingUp(true); // Start loading indicator
    try {
        const currentWHName = getWarehouseName(currentWarehouseId);
        // Directly pass the backupSheetId to the server action
        const result = await backupToGoogleSheet(countingList, currentWHName, backupSheetId);

        if (result.success) {
            toast({
                title: "Respaldo Exitoso",
                description: result.message,
            });
        } else {
            toast({
                variant: "destructive",
                title: "Error de Respaldo",
                description: result.message, // Display the specific error message from the server
                duration: 9000,
            });
        }
    } catch (error: any) { // Catch potential errors during the action call itself
        console.error("Error calling backupToGoogleSheet Server Action:", error);
        toast({
            variant: "destructive",
            title: "Error de Respaldo",
            description: error.message || "Ocurrió un error inesperado al intentar respaldar en Google Sheet.",
            duration: 9000,
        });
    } finally {
        setIsBackingUp(false); // Stop loading indicator
    }
 }, [countingList, currentWarehouseId, getWarehouseName, toast, backupSheetId]);


 // Converts an array of DisplayProduct objects to a CSV string
 const convertToCSV = (data: (DisplayProduct & { warehouseName?: string })[]) => {
    const headers = ["Barcode", "Description", "Provider", "WarehouseName", "Stock", "Count", "Last Updated"];
    const safeQuote = (field: any): string => {
        const str = String(field ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            const escapedStr = str.replace(/"/g, '""');
            return `"${escapedStr}"`;
        }
        return str;
    };

    const rows = data.map((product) => [
        safeQuote(product.barcode),
        safeQuote(product.description),
        safeQuote(product.provider),
        safeQuote(product.warehouseName),
        product.stock ?? 0,
        product.count ?? 0,
        product.lastUpdated ? safeQuote(format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss')) : '""',
    ]);

    return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
 };


 // --- Stock Refresh Functionality ---
 const handleRefreshStock = useCallback(async () => {
    if (!currentWarehouseId) return;
    setIsRefreshingStock(true);
    console.log(`Refreshing stock counts for warehouse ${currentWarehouseId} from database...`);
    try {
      const warehouseInventory = await getInventoryItemsForWarehouse(currentWarehouseId);
      const inventoryMap = new Map<string, InventoryItem>();
      warehouseInventory.forEach(item => inventoryMap.set(item.barcode, item));

      setCountingList(prevCountingList => {
        return prevCountingList.map(countingProduct => {
          const dbInventoryItem = inventoryMap.get(countingProduct.barcode);
          // Only update stock if the item exists in the DB for this warehouse
          return dbInventoryItem
            ? { ...countingProduct, stock: dbInventoryItem.stock, lastUpdated: new Date().toISOString() }
            : countingProduct; // Keep existing stock if not found in DB (might be newly added)
        });
      });

      toast({ title: "Stock Actualizado", description: `Los stocks para ${getWarehouseName(currentWarehouseId)} han sido actualizados.` });
      console.log("Stock counts refreshed for warehouse:", currentWarehouseId);

    } catch (error) {
      console.error(`Error refreshing stock counts for warehouse ${currentWarehouseId}:`, error);
      toast({ variant: "destructive", title: "Error al Actualizar Stock", description: `No se pudieron actualizar los stocks desde la base de datos para ${getWarehouseName(currentWarehouseId)}. ` });
    } finally {
      setIsRefreshingStock(false);
    }
 }, [currentWarehouseId, toast, getWarehouseName, setCountingList]); // Include setCountingList


    // --- Dialog Openers ---
    const handleOpenQuantityDialog = useCallback((product: DisplayProduct) => {
        setSelectedProductForDialog(product);
        setOpenQuantityDialog(true);
    }, []);

    const handleOpenStockDialog = useCallback((product: DisplayProduct) => {
        setSelectedProductForDialog(product);
        setOpenStockDialog(true);
    }, []);

    const handleCloseDialogs = () => {
        setOpenQuantityDialog(false);
        setOpenStockDialog(false);
        setSelectedProductForDialog(null);
    };

     // --- Warehouse Selection ---
    const handleWarehouseChange = (newWarehouseId: string) => {
        if (newWarehouseId !== currentWarehouseId) {
            console.log("Switching warehouse to:", newWarehouseId);
            setCurrentWarehouseId(newWarehouseId);
        }
    };


     const handleAddWarehouse = (newWarehouse: { id: string; name: string }) => {
        setWarehouses(prevWarehouses => {
            const isDuplicate = prevWarehouses.some(warehouse => warehouse.id === newWarehouse.id);
            if (isDuplicate) {
                toast({
                variant: 'destructive',
                title: 'Error',
                description: 'ID de almacén ya existe. Por favor, use un ID único.',
                });
                return prevWarehouses;
            }
             const updatedWarehouses = [...prevWarehouses, newWarehouse];
            return updatedWarehouses;
        });
    };

    const handleUpdateWarehouses = (updatedWarehouses: { id: string; name: string }[]) => {
        setWarehouses(updatedWarehouses);
        if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
            setCurrentWarehouseId(updatedWarehouses[0]?.id || 'main');
        }
    };

    // --- Camera Scanning Logic ---
    const handleScanButtonClick = () => {
        console.log("Scan button clicked, setting isScanning to true.");
        setIsScanning(true);
        startScanning();
    };

    const handleStopScanning = () => {
        console.log("Stop scanning button clicked, setting isScanning to false.");
        stopScanning();
        setIsScanning(false);
    };


 // --- Count by Provider ---
 const handleStartCountByProvider = useCallback(async (productsToCount: DisplayProduct[]) => {
    if (!productsToCount || productsToCount.length === 0) {
        toast({ title: "Vacío", description: "No hay productos para este proveedor en el almacén actual." });
        return;
    }
    setCountingList(productsToCount);
    setActiveSection("Contador");
    toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` });
 }, [toast, setActiveSection, setCountingList]); // Include setCountingList

  // Filter counting list based on search term
  const filteredCountingList = React.useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    if (!lowerSearchTerm) {
      return countingList;
    }
    return countingList.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) ||
      (product.provider || '').toLowerCase().includes(lowerSearchTerm)
    );
  }, [countingList, searchTerm]);

  const handleSectionChange = (newSection: string) => {
    setActiveSection(newSection);
  };

  // Get current value for the modify dialogs based on the latest state
  const getCurrentValueForDialog = (type: 'count' | 'stock') => {
    if (!selectedProductForDialog) return 0;
    const currentItem = countingList.find(
      p => p.barcode === selectedProductForDialog.barcode && p.warehouseId === currentWarehouseId
    );
    return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
  };

  // --- Main Component Render ---
  return (
    <div className="container mx-auto p-4">
      <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
         <h1 className="text-2xl font-bold text-gray-700 dark:text-gray-200">StockCounter Pro</h1>
         <div className="flex flex-wrap justify-center md:justify-end items-center gap-2 w-full md:w-auto">
              {warehouses.length > 0 && (
                 <div className="flex items-center gap-2">
                     <WarehouseIcon className="h-5 w-5 text-gray-600 dark:text-gray-400"/>
                      <Select value={currentWarehouseId} onValueChange={handleWarehouseChange}>
                          <SelectTrigger className="w-auto min-w-[150px] max-w-[200px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
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
               <Select value={activeSection} onValueChange={handleSectionChange}>
                    <SelectTrigger className="w-auto min-w-[150px] max-w-[200px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
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
                    </SelectContent>
                </Select>
         </div>
      </div>


      <div className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
        {activeSection === 'Contador' && (
            <div id="contador-content">
                <BarcodeEntry
                    barcode={barcode}
                    setBarcode={setBarcode}
                    onAddProduct={() => handleAddProduct()}
                    onScanClick={handleScanButtonClick}
                    onRefreshStock={handleRefreshStock}
                    isLoading={isDbLoading || isRefreshingStock || isBackingUp}
                    isScanning={isScannerInitializing || isScanning}
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
                    onOpenStockDialog={handleOpenStockDialog}
                    onOpenQuantityDialog={handleOpenQuantityDialog}
                    onDecrement={handleDecrement}
                    onIncrement={handleIncrement}
                    tableHeightClass="h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]"
                />

              <div className="mt-4 flex flex-col sm:flex-row justify-end items-center gap-2">
                 <Input
                    type="text"
                    placeholder="ID de Hoja de Google para Respaldo" // Input for Sheet ID
                    value={backupSheetId}
                    onChange={(e) => setBackupSheetId(e.target.value)}
                    className="w-full sm:w-auto flex-grow bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                    aria-label="ID de la Hoja de Google para respaldo"
                    disabled={isDbLoading || isBackingUp}
                 />
                 <Button
                      onClick={handleBackupToGoogleSheet}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                      disabled={countingList.length === 0 || isDbLoading || isBackingUp || !backupSheetId.trim()}
                      aria-label="Respaldar inventario actual a Google Sheet"
                 >
                      {isBackingUp ? (
                           <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                           <UploadCloud className="mr-2 h-4 w-4" />
                      )}
                      {isBackingUp ? "Respaldando..." : "Respaldar a Google Sheet"}
                 </Button>
                <Button
                    onClick={handleExport}
                     className="bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                     disabled={countingList.length === 0 || isDbLoading}
                     aria-label="Exportar inventario actual a CSV"
                 >
                      Exportar Inventario ({getWarehouseName(currentWarehouseId)})
                 </Button>
              </div>
            </div>
        )}

         {activeSection === 'Base de Datos' && (
            <div id="database-content">
               <ProductDatabase
                  currentWarehouseId={currentWarehouseId}
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
                  />
             </div>
           )}
      </div>

             {/* Render Modify Dialogs */}
             <ModifyValueDialog
                 isOpen={openQuantityDialog}
                 setIsOpen={setOpenQuantityDialog}
                 type="count"
                 product={selectedProductForDialog}
                 warehouseName={getWarehouseName(currentWarehouseId)}
                 currentValue={getCurrentValueForDialog('count')}
                 onIncrement={handleIncrement}
                 onDecrement={handleDecrement}
                 onSet={handleSetProductValue}
                 onClose={handleCloseDialogs}
             />
             <ModifyValueDialog
                 isOpen={openStockDialog}
                 setIsOpen={setOpenStockDialog}
                 type="stock"
                 product={selectedProductForDialog}
                 warehouseName={getWarehouseName(currentWarehouseId)}
                 currentValue={getCurrentValueForDialog('stock')}
                 onIncrement={handleIncrement}
                 onDecrement={handleDecrement}
                 onSet={handleSetProductValue}
                 onClose={handleCloseDialogs}
             />

            {/* Render Confirmation/Deletion Dialogs */}
             <ConfirmationDialog
                 isOpen={isConfirmQuantityDialogOpen}
                 onOpenChange={setIsConfirmQuantityDialogOpen}
                 title="Confirmar Modificación"
                 description={
                     confirmQuantityAction === 'set'
                         ? `La cantidad contada ahora coincide con el stock (${countingList.find(p => p.barcode === confirmQuantityProductBarcode)?.stock}). ¿Estás seguro de que deseas establecer la cantidad en ${confirmQuantityNewValue ?? 'este valor'}?`
                         : `La cantidad contada ${confirmQuantityAction === 'increment' ? 'alcanzará' : 'dejará de coincidir con'} el stock (${countingList.find(p => p.barcode === confirmQuantityProductBarcode)?.stock}). ¿Estás seguro de que deseas ${confirmQuantityAction === 'increment' ? 'aumentar' : 'disminuir'} la cantidad a ${confirmQuantityNewValue ?? 'este valor'}?`
                 }
                 onConfirm={handleConfirmQuantityChange}
                 onCancel={() => { setIsConfirmQuantityDialogOpen(false); setConfirmQuantityProductBarcode(null); setConfirmQuantityAction(null); setConfirmQuantityNewValue(null); }}
             />
             <ConfirmationDialog
                isOpen={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
                title="Confirmar Eliminación"
                description={`¿Estás seguro de que deseas eliminar el producto "${productToDelete?.description}" del inventario actual (${getWarehouseName(productToDelete?.warehouseId)})? Esta acción no se puede deshacer.`}
                onConfirm={confirmDelete}
                onCancel={() => setIsDeleteDialogOpen(false)}
                isDestructive={true}
             />

            {/* Render Scanner Modal using the new component */}
             <ScannerDialog
                 isOpen={isScanning}
                 onClose={handleStopScanning}
                 videoRef={videoRef}
                 isInitializing={isScannerInitializing}
                 hasPermission={hasCameraPermission}
             />

    </div>
  );
}
