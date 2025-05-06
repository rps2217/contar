// src/app/page.tsx
"use client";

import type { DisplayProduct, InventoryItem, ProductDetail } from '@/types/product';
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
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, Camera, AlertCircle, Search, Check, AppWindow, Database, Boxes, UploadCloud, Loader2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
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
import {
    addOrUpdateProductToDB,
    getProductFromDB,
    getAllProductsFromDB,
    deleteProductFromDB,
} from '@/lib/database'; // Import IndexedDB helpers

// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_BACKUP_URL_KEY = 'stockCounterPro_backupUrl';

// --- Main Component ---

export default function Home() {
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
  const [backupUrl, setBackupUrl] = useLocalStorage<string>(
      LOCAL_STORAGE_BACKUP_URL_KEY,
      ''
  );

  // --- Component State ---
  const [barcode, setBarcode] = useState("");
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [openModifyDialog, setOpenModifyDialog] = useState< { type: 'count' | 'stock', product: DisplayProduct | null } | null>(null);
  const [isConfirmQuantityDialogOpen, setIsConfirmQuantityDialogOpen] = useState(false);
  const [confirmQuantityAction, setConfirmQuantityAction] = useState<'increment' | 'decrement' | 'set' | null>(null);
  const [confirmQuantityProductBarcode, setConfirmQuantityProductBarcode] = useState<string | null>(null);
  const [confirmQuantityNewValue, setConfirmQuantityNewValue] = useState<number | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true); // Tracks loading for IndexedDB operations or initial list load
  const [isRefreshingStock, setIsRefreshingStock] = useState(false); // For the refresh button action specifically
  const [isScanning, setIsScanning] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null); // Detail only for edit dialog
  const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0); // Initial stock for edit dialog

  // --- Refs ---
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMountedRef = useRef(true); // Track component mount status

  // --- Effects ---

  // Set initial mount status and cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false; // Cleanup on unmount
    };
  }, []);

  // Load Counting List from LocalStorage on Mount/Warehouse Change
  useEffect(() => {
    if (!currentWarehouseId || !isMountedRef.current) {
        setIsDbLoading(false);
        setCountingList([]);
        return;
    }

    console.log(`Attempting to load list for warehouse ${currentWarehouseId}`);
    const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`;
    const savedList = getLocalStorageItem<DisplayProduct[]>(savedListKey, []);

    if (Array.isArray(savedList) && savedList.every(item => typeof item?.barcode === 'string')) {
        const loadedList = savedList
            .filter(item => item.warehouseId === currentWarehouseId) // Ensure items belong to the current warehouse
            .map(item => ({
                ...item,
                stock: item.stock ?? 0,
                count: item.count ?? 0,
                lastUpdated: item.lastUpdated || new Date().toISOString(),
            }));
        console.log(`Loaded ${loadedList.length} items for warehouse ${currentWarehouseId} from localStorage.`);
        setCountingList(loadedList);
    } else {
        console.warn(`Invalid data structure in localStorage for warehouse ${currentWarehouseId}. Clearing.`);
        localStorage.removeItem(savedListKey); // Remove invalid data
        setCountingList([]);
    }
    setIsDbLoading(false);

 }, [currentWarehouseId]); // Depend only on warehouseId

  // Save Counting List to LocalStorage
  useEffect(() => {
    if (!isDbLoading && currentWarehouseId && isMountedRef.current) {
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`;
        const listToSave = countingList.filter(item => item.warehouseId === currentWarehouseId);
        setLocalStorageItem(key, listToSave);
    }
  }, [countingList, currentWarehouseId, isDbLoading]); // Depend on countingList, currentWarehouseId, isDbLoading

  // --- Callbacks ---

  // Get warehouse name from ID
  const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
        if (!warehouseId) return 'N/A';
        const warehouse = warehouses.find(w => w.id === warehouseId);
        return warehouse ? warehouse.name : `Almacén (${warehouseId})`;
  }, [warehouses]);

  // Handle adding a product (from barcode input or scan)
  const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, '');

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
        setBarcode("");
        requestAnimationFrame(() => barcodeInputRef.current?.focus());
        return;
    }
    setLastScannedBarcode(trimmedBarcode);
    setTimeout(() => setLastScannedBarcode(null), 500); // Clear after delay

    let descriptionForToast = '';
    let updatedList: DisplayProduct[] = []; // Use a temporary list for state update

    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
      // --- Product exists in counting list, increment count ---
      const productToUpdate = countingList[existingProductIndex];
      descriptionForToast = productToUpdate.description;
      const newCount = (productToUpdate.count ?? 0) + 1;
      const updatedProductData: DisplayProduct = {
        ...productToUpdate,
        count: newCount,
        lastUpdated: new Date().toISOString(),
      };

      // Optimistic update: Move updated item to the beginning
      updatedList = [updatedProductData, ...countingList.filter((_, index) => index !== existingProductIndex)];
      setCountingList(updatedList);

      toast({ title: "Cantidad aumentada", description: `${descriptionForToast} cantidad aumentada a ${newCount}.` });
      playBeep(880, 100);

    } else {
      // --- Product not in counting list, fetch from DB ---
      setIsDbLoading(true); // Show loading indicator for DB access
      try {
        // Fetch product details from IndexedDB
        const dbProduct = await getProductFromDB(trimmedBarcode);

        if (dbProduct) {
          // --- Product found in DB ---
          descriptionForToast = dbProduct.description;
          const newProductForList: DisplayProduct = {
            ...dbProduct,
            warehouseId: currentWarehouseId, // Add warehouse context
            stock: dbProduct.stockPerWarehouse?.[currentWarehouseId] ?? 0, // Get stock for current warehouse
            count: 1, // Start count at 1
            lastUpdated: new Date().toISOString(),
          };
          updatedList = [newProductForList, ...countingList]; // Add to beginning
          setCountingList(updatedList);
          toast({ title: "Producto agregado", description: `${descriptionForToast} agregado al inventario (${getWarehouseName(currentWarehouseId)}).` });
          playBeep(660, 150);

        } else {
          // --- Product not found in DB ---
          playBeep(440, 300);
          const newPlaceholderProduct: DisplayProduct = {
                barcode: trimmedBarcode,
                description: `Producto desconocido ${trimmedBarcode}`,
                provider: "Desconocido",
                warehouseId: currentWarehouseId,
                stock: 0, // Default stock to 0
                count: 1,
                lastUpdated: new Date().toISOString(),
          };
          descriptionForToast = newPlaceholderProduct.description;
          updatedList = [newPlaceholderProduct, ...countingList]; // Add placeholder to beginning
          setCountingList(updatedList);
          toast({
              variant: "destructive",
              title: "Producto Desconocido",
              description: `Producto ${trimmedBarcode} no encontrado en la base de datos. Agregado temporalmente al inventario. Edita los detalles en la sección 'Base de Datos'.`,
              duration: 7000,
          });
          // Do NOT add placeholder to IndexedDB automatically. User should add via Database section.
        }
      } catch (error) {
        console.error("Error fetching or adding product from IndexedDB:", error);
        toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo verificar o agregar el producto desde la base de datos local." });
        playBeep(440, 300);
      } finally {
        if (isMountedRef.current) {
          setIsDbLoading(false);
        }
      }
    }

    setBarcode(""); // Clear input field
    requestAnimationFrame(() => barcodeInputRef.current?.focus()); // Refocus for next scan

  }, [barcode, currentWarehouseId, countingList, getWarehouseName, lastScannedBarcode, toast]);

  // Handle successful barcode scan from the hook
  const handleScanSuccessCallback = useCallback((detectedBarcode: string) => {
    console.log("handleScanSuccess triggered with barcode:", detectedBarcode);
    if (!isMountedRef.current) return;

    requestAnimationFrame(() => {
        if (!isMountedRef.current) return;
        setIsScanning(false); // Close the scanner dialog
        handleAddProduct(detectedBarcode); // Add the scanned product
    });
  }, [handleAddProduct]);

  // Initialize the barcode scanner hook
  const {
    isInitializing: isScannerInitializing,
    hasPermission: hasCameraPermission,
    // startScanning, // Not directly used, controlled by isScanning state
    // stopScanning, // Not directly used, controlled by isScanning state
  } = useBarcodeScanner({
    onScanSuccess: handleScanSuccessCallback,
    videoRef: videoRef,
    isEnabled: isScanning,
  });

  // Modify product value (count or local stock) in the counting list
  const modifyProductValue = useCallback((barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current) return;

    setCountingList(prevList => {
        const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
        if (productIndex === -1) return prevList; // Product not found

        const updatedList = [...prevList];
        const product = updatedList[productIndex];
        const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
        const finalValue = Math.max(0, originalValue + change); // Calculate new value, ensure non-negative

        // Confirmation logic for count changes matching stock
        if (type === 'count' && product.stock !== 0) {
            const changingToMatch = finalValue === product.stock && originalValue !== product.stock;
            const changingFromMatch = originalValue === product.stock && finalValue !== product.stock;
            if (changingToMatch || changingFromMatch) {
                // Trigger confirmation dialog instead of updating state directly
                setConfirmQuantityProductBarcode(product.barcode);
                setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
                setConfirmQuantityNewValue(finalValue);
                setIsConfirmQuantityDialogOpen(true);
                return prevList; // Don't update state yet
            }
        }

        // Update the product in the list
        updatedList[productIndex] = {
            ...product,
            [type]: finalValue,
            lastUpdated: new Date().toISOString()
        };

        // Show toast message immediately for the change (unless confirmation was triggered)
        const valueTypeText = type === 'count' ? 'Cantidad' : 'Stock (Local)';
        const warehouseNameText = getWarehouseName(currentWarehouseId);
        const descriptionText = product.description;
        toast({
            title: `${valueTypeText} Modificada`,
            description: `${valueTypeText} de ${descriptionText} (${warehouseNameText}) cambiada a ${finalValue}.` +
                         (type === 'stock' ? " Guarde los cambios de stock en 'Base de Datos'." : ""),
            duration: type === 'stock' ? 5000 : 3000
        });

        return updatedList; // Return the updated list
    });

  }, [currentWarehouseId, getWarehouseName, toast]);

  // Handle setting product value (count or local stock) directly from dialog
  const handleSetProductValue = useCallback((barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
      if (!isMountedRef.current) return;
      if (newValue < 0 || isNaN(newValue)) {
          toast({ variant: "destructive", title: "Valor Inválido", description: "La cantidad o stock debe ser un número positivo." });
          return;
      }

      setCountingList(prevList => {
          const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
          if (productIndex === -1) return prevList;

          const updatedList = [...prevList];
          const product = updatedList[productIndex];
          const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
          let finalValue = sumValue ? (originalValue + newValue) : newValue;
          finalValue = Math.max(0, finalValue); // Ensure non-negative

          // Confirmation logic for count changes matching stock
          if (type === 'count' && product.stock !== 0 && finalValue === product.stock && originalValue !== product.stock) {
              // Trigger confirmation dialog
              setConfirmQuantityProductBarcode(product.barcode);
              setConfirmQuantityAction('set');
              setConfirmQuantityNewValue(finalValue);
              setIsConfirmQuantityDialogOpen(true);
              return prevList; // Don't update state yet
          }

          // Update the product in the list
          updatedList[productIndex] = {
              ...product,
              [type]: finalValue,
              lastUpdated: new Date().toISOString()
          };

          // Show toast message
          const valueTypeText = type === 'count' ? 'Cantidad' : 'Stock (Local)';
          const actionText = sumValue ? "sumada a" : "establecida en";
          const warehouseNameText = getWarehouseName(currentWarehouseId);
          const descriptionText = product.description;
          toast({
              title: `${valueTypeText} Modificada`,
              description: `${valueTypeText} de ${descriptionText} (${warehouseNameText}) ${actionText} ${finalValue}.` +
                           (type === 'stock' ? " Guarde los cambios de stock en 'Base de Datos'." : ""),
              duration: type === 'stock' ? 5000 : 3000
          });

          // Close the dialog immediately if no confirmation is needed
          setOpenModifyDialog(null);

          return updatedList; // Return the updated list
      });

  }, [currentWarehouseId, getWarehouseName, toast]);

  // Handlers for increment/decrement buttons
  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, 1);
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
     modifyProductValue(barcode, type, -1);
  }, [modifyProductValue]);

  // Handle confirmation of quantity change
  const handleConfirmQuantityChange = useCallback(() => {
     if (!isMountedRef.current || !confirmQuantityProductBarcode || confirmQuantityAction === null || confirmQuantityNewValue === null) {
         console.warn("Confirmation attempted with invalid state.");
         setIsConfirmQuantityDialogOpen(false); // Close dialog anyway
         return;
     }

     const warehouseId = currentWarehouseId;
     const barcodeToUpdate = confirmQuantityProductBarcode;
     const newValue = confirmQuantityNewValue;

     setCountingList(prevList => {
         const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (index === -1) return prevList;

         const updatedList = [...prevList];
         const product = updatedList[index];
         const finalConfirmedCount = Math.max(0, newValue); // Ensure non-negative

         updatedList[index] = {
             ...product,
             count: finalConfirmedCount,
             lastUpdated: new Date().toISOString()
         };

         toast({ title: "Cantidad Modificada", description: `Cantidad de ${product.description} (${getWarehouseName(warehouseId)}) cambiada a ${finalConfirmedCount}.` });

         return updatedList;
     });

     // Reset confirmation state and close dialogs
     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
     setOpenModifyDialog(null); // Close the main modify dialog as well

 }, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, getWarehouseName]);

 // Request deletion of a product from the counting list
 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         setProductToDelete(product);
         setIsDeleteDialogOpen(true);
  }, []);

 // Confirm deletion from the counting list
 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete) return;

     const descriptionForToast = productToDelete.description;
     const warehouseId = productToDelete.warehouseId;

     // Remove from the local counting list state
     setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));

     // No IndexedDB deletion needed here, just removing from the current session list
     toast({
          title: "Producto eliminado (Lista Actual)",
          description: `${descriptionForToast} ha sido eliminado del inventario actual (${getWarehouseName(warehouseId)}).`,
          variant: "default"
      });

     setIsDeleteDialogOpen(false);
     setProductToDelete(null);
 }, [productToDelete, toast, getWarehouseName]);

 // Export current counting list to CSV
 const handleExport = useCallback(() => {
     // Implementation remains the same, using PapaParse which is now correctly imported
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

 // Backup counting list to Google Sheet
 const handleBackupToGoogleSheet = useCallback(async () => {
     if (!isMountedRef.current) return;
     if (countingList.length === 0) {
         toast({ title: "Vacío", description: "No hay productos en el inventario actual para respaldar." });
         return;
     }
     if (!backupUrl.trim() || !backupUrl.startsWith('https://docs.google.com/spreadsheets/d/')) {
         toast({ variant: "destructive", title: "URL de Hoja Inválida", description: "Introduce una URL válida de Google Sheets para el respaldo." });
         return;
     }

     setIsBackingUp(true);
     try {
         const currentWHName = getWarehouseName(currentWarehouseId);
         const result = await backupToGoogleSheet(countingList, currentWHName, backupUrl); // Call server action

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
 }, [countingList, currentWarehouseId, getWarehouseName, toast, backupUrl]);

 // Refresh stock and details from IndexedDB
 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current) return;
     setIsRefreshingStock(true);
     console.log(`Refreshing stock and product details for warehouse ${currentWarehouseId} from IndexedDB...`);
     try {
         const allDbProducts = await getAllProductsFromDB(); // Fetch all product details/stock info from DB

         setCountingList(prevCountingList => {
             const updatedList = prevCountingList.map(countingProduct => {
                 const dbProduct = allDbProducts.find(dbP => dbP.barcode === countingProduct.barcode);
                 if (dbProduct) {
                     return {
                         ...countingProduct,
                         description: dbProduct.description,
                         provider: dbProduct.provider,
                         stock: dbProduct.stockPerWarehouse?.[currentWarehouseId] ?? countingProduct.stock ?? 0, // Update stock for current warehouse
                         lastUpdated: new Date().toISOString(), // Update timestamp
                     };
                 }
                 return countingProduct; // Keep unchanged if not found in DB (e.g., placeholder)
             });

             // Add items from DB that are not currently in the counting list for this warehouse
             allDbProducts.forEach(dbProduct => {
                 if (!updatedList.some(cp => cp.barcode === dbProduct.barcode && cp.warehouseId === currentWarehouseId)) {
                     updatedList.push({
                         ...dbProduct,
                         warehouseId: currentWarehouseId,
                         stock: dbProduct.stockPerWarehouse?.[currentWarehouseId] ?? 0,
                         count: 0, // Items added during refresh start with 0 count
                         lastUpdated: new Date().toISOString(),
                     });
                 }
             });

             // Re-sort the list (e.g., by lastUpdated descending)
             updatedList.sort((a, b) => new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime());

             return updatedList;
         });

         toast({ title: "Datos Actualizados", description: `Stock y detalles para ${getWarehouseName(currentWarehouseId)} actualizados desde la base de datos local.` });
         console.log("Stock and product details refreshed from IndexedDB for warehouse:", currentWarehouseId);

     } catch (error) {
         console.error(`Error refreshing stock and details for warehouse ${currentWarehouseId}:`, error);
         toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar los datos desde la base de datos local para ${getWarehouseName(currentWarehouseId)}. ` });
     } finally {
         if (isMountedRef.current) {
             setIsRefreshingStock(false);
         }
     }
 }, [currentWarehouseId, toast, getWarehouseName]);

 // Open dialog handlers
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
             setProductToEditDetail(dbProduct); // Set the full ProductDetail for the dialog
             setInitialStockForEdit(dbProduct.stockPerWarehouse?.[currentWarehouseId] ?? 0); // Get stock for the CURRENT warehouse
             setIsEditDetailDialogOpen(true);
         } else {
             if (!isMountedRef.current) return;
             toast({ variant: "destructive", title: "Error", description: "Detalles del producto no encontrados en la base de datos." });
         }
     } catch (error) {
         if (!isMountedRef.current) return;
         console.error("Error fetching product details for edit:", error);
         toast({ variant: "destructive", title: "Error DB", description: "No se pudieron obtener los datos del producto para editar." });
     } finally {
         if (isMountedRef.current) {
              setIsDbLoading(false);
         }
     }
 }, [toast, currentWarehouseId]);

 // Handle submitting edits from the EditProductDialog
 const handleEditDetailSubmit = useCallback(async (data: ProductDetail & { stock: number }) => {
     if (!isMountedRef.current || !productToEditDetail) return; // Ensure productToEditDetail is set

     setIsDbLoading(true);
     try {
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, // Use barcode from the state
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stockPerWarehouse: {
                 ...(productToEditDetail.stockPerWarehouse || {}),
                 [currentWarehouseId]: data.stock, // Update stock ONLY for the CURRENT warehouse
             },
         };

         await addOrUpdateProductToDB(updatedProductData); // Update IndexedDB

         if (!isMountedRef.current) return;

         // Refresh the local counting list state immediately
         setCountingList(prevList => prevList.map(item =>
             item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId
                 ? {
                     ...item,
                     description: updatedProductData.description,
                     provider: updatedProductData.provider,
                     stock: updatedProductData.stockPerWarehouse?.[currentWarehouseId] ?? 0,
                     lastUpdated: new Date().toISOString()
                   }
                 : item
         ));

         toast({
             title: "Producto Actualizado",
             description: `${updatedProductData.description} ha sido actualizado en ${getWarehouseName(currentWarehouseId)}.`,
         });
         setIsEditDetailDialogOpen(false);
         setProductToEditDetail(null); // Reset edit state

     } catch (error: any) {
         if (!isMountedRef.current) return;
         console.error("Failed to update product detail/stock:", error);
         toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
     } finally {
         if (isMountedRef.current) {
             setIsDbLoading(false);
         }
     }
 }, [toast, currentWarehouseId, getWarehouseName, productToEditDetail]); // Depend on productToEditDetail

 // Handle starting count by provider
 const handleStartCountByProvider = useCallback(async (productsToCount: DisplayProduct[]) => {
     if (!isMountedRef.current) return;
     if (!productsToCount || productsToCount.length === 0) {
         toast({ title: "Vacío", description: "No hay productos para este proveedor en el almacén actual." });
         return;
     }

     const productsWithWarehouseId = productsToCount.map(p => ({
          ...p,
          warehouseId: currentWarehouseId, // Ensure correct warehouse ID
          count: 0, // Reset count for the counting session
          lastUpdated: new Date().toISOString(),
      }));

      setCountingList(productsWithWarehouseId); // Replace current list
      setActiveSection("Contador"); // Switch to counter view
      toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para ${getWarehouseName(currentWarehouseId)}.` });
  }, [toast, setActiveSection, currentWarehouseId, getWarehouseName]);

  // Filtered list for display based on search term
  const filteredCountingList = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    if (!lowerSearchTerm) {
      return countingList; // Return full list if no search term
    }
    return countingList.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) ||
      (product.provider || '').toLowerCase().includes(lowerSearchTerm)
    );
  }, [countingList, searchTerm]);

  // Handle section change (Contador, Base de Datos, Almacenes)
  const handleSectionChange = (newSection: string) => {
    setActiveSection(newSection);
    if (newSection === 'Contador') {
       requestAnimationFrame(() => barcodeInputRef.current?.focus()); // Focus barcode input
    }
    if (newSection !== 'Contador' && isScanning) {
       handleStopScanning(); // Stop scanning if switching away
    }
  };

   // Handle warehouse change
   const handleWarehouseChange = (newWarehouseId: string) => {
         if (newWarehouseId !== currentWarehouseId) {
             console.log("Switching warehouse to:", newWarehouseId);
             setIsDbLoading(true); // Show loading while list reloads
             setCurrentWarehouseId(newWarehouseId);
             // useEffect for currentWarehouseId handles list reloading/clearing
         }
   };

   // Handle adding a new warehouse
   const handleAddWarehouse = (newWarehouse: { id: string; name: string }) => {
         setWarehouses(prevWarehouses => {
             const isDuplicate = prevWarehouses.some(warehouse => warehouse.id === newWarehouse.id);
             if (isDuplicate) {
                 toast({ variant: 'destructive', title: 'Error', description: 'ID de almacén ya existe.' });
                 return prevWarehouses;
             }
             const updatedWarehouses = [...prevWarehouses, newWarehouse];
             setCurrentWarehouseId(newWarehouse.id); // Switch to the new warehouse
             toast({title: "Almacén Agregado", description: `Cambiado al nuevo almacén: ${newWarehouse.name}`});
             return updatedWarehouses;
         });
   };

   // Handle updating the list of warehouses (e.g., after edit/delete)
   const handleUpdateWarehouses = (updatedWarehouses: { id: string; name: string }[]) => {
         setWarehouses(updatedWarehouses);
         // Switch to the first warehouse if the current one was deleted
         if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
             const newCurrentId = updatedWarehouses[0]?.id || 'main';
             if (newCurrentId !== currentWarehouseId) {
                 handleWarehouseChange(newCurrentId);
                 toast({title: "Almacén Actualizado", description: `Almacén actual cambiado a ${getWarehouseName(newCurrentId)}.`});
             }
         }
   };

   // Handle clicking the scan button
   const handleScanButtonClick = () => {
         console.log("Scan button clicked, requesting scanner start.");
         if (!isScanning) {
             setIsScanning(true); // Enable scanning state
         }
   };

   // Handle stopping the scanner (e.g., clicking cancel in dialog)
   const handleStopScanning = () => {
         console.log("Stop scanning requested.");
         if (isScanning) {
             setIsScanning(false); // Disable scanning state
         }
         requestAnimationFrame(() => barcodeInputRef.current?.focus()); // Refocus barcode input
   };

   // Get the current value for the ModifyValueDialog
   const getCurrentValueForDialog = (type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        // Find the latest state from the countingList
        const currentItem = countingList.find(
          p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId
        );
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   };

  // --- Main Component Render ---
  return (
    <div className="container mx-auto p-4">
      {/* Header: Title and Section/Warehouse Selectors */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
         <h1 className="text-2xl font-bold text-gray-700 dark:text-gray-200">StockCounter Pro</h1>
         <div className="flex flex-wrap justify-center md:justify-end items-center gap-2 w-full md:w-auto">
              {/* Warehouse Selector */}
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
              {/* Section Selector */}
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

      {/* Main Content Area based on activeSection */}
      <div className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
        {/* Contador Section */}
        {activeSection === 'Contador' && (
            <div id="contador-content">
                {/* Barcode Entry Component */}
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
                {/* Search Input for Counting List */}
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
               {/* Counting List Table Component */}
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
                    tableHeightClass="h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]" // Adjust height dynamically
                />

              {/* Backup and Export Actions */}
              <div className="mt-4 flex flex-col sm:flex-row justify-end items-center gap-2">
                 {/* Google Sheet Backup URL Input */}
                 <Input
                    type="url"
                    placeholder="URL de Hoja Google para Respaldo"
                    value={backupUrl}
                    onChange={(e) => setBackupUrl(e.target.value)}
                    className="w-full sm:w-auto flex-grow bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                    aria-label="URL de la Hoja de Google para respaldo"
                    disabled={isDbLoading || isBackingUp}
                 />
                 {/* Backup Button */}
                 <Button
                      onClick={handleBackupToGoogleSheet}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                      disabled={countingList.length === 0 || isDbLoading || isBackingUp || !backupUrl.trim()}
                      aria-label="Respaldar inventario actual a Google Sheet"
                 >
                      {isBackingUp ? (
                           <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                           <UploadCloud className="mr-2 h-4 w-4" />
                      )}
                      {isBackingUp ? "Respaldando..." : "Respaldar a Google Sheet"}
                 </Button>
                 {/* Export Button */}
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

         {/* Base de Datos Section */}
         {activeSection === 'Base de Datos' && (
            <div id="database-content">
               <ProductDatabase
                  currentWarehouseId={currentWarehouseId} // Pass current warehouse for context
                  onStartCountByProvider={handleStartCountByProvider}
               />
            </div>
         )}

         {/* Almacenes Section */}
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

      {/* --- Dialogs --- */}

      {/* Modify Value Dialog (for both count and stock) */}
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

      {/* Confirmation for Count Change */}
      <ConfirmationDialog
          isOpen={isConfirmQuantityDialogOpen}
          onOpenChange={setIsConfirmQuantityDialogOpen}
          title="Confirmar Modificación"
          description={
             confirmQuantityNewValue !== null &&
             countingList.find(p => p.barcode === confirmQuantityProductBarcode)?.stock === confirmQuantityNewValue
                 ? `La cantidad contada (${confirmQuantityNewValue}) ahora coincide con el stock del sistema para "${countingList.find(p => p.barcode === confirmQuantityProductBarcode)?.description}". ¿Confirmar?`
                 : `Está a punto de modificar la cantidad contada para "${countingList.find(p => p.barcode === confirmQuantityProductBarcode)?.description}". ¿Continuar?`
          }
          onConfirm={handleConfirmQuantityChange}
          onCancel={() => {
              setIsConfirmQuantityDialogOpen(false);
              setConfirmQuantityProductBarcode(null);
              setConfirmQuantityAction(null);
              setConfirmQuantityNewValue(null);
              // Keep the main modify dialog open if confirmation is cancelled
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

      {/* Dialog for Editing Product Details (and stock for current warehouse) */}
      <EditProductDialog
         isOpen={isEditDetailDialogOpen}
         setIsOpen={setIsEditDetailDialogOpen}
         selectedDetail={productToEditDetail}
         setSelectedDetail={setProductToEditDetail}
         onSubmit={handleEditDetailSubmit}
         onDelete={ (barcode) => { // Handle delete from edit dialog context
              // Find the full detail to show confirmation message
              const detailToDelete = countingList.find(p => p.barcode === barcode);
              if (detailToDelete) {
                  setProductToDelete(detailToDelete); // Use the DisplayProduct for context
                  setIsDeleteDialogOpen(true); // Use the existing delete confirmation
                  setIsEditDetailDialogOpen(false); // Close edit dialog
              } else {
                   toast({variant: "destructive", title: "Error", description: "No se pudo encontrar el producto para eliminar."});
              }
          }}
         isProcessing={isDbLoading}
         initialStock={initialStockForEdit}
         context="countingList" // Indicate context is from counting list
      />

    </div>
  );
}
