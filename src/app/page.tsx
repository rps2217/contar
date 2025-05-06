// src/app/page.tsx
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
import { format, isValid } from 'date-fns';
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, Camera, AlertCircle, Search, Check, AppWindow, Database, Boxes, UploadCloud, Loader2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    addOrUpdateInventoryItem,
    getDisplayProductForWarehouse,
    getProductDetail,
    addOrUpdateProductDetail,
    getInventoryItemsForWarehouse,
    getAllProductDetails,
    getInventoryItem,
    deleteInventoryItem, // Ensure deleteInventoryItem is imported
} from '@/lib/firebase-helpers'; // Import Firebase helpers
import { backupToGoogleSheet } from './actions/backup-actions';
import { playBeep } from '@/lib/helpers';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { ScannerDialog } from '@/components/scanner-dialog';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { EditProductDialog } from '@/components/edit-product-dialog';
import { db } from '@/lib/firebase'; // Import Firestore instance
import { collection, onSnapshot, Timestamp, writeBatch } from 'firebase/firestore'; // Import Firestore listeners and writeBatch
import Papa from 'papaparse'; // Import PapaParse for export

// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_BACKUP_URL_KEY = 'stockCounterPro_backupUrl'; // Changed key name

// --- Main Component ---

export default function Home() {
  // LocalStorage for UI state
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
   const [backupUrl, setBackupUrl] = useLocalStorage<string>( // Renamed state variable
      LOCAL_STORAGE_BACKUP_URL_KEY,
      ''
  );

  // State managed in React component memory
  const [barcode, setBarcode] = useState("");
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
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
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null); // State to prevent double scans

  // Refs
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMountedRef = useRef(true); // Track component mount status

   // Set initial mount status
   useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false; // Cleanup on unmount
    };
  }, []);

  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
        if (!warehouseId) return 'N/A';
        const warehouse = warehouses.find(w => w.id === warehouseId);
        return warehouse ? warehouse.name : `Almacén (${warehouseId})`;
    }, [warehouses]);

 // --- Load Counting List from LocalStorage on Mount/Warehouse Change ---
 useEffect(() => {
    if (currentWarehouseId && isMountedRef.current) {
        console.log(`Attempting to load list for warehouse ${currentWarehouseId}`);
        const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`;
        const savedList = localStorage.getItem(savedListKey);
        let loadedList: DisplayProduct[] = [];
        if (savedList) {
            try {
                const parsedList: any[] = JSON.parse(savedList);
                if (Array.isArray(parsedList) && parsedList.every(item => typeof item?.barcode === 'string')) {
                     loadedList = parsedList
                        .filter(item => item.warehouseId === currentWarehouseId)
                        .map(item => ({
                            ...item,
                            stock: item.stock ?? 0,
                            count: item.count ?? 0,
                            lastUpdated: item.lastUpdated || new Date().toISOString(),
                        }));
                    console.log(`Loaded ${loadedList.length} items for warehouse ${currentWarehouseId} from localStorage.`);
                } else {
                    console.warn(`Invalid data structure in localStorage for warehouse ${currentWarehouseId}. Clearing.`);
                    localStorage.removeItem(savedListKey);
                }
            } catch (parseError) {
                console.error(`Error parsing localStorage data for warehouse ${currentWarehouseId}:`, parseError);
                localStorage.removeItem(savedListKey);
            }
        } else {
            console.log(`No counting list found in localStorage for warehouse ${currentWarehouseId}. Starting fresh.`);
        }
        setCountingList(loadedList);
        setIsDbLoading(false);
    } else if (!currentWarehouseId) {
         console.warn("No current warehouse ID selected, cannot load list.");
         setCountingList([]); // Clear list if no warehouse selected
         setIsDbLoading(false);
    }
 }, [currentWarehouseId]);

 // --- Save Counting List to LocalStorage ---
 useEffect(() => {
    if (!isDbLoading && currentWarehouseId && isMountedRef.current) {
        try {
            const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`;
            const listToSave = countingList.filter(item => item.warehouseId === currentWarehouseId);
            localStorage.setItem(key, JSON.stringify(listToSave));
            // console.log(`Saved ${listToSave.length} items for warehouse ${currentWarehouseId} to localStorage.`);
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
 }, [countingList, currentWarehouseId, isDbLoading, toast]); // Depend on countingList, currentWarehouseId, isDbLoading, toast


 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, ''); // Clean barcode

    if (!trimmedBarcode) {
      toast({ variant: "destructive", title: "Error", description: "Por favor, introduce un código de barras válido." });
      setBarcode("");
      requestAnimationFrame(() => barcodeInputRef.current?.focus());
      return;
    }
    if (!currentWarehouseId) {
        toast({ variant: "destructive", title: "Error", description: "No se ha seleccionado ningún almacén." });
        return;
    }
    // Debounce consecutive scans of the same barcode
    if (trimmedBarcode === lastScannedBarcode) {
        console.log("Duplicate scan detected, ignoring:", trimmedBarcode);
        setBarcode(""); // Clear input after duplicate scan
        requestAnimationFrame(() => barcodeInputRef.current?.focus());
        return;
    }
    setLastScannedBarcode(trimmedBarcode); // Set last scanned barcode
    setTimeout(() => setLastScannedBarcode(null), 500); // Clear after delay


    let descriptionForToast = '';

    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
      const productToUpdate = countingList[existingProductIndex];
      descriptionForToast = productToUpdate.description;
      const newCount = (productToUpdate.count ?? 0) + 1;
      const updatedProductData: DisplayProduct = {
        ...productToUpdate,
        count: newCount,
        lastUpdated: new Date().toISOString(),
      };

      setCountingList(prevList => {
        const updatedList = [...prevList];
        updatedList.splice(existingProductIndex, 1); // Remove old entry
        updatedList.unshift(updatedProductData); // Add updated entry to the beginning
        return updatedList;
      });

      toast({ title: "Cantidad aumentada", description: `${descriptionForToast} cantidad aumentada a ${newCount}.` });
      playBeep(880, 100);

    } else {
      setIsDbLoading(true);
      try {
        const displayProduct = await getDisplayProductForWarehouse(trimmedBarcode, currentWarehouseId);

        if (displayProduct) {
          descriptionForToast = displayProduct.description;
          const newProductForList: DisplayProduct = {
            ...displayProduct,
            count: 1,
            lastUpdated: new Date().toISOString(),
          };
          setCountingList(prev => [newProductForList, ...prev]);
          toast({ title: "Producto agregado", description: `${descriptionForToast} agregado al inventario (${getWarehouseName(currentWarehouseId)}).` });
          playBeep(660, 150);
        } else {
          const detailOnly = await getProductDetail(trimmedBarcode);
          playBeep(440, 300);

          if (detailOnly) {
              const newProductForList: DisplayProduct = {
                    ...detailOnly,
                    warehouseId: currentWarehouseId,
                    stock: 0,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                };
              descriptionForToast = newProductForList.description;
              setCountingList(prev => [newProductForList, ...prev]);
              toast({
                  title: "Producto Agregado (Nuevo en Almacén)",
                  description: `${descriptionForToast} agregado a ${getWarehouseName(currentWarehouseId)} con stock 0.`,
                  duration: 5000,
              });
               // Create inventory item in DB if it doesn't exist for this warehouse
              await addOrUpdateInventoryItem({
                  barcode: trimmedBarcode,
                  warehouseId: currentWarehouseId,
                  stock: 0,
                  count: 0, // Firestore count is not the session count
                  lastUpdated: new Date().toISOString()
              });

          } else {
               const newPlaceholderProduct: DisplayProduct = {
                    barcode: trimmedBarcode,
                    description: `Producto desconocido ${trimmedBarcode}`,
                    provider: "Desconocido",
                    warehouseId: currentWarehouseId,
                    stock: 0,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
               };
              descriptionForToast = newPlaceholderProduct.description;
              setCountingList(prev => [newPlaceholderProduct, ...prev]);
              toast({
                  variant: "destructive",
                  title: "Producto Desconocido",
                  description: `Producto ${trimmedBarcode} no encontrado en la base de datos. Agregado temporalmente al inventario. Edita los detalles en la sección 'Base de Datos'.`,
                  duration: 7000,
              });
               // Do NOT add placeholder to Firestore automatically. User should add via Database section.
          }
        }
      } catch (error) {
        console.error("Error fetching or adding product from Firestore:", error);
        toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo verificar o agregar el producto desde Firestore." });
        playBeep(440, 300);
      } finally {
        if (isMountedRef.current) { // Check if component is still mounted
          setIsDbLoading(false);
        }
      }
    }

    setBarcode("");
    requestAnimationFrame(() => barcodeInputRef.current?.focus());

 }, [barcode, currentWarehouseId, toast, getWarehouseName, countingList, setCountingList, lastScannedBarcode]);


 const handleScanSuccessCallback = useCallback((detectedBarcode: string) => {
    console.log("handleScanSuccess triggered with barcode:", detectedBarcode);
    if (!isMountedRef.current) return; // Check mount status

    requestAnimationFrame(() => {
        if (!isMountedRef.current) return; // Check again inside animation frame
        setIsScanning(false);
        handleAddProduct(detectedBarcode);
    });
 }, [handleAddProduct, setIsScanning]);


  const {
    isInitializing: isScannerInitializing,
    hasPermission: hasCameraPermission,
    startScanning,
    stopScanning,
  } = useBarcodeScanner({
    onScanSuccess: handleScanSuccessCallback,
    videoRef: videoRef,
    isEnabled: isScanning,
  });


 // Modify product count or LOCAL stock in the local counting list
 const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current) return;
    let productToConfirm: DisplayProduct | null = null;
    let needsConfirmation = false;
    let originalValue = -1;
    let updatedProductDescription = '';
    const warehouseId = currentWarehouseId;
    let finalValue = 0;

    let productIndex = -1;
    let updatedList: DisplayProduct[] = [];

    setCountingList(prevList => {
        productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
        if (productIndex === -1) return prevList;

        updatedList = [...prevList];
        const product = updatedList[productIndex];
        updatedProductDescription = product.description;

        if (type === 'count') {
            originalValue = product.count ?? 0;
            finalValue = Math.max(0, originalValue + change);

            if (product.stock !== 0) {
                const changingToMatch = finalValue === product.stock && originalValue !== product.stock;
                const changingFromMatch = originalValue === product.stock && finalValue !== product.stock;
                if (changingToMatch || changingFromMatch) {
                    productToConfirm = { ...product };
                    needsConfirmation = true;
                }
            }

            if (needsConfirmation) {
                 console.log(`Confirmation needed for ${product.barcode}. Final: ${finalValue}, Stock: ${product.stock}`);
                 // Do not update state here, let the confirmation dialog handle it
                 return prevList;
            } else {
                 console.log(`Updating count directly for ${product.barcode} to ${finalValue}`);
                 updatedList[productIndex] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
                 return updatedList; // Return the updated list
            }

        } else { // type === 'stock' - Update LOCAL list stock only
            originalValue = product.stock ?? 0;
            finalValue = Math.max(0, originalValue + change);
            updatedList[productIndex] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
             // Note: We are only updating the local list stock here.
             // Persisting this change to the DB needs to happen separately, typically via the EditProductDialog.
             // This immediate toast reflects the LOCAL change only.
             // Do not show toast here to avoid confusion, show it when the DB is updated.
            // toast({ title: "Stock (Local) Actualizado", description: `Stock local de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${finalValue}. Guarde en 'Base de Datos' para persistir.` });
            return updatedList; // Return the updated list
        }
    });

    // Trigger confirmation dialog AFTER state update attempt (if needed)
    if (needsConfirmation && productToConfirm && type === 'count') {
        setConfirmQuantityProductBarcode(productToConfirm.barcode);
        setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
        const potentialNewCount = Math.max(0, (productToConfirm.count ?? 0) + change);
        setConfirmQuantityNewValue(potentialNewCount);
        setIsConfirmQuantityDialogOpen(true);
    } else if (type === 'count' && !needsConfirmation && productIndex !== -1) {
          // Show immediate toast if no confirmation was needed and state update happened
          // Access the potentially updated item from the *new* list state (use effect or access directly if sync)
          // Since setCountingList is async, we might need to derive the final value here or pass it
           toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) cambiada a ${finalValue}.` });
    } else if (type === 'stock' && productIndex !== -1) {
        // Toast for LOCAL stock change
        toast({ title: "Stock (Local) Actualizado", description: `Stock local de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${finalValue}. Guarde los cambios de stock en 'Base de Datos'.`, duration: 5000});
    }

 }, [countingList, currentWarehouseId, toast, getWarehouseName, setCountingList]);


 const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
     if (!isMountedRef.current) return;
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
     let productIndex = -1;

     setCountingList(prevList => {
         productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (productIndex === -1) return prevList;

         const updatedList = [...prevList];
         const product = updatedList[productIndex];
         updatedProductDescription = product.description;

         if (type === 'count') {
             originalValue = product.count ?? 0;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
             finalValue = Math.max(0, finalValue); // Ensure non-negative

             // Check for confirmation only when setting to match stock
             if (product.stock !== 0 && finalValue === product.stock && originalValue !== product.stock) {
                 needsConfirmation = true;
                 productToConfirm = { ...product };
             }

             if (needsConfirmation) {
                  console.log(`Confirmation needed for 'set' ${product.barcode}. Final: ${finalValue}, Stock: ${product.stock}`);
                  // Do not update state yet, let confirmation handle it
                  return prevList;
             } else {
                 console.log(`Updating count directly for 'set' ${product.barcode} to ${finalValue}`);
                 updatedList[productIndex] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
                 return updatedList; // Return the updated list
             }
         } else { // type === 'stock' - Update LOCAL list stock only
             originalValue = product.stock ?? 0;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
             finalValue = Math.max(0, finalValue); // Ensure non-negative

             updatedList[productIndex] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
              // Do not show toast here, show it when the DB is updated.
             // toast({ title: "Stock (Local) Actualizado", description: `Stock local de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${finalValue}. Guarde en 'Base de Datos' para persistir.` });
             return updatedList; // Return the updated list
         }
     });

      // Trigger confirmation dialog AFTER state update attempt (if needed)
      if (needsConfirmation && productToConfirm && type === 'count') {
          setConfirmQuantityProductBarcode(productToConfirm.barcode);
          setConfirmQuantityAction('set');
          setConfirmQuantityNewValue(finalValue);
          setIsConfirmQuantityDialogOpen(true);
      } else if (type === 'count' && !needsConfirmation && productIndex !== -1) {
           // Show toast for count change if no confirmation was needed
           const actionText = sumValue ? "sumada a" : "establecida en";
           toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) ${actionText} ${finalValue}.` });
           // Close the quantity dialog only if no confirmation is pending
           setOpenQuantityDialog(false);
           setSelectedProductForDialog(null);
      } else if (type === 'stock' && productIndex !== -1) {
           // Show toast for LOCAL stock change
            const actionText = sumValue ? "sumado a" : "establecido en";
           toast({ title: "Stock (Local) Actualizado", description: `Stock local de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) ${actionText} ${finalValue}. Guarde los cambios de stock en 'Base de Datos'.`, duration: 5000});
           // Close the stock dialog immediately after local update
           setOpenStockDialog(false);
           setSelectedProductForDialog(null);
      }

      // If confirmation was triggered, dialogs remain open until confirmation action

 }, [countingList, currentWarehouseId, toast, getWarehouseName, setCountingList]);


 const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    modifyProductValue(barcode, type, 1);
 }, [modifyProductValue]);

 const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    modifyProductValue(barcode, type, -1);
 }, [modifyProductValue]);

 const handleConfirmQuantityChange = useCallback(() => {
    if (!isMountedRef.current) return;
    let descriptionForToast = '';
    let finalConfirmedCount = 0;
    const warehouseId = currentWarehouseId;

    if (confirmQuantityProductBarcode && confirmQuantityAction !== null && confirmQuantityNewValue !== null) {
         setCountingList(prevList => {
             const index = prevList.findIndex(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === warehouseId);
             if (index === -1) return prevList;

             const updatedList = [...prevList];
             const product = updatedList[index];
             descriptionForToast = product.description;
             finalConfirmedCount = Math.max(0, confirmQuantityNewValue); // Ensure non-negative

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
     // Close the quantity dialog after confirmation
      setOpenQuantityDialog(false);
      setSelectedProductForDialog(null);
}, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, toast, getWarehouseName, confirmQuantityNewValue, setCountingList]);


 // --- Deletion from Counting List ---
 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
        setProductToDelete(product);
        setIsDeleteDialogOpen(true);
 }, []);

 const confirmDelete = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (productToDelete) {
        const descriptionForToast = productToDelete.description;
        const warehouseId = productToDelete.warehouseId;

        // 1. Remove from the local counting list state
        setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));

        // 2. Optionally: Delete the corresponding inventory item from Firestore
        // Be careful: This permanently removes the item for this warehouse from the DB.
        // Only do this if the intent is to fully remove the item record for this warehouse,
        // not just clear it from the current counting session.
        // Consider if you want a separate "clear count" vs "delete record" action.
        // try {
        //     await deleteInventoryItem(productToDelete.barcode, warehouseId);
        //     toast({
        //         title: "Producto eliminado",
        //         description: `${descriptionForToast} ha sido eliminado del inventario actual (${getWarehouseName(warehouseId)}) y de la base de datos para este almacén.`,
        //         variant: "default"
        //     });
        // } catch (error) {
        //     console.error("Error deleting inventory item from Firestore:", error);
        //     toast({
        //         title: "Error al eliminar de DB",
        //         description: `No se pudo eliminar ${descriptionForToast} de la base de datos.`,
        //         variant: "destructive"
        //     });
        // }

        // If only removing from the current list:
         toast({
             title: "Producto eliminado (Lista Actual)",
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
            CodigoBarras: p.barcode,
            Descripcion: p.description,
            Proveedor: p.provider,
            Almacen: getWarehouseName(p.warehouseId),
            StockSistema: p.stock ?? 0,
            CantidadContada: p.count ?? 0,
            UltimaActualizacion: p.lastUpdated ? format(new Date(p.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
        }));

        const csv = Papa.unparse(dataToExport, { header: true });
        const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
        link.setAttribute("download", `conteo_inventario_${currentWarehouseId}_${timestamp}.csv`);
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


 const handleBackupToGoogleSheet = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (countingList.length === 0) {
        toast({ title: "Vacío", description: "No hay productos en el inventario actual para respaldar." });
        return;
    }
     // Validate the backup URL (expecting full sheet URL)
     if (!backupUrl.trim() || !backupUrl.startsWith('https://docs.google.com/spreadsheets/d/')) {
        toast({
            variant: "destructive",
            title: "URL de Hoja Inválida",
            description: "Introduce una URL válida de Google Sheets para el respaldo.",
        });
        return;
    }
    setIsBackingUp(true);
    try {
        const currentWHName = getWarehouseName(currentWarehouseId);
        // Pass the full URL to the server action
        const result = await backupToGoogleSheet(countingList, currentWHName, backupUrl);

        if (result.success) {
            toast({ title: "Respaldo Exitoso", description: result.message });
        } else {
            toast({ variant: "destructive", title: "Error de Respaldo", description: result.message, duration: 9000 });
        }
    } catch (error: any) {
        console.error("Error calling backupToGoogleSheet Server Action:", error);
        toast({ variant: "destructive", title: "Error de Respaldo", description: error.message || "Ocurrió un error inesperado al intentar respaldar.", duration: 9000 });
    } finally {
        if (isMountedRef.current) {
             setIsBackingUp(false);
        }
    }
 }, [countingList, currentWarehouseId, getWarehouseName, toast, backupUrl]); // Use backupUrl


 // --- Stock Refresh from Firestore ---
 const handleRefreshStock = useCallback(async () => {
    if (!currentWarehouseId || !isMountedRef.current) return;
    setIsRefreshingStock(true);
    console.log(`Refreshing stock and product details for warehouse ${currentWarehouseId} from Firestore...`);
    try {
      const [allDbDetails, warehouseDbInventory] = await Promise.all([
        getAllProductDetails(),
        getInventoryItemsForWarehouse(currentWarehouseId),
      ]);

      const detailsMap = new Map<string, ProductDetail>();
      allDbDetails.forEach(detail => detailsMap.set(detail.barcode, detail));

      const inventoryMap = new Map<string, InventoryItem>();
      warehouseDbInventory.forEach(item => inventoryMap.set(item.barcode, item));

      setCountingList(prevCountingList => {
        const updatedList = prevCountingList.map(countingProduct => {
          const dbDetail = detailsMap.get(countingProduct.barcode);
          const dbInventory = inventoryMap.get(countingProduct.barcode);

          return {
            ...countingProduct,
            description: dbDetail?.description ?? countingProduct.description,
            provider: dbDetail?.provider ?? countingProduct.provider,
            stock: dbInventory?.stock ?? countingProduct.stock ?? 0,
            lastUpdated: new Date().toISOString(),
          };
        });

         warehouseDbInventory.forEach(dbItem => {
             if (!updatedList.some(cp => cp.barcode === dbItem.barcode && cp.warehouseId === currentWarehouseId)) {
                 const dbDetail = detailsMap.get(dbItem.barcode);
                 if (dbDetail) {
                     updatedList.push({
                         ...dbDetail,
                         warehouseId: currentWarehouseId,
                         stock: dbItem.stock ?? 0,
                         count: 0, // Items added during refresh start with 0 count
                         lastUpdated: dbItem.lastUpdated || new Date().toISOString(),
                     });
                 }
             }
         });

        // Re-sort the list to potentially keep a specific order if needed, e.g., by lastUpdated descending
        updatedList.sort((a, b) => new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime());

        return updatedList;
      });

      toast({ title: "Datos Actualizados", description: `Stock y detalles para ${getWarehouseName(currentWarehouseId)} actualizados desde Firestore.` });
      console.log("Stock and product details refreshed from Firestore for warehouse:", currentWarehouseId);

    } catch (error) {
      console.error(`Error refreshing stock and details for warehouse ${currentWarehouseId}:`, error);
      toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar los datos desde Firestore para ${getWarehouseName(currentWarehouseId)}. ` });
    } finally {
      if (isMountedRef.current) {
          setIsRefreshingStock(false);
      }
    }
 }, [currentWarehouseId, toast, getWarehouseName, setCountingList]);


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

    const handleWarehouseChange = (newWarehouseId: string) => {
        if (newWarehouseId !== currentWarehouseId) {
            console.log("Switching warehouse to:", newWarehouseId);
            setIsDbLoading(true); // Set loading state while list is reloaded
            setCurrentWarehouseId(newWarehouseId);
            // The useEffect for currentWarehouseId will handle loading/clearing the list
        }
    };


     const handleAddWarehouse = (newWarehouse: { id: string; name: string }) => {
        setWarehouses(prevWarehouses => {
            const isDuplicate = prevWarehouses.some(warehouse => warehouse.id === newWarehouse.id);
            if (isDuplicate) {
                toast({ variant: 'destructive', title: 'Error', description: 'ID de almacén ya existe.' });
                return prevWarehouses;
            }
             const updatedWarehouses = [...prevWarehouses, newWarehouse];
             setCurrentWarehouseId(newWarehouse.id);
             toast({title: "Almacén Agregado", description: `Cambiado al nuevo almacén: ${newWarehouse.name}`});
            return updatedWarehouses;
        });
    };

    const handleUpdateWarehouses = (updatedWarehouses: { id: string; name: string }[]) => {
        setWarehouses(updatedWarehouses);
        // If the current warehouse was deleted, switch to the first available one
        if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
            const newCurrentId = updatedWarehouses[0]?.id || 'main';
            if (newCurrentId !== currentWarehouseId) {
                handleWarehouseChange(newCurrentId); // Use the change handler
                toast({title: "Almacén Actualizado", description: `Almacén actual cambiado a ${getWarehouseName(newCurrentId)}.`});
            }
        }
    };

    const handleScanButtonClick = () => {
        console.log("Scan button clicked, requesting scanner start.");
        if (!isScanning) {
            setIsScanning(true);
        }
    };

    const handleStopScanning = () => {
        console.log("Stop scanning button clicked, requesting scanner stop.");
        if (isScanning) {
            setIsScanning(false);
        }
         requestAnimationFrame(() => barcodeInputRef.current?.focus());
    };

   // --- Edit Product Detail Dialog Logic (triggered from Counting List) ---
   const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
   const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
   const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0);

   const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct) => {
       if (!product || !product.barcode || !isMountedRef.current) return;
       setIsDbLoading(true);
       try {
           const detail = await getProductDetail(product.barcode);
           const inventoryItem = await getInventoryItem(product.barcode, currentWarehouseId);

           if (detail) {
                if (!isMountedRef.current) return; // Check again after async op
               setProductToEditDetail(detail);
               setInitialStockForEdit(inventoryItem?.stock ?? 0); // Use stock from CURRENT warehouse inventory
               setIsEditDetailDialogOpen(true);
           } else {
                 if (!isMountedRef.current) return;
               toast({ variant: "destructive", title: "Error", description: "Detalles del producto no encontrados en la base de datos." });
           }
       } catch (error) {
            if (!isMountedRef.current) return;
           console.error("Error fetching product details/inventory for edit:", error);
           toast({ variant: "destructive", title: "Error DB", description: "No se pudieron obtener los datos del producto para editar." });
       } finally {
            if (isMountedRef.current) {
                 setIsDbLoading(false);
            }
       }
   }, [toast, currentWarehouseId]);


   const handleEditDetailSubmit = useCallback(async (data: ProductDetail & { stock: number }) => {
       if (!isMountedRef.current) return;
       const detailData: ProductDetail = {
           barcode: data.barcode,
           description: data.description,
           provider: data.provider,
       };
       const stockForCurrentWarehouse = data.stock;

       setIsDbLoading(true);
       try {
           // Update product details (globally)
           await addOrUpdateProductDetail(detailData);

           // Update inventory item specifically for the CURRENT warehouse
           const currentInventoryItem = await getInventoryItem(data.barcode, currentWarehouseId);
           const updatedCurrentInventory: InventoryItem = {
                barcode: data.barcode,
                warehouseId: currentWarehouseId,
                stock: stockForCurrentWarehouse,
                count: currentInventoryItem?.count ?? 0, // Preserve existing count from DB if needed, otherwise use local list count?
                lastUpdated: new Date().toISOString(),
           };
           await addOrUpdateInventoryItem(updatedCurrentInventory);

            if (!isMountedRef.current) return; // Check after async

           // Refresh the local counting list state to reflect changes immediately
            setCountingList(prevList => prevList.map(item =>
                item.barcode === data.barcode && item.warehouseId === currentWarehouseId
                    ? { ...item, ...detailData, stock: stockForCurrentWarehouse, lastUpdated: new Date().toISOString() }
                    : item
            ));

           toast({
               title: "Producto Actualizado",
               description: `${detailData.description} ha sido actualizado en ${getWarehouseName(currentWarehouseId)}.`,
           });
           setIsEditDetailDialogOpen(false);
       } catch (error: any) {
            if (!isMountedRef.current) return;
           console.error("Failed to update product detail/stock:", error);
           toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
       } finally {
            if (isMountedRef.current) {
                setIsDbLoading(false);
                setProductToEditDetail(null);
            }
       }
   }, [toast, currentWarehouseId, getWarehouseName, setCountingList]);


 const handleStartCountByProvider = useCallback(async (productsToCount: DisplayProduct[]) => {
    if (!isMountedRef.current) return;
    if (!productsToCount || productsToCount.length === 0) {
        toast({ title: "Vacío", description: "No hay productos para este proveedor en el almacén actual." });
        return;
    }
    const productsWithWarehouseId = productsToCount.map(p => ({
         ...p,
         warehouseId: currentWarehouseId,
         count: 0, // Reset count for the counting session
         lastUpdated: new Date().toISOString(), // Set fresh timestamp
     }));
     setCountingList(productsWithWarehouseId); // Replace current list
     setActiveSection("Contador");
     toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para ${getWarehouseName(currentWarehouseId)}.` });
 }, [toast, setActiveSection, setCountingList, currentWarehouseId, getWarehouseName]);

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
    if (newSection === 'Contador') {
       requestAnimationFrame(() => barcodeInputRef.current?.focus());
    }
    if (newSection !== 'Contador' && isScanning) {
       handleStopScanning();
    }
  };

  // Function to get the latest value for the Modify Dialog
  const getCurrentValueForDialog = (type: 'count' | 'stock') => {
    if (!selectedProductForDialog || !isMountedRef.current) return 0;
    // Find the latest state from the countingList
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

      {/* Main content area based on activeSection */}
      <div className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
        {activeSection === 'Contador' && (
            <div id="contador-content">
                <BarcodeEntry
                    barcode={barcode}
                    setBarcode={setBarcode}
                    onAddProduct={() => handleAddProduct()}
                    onScanClick={handleScanButtonClick}
                    onRefreshStock={handleRefreshStock}
                    isLoading={isDbLoading || isRefreshingStock || isBackingUp || isScannerInitializing}
                    isScanning={isScanning}
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
                    onEditDetailRequest={handleOpenEditDetailDialog}
                    tableHeightClass="h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]"
                />

              <div className="mt-4 flex flex-col sm:flex-row justify-end items-center gap-2">
                 <Input
                    type="url"
                    placeholder="URL de Hoja Google para Respaldo" // Changed placeholder
                    value={backupUrl} // Use backupUrl state
                    onChange={(e) => setBackupUrl(e.target.value)} // Update backupUrl state
                    className="w-full sm:w-auto flex-grow bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                    aria-label="URL de la Hoja de Google para respaldo" // Updated label
                    disabled={isDbLoading || isBackingUp}
                 />
                 <Button
                      onClick={handleBackupToGoogleSheet}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                      disabled={countingList.length === 0 || isDbLoading || isBackingUp || !backupUrl.trim()} // Check backupUrl
                      aria-label="Respaldar inventario actual a Google Sheet" // Updated label
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

             {/* Render Modify Dialogs for Count and LOCAL Stock Adjustment */}
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

            {/* Confirmation for Count Change */}
             <ConfirmationDialog
                 isOpen={isConfirmQuantityDialogOpen}
                 onOpenChange={setIsConfirmQuantityDialogOpen}
                 title="Confirmar Modificación"
                 description={
                    confirmQuantityNewValue !== null && selectedProductForDialog?.stock === confirmQuantityNewValue
                        ? `La cantidad contada (${confirmQuantityNewValue}) ahora coincide con el stock del sistema para "${selectedProductForDialog?.description}". ¿Confirmar?`
                        : `Está a punto de modificar la cantidad contada para "${selectedProductForDialog?.description}". ¿Continuar?`
                 }
                 onConfirm={handleConfirmQuantityChange}
                 onCancel={() => {
                     setIsConfirmQuantityDialogOpen(false);
                     setConfirmQuantityProductBarcode(null);
                     setConfirmQuantityAction(null);
                     setConfirmQuantityNewValue(null);
                     // Important: Keep the main dialog open if confirmation is cancelled
                     // Do not call handleCloseDialogs() here
                 }}
             />
              {/* Confirmation for Deleting from Counting List */}
             <ConfirmationDialog
                isOpen={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
                title="Confirmar Eliminación (Lista Actual)"
                description={`¿Seguro que deseas eliminar "${productToDelete?.description}" del inventario actual (${getWarehouseName(productToDelete?.warehouseId)})? Esta acción no se puede deshacer.`}
                onConfirm={confirmDelete}
                onCancel={() => setIsDeleteDialogOpen(false)}
                isDestructive={true}
             />

             {/* Scanner Dialog (Modal) */}
              <ScannerDialog
                  isOpen={isScanning}
                  onClose={handleStopScanning}
                  videoRef={videoRef}
                  isInitializing={isScannerInitializing}
                  hasPermission={hasCameraPermission}
              />


            {/* Dialog for Editing Product Details AND Database Stock */}
             <EditProductDialog
                isOpen={isEditDetailDialogOpen}
                setIsOpen={setIsEditDetailDialogOpen}
                selectedDetail={productToEditDetail}
                setSelectedDetail={setProductToEditDetail}
                onSubmit={handleEditDetailSubmit}
                onDelete={ (barcode) => {
                     console.warn("Delete action from counting list edit dialog needs review. Deleting from DB directly.");
                     // Implement direct deletion from DB if needed, or guide user to DB section
                     // For now, just show a message.
                     toast({variant: "default", title: "Info", description: "Para eliminar permanentemente, usa la sección 'Base de Datos'."})
                     setIsEditDetailDialogOpen(false); // Close dialog after info
                     setSelectedDetail(null);
                 }}
                isProcessing={isDbLoading}
                initialStock={initialStockForEdit}
                context="countingList" // Indicate context
             />


    </div>
  );
}
