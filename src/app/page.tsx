// src/app/page.tsx
"use client";

import type { DisplayProduct, ProductDetail, CountingHistoryEntry } from '@/types/product'; // Import CountingHistoryEntry
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
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, AlertCircle, Search, Check, AppWindow, Database, Boxes, UploadCloud, Loader2, History as HistoryIcon, CalendarIcon, Save, Edit, Download } from "lucide-react"; // Removed Camera icon
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { backupToGoogleSheet } from './actions/backup-actions';
import { playBeep } from '@/lib/helpers';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
import { ModifyValueDialog } from '@/components/modify-value-dialog';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
// Removed ScannerDialog import
import { useLocalStorage } from '@/hooks/use-local-storage';
import { EditProductDialog } from '@/components/edit-product-dialog';
import {
    addOrUpdateProductToDB,
    getProductFromDB,
    getAllProductsFromDB,
    deleteProductFromDB,
    saveCountingHistory, // Import history saving function
    clearAllDatabases, // Import clear all data function
    getCountingHistory,
    clearCountingHistory,
} from '@/lib/database'; // Import IndexedDB helpers
import { CountingHistoryViewer } from '@/components/counting-history-viewer'; // Import History Viewer
import Papa from 'papaparse'; // Ensure PapaParse is imported

// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_BACKUP_URL_KEY = 'stockCounterPro_backupUrl'; // Now stores Apps Script URL

// --- Main Component ---

export default function Home() {
  // --- Refs ---
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  // Removed videoRef
  const isMountedRef = useRef(false); // Track component mount status with ref

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
      '' // Initialize empty
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
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true); // Tracks loading for IndexedDB operations or initial list load
  const [isRefreshingStock, setIsRefreshingStock] = useState(false); // For the refresh button action specifically
  // Removed scanner-related state: isScannerDialogOpen, isScannerActive, isScannerInitializing, hasCameraPermission
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isSavingToHistory, setIsSavingToHistory] = useState(false); // State for saving to history
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null); // Keep for debouncing manual input
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null); // Detail only for edit dialog
  const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0); // Initial stock for edit dialog

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
            .map(item => ({
                ...item,
                stock: item.stock ?? 0,
                count: item.count ?? 0,
                lastUpdated: item.lastUpdated || new Date().toISOString(),
                 // Ensure warehouseId is present; default if missing (though it should be set on save)
                warehouseId: item.warehouseId || currentWarehouseId
            }));
        console.log(`Loaded ${loadedList.length} items for warehouse ${currentWarehouseId} from localStorage.`);
        // Filter after loading to ensure only items for the current warehouse are in the state
        setCountingList(loadedList.filter(item => item.warehouseId === currentWarehouseId));
    } else {
        console.warn(`Invalid data structure in localStorage for warehouse ${currentWarehouseId}. Clearing.`);
        localStorage.removeItem(savedListKey); // Remove invalid data
        setCountingList([]);
    }
    setIsDbLoading(false);

 }, [currentWarehouseId]); // Only depend on warehouseId

  // Save Counting List to LocalStorage
  useEffect(() => {
    if (!isDbLoading && currentWarehouseId && isMountedRef.current) {
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`;
        // Ensure we save only items related to the current warehouse
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

 // Handle adding a product (from barcode input)
 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    if (!isMountedRef.current) return; // Ensure component is mounted

    const rawBarcode = barcodeToAdd ?? barcode;
    const trimmedBarcode = rawBarcode.trim().replace(/\r?\n|\r$/g, ''); // Trim and remove trailing newlines

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

    // Debounce consecutive entries of the same barcode
     if (trimmedBarcode === lastScannedBarcode) {
         console.log("Duplicate entry detected within debounce period, ignoring:", trimmedBarcode);
         setBarcode(""); // Clear input
         requestAnimationFrame(() => barcodeInputRef.current?.focus()); // Refocus
         return;
     }
     setLastScannedBarcode(trimmedBarcode);
     // Debounce clearing last scanned barcode to prevent immediate re-entry issues
     const clearLastScannedTimeout = setTimeout(() => {
         if (isMountedRef.current) {
              setLastScannedBarcode(null);
         }
     }, 800); // Debounce duration

    let descriptionForToast = '';
    let productWasInList = false;

    setCountingList(currentList => {
        const existingProductIndex = currentList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

        if (existingProductIndex !== -1) {
             productWasInList = true;
            const productToUpdate = currentList[existingProductIndex];
            descriptionForToast = productToUpdate.description;
            const newCount = (productToUpdate.count ?? 0) + 1;
            const updatedProductData: DisplayProduct = {
                ...productToUpdate,
                count: newCount,
                lastUpdated: new Date().toISOString(),
            };

            // Move updated product to the top
            const updatedList = [updatedProductData, ...currentList.filter((_, index) => index !== existingProductIndex)];
            toast({ title: "Cantidad aumentada", description: `${descriptionForToast} cantidad aumentada a ${newCount}.` });
            playBeep(880, 100);
            return updatedList; // Return updated list for state update

        } else {
            // Product not in the current list state, DB check will happen outside
            return currentList;
        }
    });

    // If the product was NOT found in the current counting list state, check the DB
    if (!productWasInList) {
        setIsDbLoading(true);
        try {
            const dbProduct = await getProductFromDB(trimmedBarcode);
            let newProductForList: DisplayProduct;

            if (dbProduct) {
                descriptionForToast = dbProduct.description;
                newProductForList = {
                    ...dbProduct,
                    warehouseId: currentWarehouseId,
                    stock: dbProduct.stock ?? 0, // Use DB stock
                    count: 1, // Start count at 1
                    lastUpdated: new Date().toISOString(),
                };
                toast({ title: "Producto agregado", description: `${descriptionForToast} agregado al inventario (${getWarehouseName(currentWarehouseId)}).` });
                playBeep(660, 150); // Success beep
            } else {
                descriptionForToast = `Producto desconocido ${trimmedBarcode}`;
                const newPlaceholderProduct: DisplayProduct = {
                    barcode: trimmedBarcode,
                    description: descriptionForToast,
                    provider: "Desconocido",
                    warehouseId: currentWarehouseId,
                    stock: 0, // Default stock to 0 for unknown
                    count: 1, // Start count at 1
                    lastUpdated: new Date().toISOString(),
                };
                newProductForList = newPlaceholderProduct;
                toast({
                    variant: "destructive",
                    title: "Producto Desconocido",
                    description: `Producto ${trimmedBarcode} no encontrado. Agregado temporalmente. Edita en 'Base de Datos'.`,
                    duration: 7000,
                });
                playBeep(440, 300); // Play sound for unknown product
            }
            // Update state asynchronously after DB check, adding to the top
             if (isMountedRef.current) {
                 setCountingList(currentList => [newProductForList, ...currentList]);
             }
        } catch (error) {
            console.error("Error fetching or adding product from IndexedDB:", error);
            toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo verificar o agregar el producto." });
            playBeep(440, 300); // Error beep
        } finally {
             if (isMountedRef.current) {
                 setIsDbLoading(false);
             }
        }
    }

    // Clear input field and refocus regardless of outcome
    setBarcode("");
    requestAnimationFrame(() => barcodeInputRef.current?.focus());

    // Cleanup timeout for last scanned barcode debounce
    return () => clearTimeout(clearLastScannedTimeout);

  }, [barcode, currentWarehouseId, getWarehouseName, lastScannedBarcode, toast]); // Dependencies

  // Removed handleScanSuccessCallback and useBarcodeScanner hook initialization


// Modify product value (count or stock) in the counting list and potentially DB
const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current) return;

    let updatedProduct: DisplayProduct | undefined;
    let showToast = true;
    let needsConfirmation = false;

    setCountingList(prevList => {
        const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
        if (productIndex === -1) {
             console.warn(`Product ${barcodeToUpdate} not found in list for warehouse ${currentWarehouseId}. Cannot modify.`);
             return prevList;
        }

        const product = prevList[productIndex];
        const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
        const finalValue = Math.max(0, originalValue + change);
        // Reset confirmation flag at the start of each modification attempt
        needsConfirmation = type === 'count' && product.stock !== 0 && (finalValue === product.stock || originalValue === product.stock) && finalValue !== originalValue;


        updatedProduct = {
             ...product,
             [type]: finalValue,
             lastUpdated: new Date().toISOString()
        };

        if (needsConfirmation) {
            setConfirmQuantityProductBarcode(product.barcode);
            setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
            setConfirmQuantityNewValue(finalValue);
            setIsConfirmQuantityDialogOpen(true);
            showToast = false; // Toast will be shown after confirmation or cancellation
            return prevList; // Return previous list as confirmation is pending
        } else {
            // No confirmation needed, update directly
            const updatedList = [...prevList];
            updatedList[productIndex] = updatedProduct;
            return updatedList;
        }
    });

    // If no confirmation was needed or type is 'stock', proceed with DB update and toasts
    if (!needsConfirmation) {
        if (type === 'stock' && updatedProduct) {
            try {
                const dbProduct = await getProductFromDB(barcodeToUpdate);
                if (dbProduct) {
                    const updatedDbProduct: ProductDetail = {
                        ...dbProduct,
                        stock: updatedProduct.stock // Update stock in DB
                    };
                    await addOrUpdateProductToDB(updatedDbProduct);
                     toast({
                         title: `Stock (DB) Actualizado`,
                         description: `Stock de ${updatedProduct.description} actualizado a ${updatedProduct.stock} en la base de datos.`
                     });
                    showToast = false; // Prevent generic toast if DB toast was shown
                } else {
                     console.warn(`Product ${barcodeToUpdate} not found in DB while trying to update stock.`);
                     // If product not in DB, add it
                      const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                      if(listProduct) {
                           const newDbProduct: ProductDetail = {
                                barcode: listProduct.barcode,
                                description: listProduct.description,
                                provider: listProduct.provider,
                                stock: updatedProduct.stock
                            };
                            await addOrUpdateProductToDB(newDbProduct);
                             toast({
                                 title: `Stock (DB) Establecido`,
                                 description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock} en la base de datos.`
                             });
                            showToast = false;
                      }
                }
            } catch (error) {
                console.error("Error updating stock in IndexedDB:", error);
                toast({
                    variant: "destructive",
                    title: "Error DB",
                    description: `No se pudo actualizar el stock en la base de datos para ${updatedProduct?.description}.`
                });
                 showToast = false; // Prevent generic toast if DB error toast was shown
            }
        }

         // Simplified Toast logic: Only show generic if no DB toast was shown
        if (showToast && updatedProduct) {
             const valueTypeText = type === 'count' ? 'Cantidad' : 'Stock';
             const warehouseNameText = getWarehouseName(currentWarehouseId);
             const descriptionText = updatedProduct.description;
             toast({
                 title: `${valueTypeText} Modificada`,
                 description: `${valueTypeText} de ${descriptionText} (${warehouseNameText}) cambiada a ${type === 'count' ? updatedProduct.count : updatedProduct.stock}.`,
                 duration: 3000
             });
         }
    }

  }, [currentWarehouseId, getWarehouseName, toast, countingList]); // Added countingList dependency


// Handle setting product value (count or stock) directly from dialog
const handleSetProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', newValue: number, sumValue?: boolean) => {
    if (!isMountedRef.current) return;
    if (newValue < 0 || isNaN(newValue)) {
        toast({ variant: "destructive", title: "Valor Inválido", description: "La cantidad o stock debe ser un número positivo." });
        return;
    }

    let updatedProduct: DisplayProduct | undefined;
    let showToast = true;
    let needsConfirmation = false;


    setCountingList(prevList => {
        const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
        if (productIndex === -1) return prevList;

        const product = prevList[productIndex];
        const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
        let finalValue = sumValue ? (originalValue + newValue) : newValue;
        finalValue = Math.max(0, finalValue); // Ensure value is not negative
        needsConfirmation = type === 'count' && product.stock !== 0 && finalValue === product.stock && originalValue !== product.stock;


        updatedProduct = {
            ...product,
            [type]: finalValue,
            lastUpdated: new Date().toISOString()
        };

        if (needsConfirmation) { // Only for count changes
            setConfirmQuantityProductBarcode(product.barcode);
            setConfirmQuantityAction('set');
            setConfirmQuantityNewValue(finalValue);
            setIsConfirmQuantityDialogOpen(true);
            showToast = false;
            return prevList;
        } else {
            const updatedList = [...prevList];
            updatedList[productIndex] = updatedProduct;
            setOpenModifyDialog(null); // Close dialog if no confirmation needed
            return updatedList;
        }
    });

    // If no confirmation was needed or type is 'stock', proceed with DB update and toasts
     if (!needsConfirmation) {
         if (type === 'stock' && updatedProduct) {
             try {
                 const dbProduct = await getProductFromDB(barcodeToUpdate);
                 if (dbProduct) {
                     const updatedDbProduct: ProductDetail = {
                         ...dbProduct,
                         stock: updatedProduct.stock
                     };
                     await addOrUpdateProductToDB(updatedDbProduct);
                      toast({
                          title: `Stock (DB) Actualizado`,
                          description: `Stock de ${updatedProduct.description} actualizado a ${updatedProduct.stock} en la base de datos.`
                      });
                     showToast = false;
                 } else {
                     console.warn(`Product ${barcodeToUpdate} not found in DB while trying to update stock from dialog.`);
                     // If product not in DB, add it
                       const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                       if(listProduct) {
                            const newDbProduct: ProductDetail = {
                                 barcode: listProduct.barcode,
                                 description: listProduct.description,
                                 provider: listProduct.provider,
                                 stock: updatedProduct.stock
                             };
                             await addOrUpdateProductToDB(newDbProduct);
                              toast({
                                  title: `Stock (DB) Establecido`,
                                  description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock} en la base de datos.`
                              });
                             showToast = false;
                       }
                 }
             } catch (error) {
                 console.error("Error updating stock in IndexedDB from dialog:", error);
                 toast({
                     variant: "destructive",
                     title: "Error DB",
                     description: `No se pudo actualizar el stock en la base de datos para ${updatedProduct?.description}.`
                 });
                  showToast = false;
             }
         }

        // Simplified Toast logic: Only show generic if no DB toast was shown
         if (showToast && updatedProduct) {
             const valueTypeText = type === 'count' ? 'Cantidad' : 'Stock';
             const actionText = sumValue ? "sumada a" : "establecida en";
             const warehouseNameText = getWarehouseName(currentWarehouseId);
             const descriptionText = updatedProduct.description;
             toast({
                 title: `${valueTypeText} Modificada`,
                 description: `${valueTypeText} de ${descriptionText} (${warehouseNameText}) ${actionText} ${type === 'count' ? updatedProduct.count : updatedProduct.stock}.`,
                 duration: 3000
             });
         }
     }


}, [currentWarehouseId, getWarehouseName, toast, countingList]); // Added countingList dependency


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
         setIsConfirmQuantityDialogOpen(false);
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

         // Move updated product to the top
         return [updatedList[index], ...updatedList.filter((_, i) => i !== index)];
     });

     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
     setOpenModifyDialog(null);

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

     setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));

     toast({
          title: "Producto eliminado (Lista Actual)",
          description: `${descriptionForToast} (${productToDelete.barcode}) ha sido eliminado del inventario actual (${getWarehouseName(warehouseId)}).`,
          variant: "default"
      });

     setIsDeleteDialogOpen(false);
     setProductToDelete(null);
 }, [productToDelete, toast, getWarehouseName]);

 // Export current counting list to CSV
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
            Proveedor: p.provider || 'N/A', // Ensure provider is included
            Almacen: getWarehouseName(p.warehouseId),
            StockSistema: p.stock ?? 0,
            CantidadContada: p.count ?? 0,
            UltimaActualizacion: p.lastUpdated ? format(new Date(p.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
        }));

        const csv = Papa.unparse(dataToExport, { header: true });
        const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" }); // Add BOM for Excel compatibility
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);

         let fileName = '';
         // Try to get a consistent provider name from the list for the filename
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
        URL.revokeObjectURL(link.href); // Clean up the object URL
        toast({ title: "Exportado", description: `Inventario para ${getWarehouseName(currentWarehouseId)} exportado a ${fileName}.` });
    } catch (error) {
        console.error("Error exporting inventory:", error);
        toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
    }
 }, [countingList, currentWarehouseId, toast, getWarehouseName]);


 // Backup counting list to Google Sheet via Apps Script
 const handleBackupToGoogleSheet = useCallback(async () => {
    if (!isMountedRef.current) return;
    const currentListForWarehouse = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (currentListForWarehouse.length === 0) {
        toast({ title: "Vacío", description: "No hay productos en el inventario actual para respaldar." });
        return;
    }
    if (!backupUrl.trim() || !backupUrl.startsWith('https://script.google.com/macros/s/')) {
        toast({ variant: "destructive", title: "URL de Script Inválida", description: "Introduce una URL válida de Google Apps Script para el respaldo (comienza con 'https://script.google.com/macros/s/...').", duration: 9000 });
        return;
    }

    setIsBackingUp(true);
    try {
        const currentWHName = getWarehouseName(currentWarehouseId);
        const result = await backupToGoogleSheet(currentListForWarehouse, currentWHName, backupUrl);

        if (result.success) {
            toast({ title: "Respaldo Exitoso", description: result.message });
            // History saving is now manual via handleSaveToHistory
            // Optionally trigger history save here if desired after successful backup
            // await handleSaveToHistory(true); // Pass flag to avoid redundant toasts
        } else {
            toast({ variant: "destructive", title: "Error de Respaldo", description: result.message, duration: 10000 });
        }
    } catch (error: any) {
        console.error("Error calling backupToGoogleSheet Server Action:", error);
        toast({ variant: "destructive", title: "Error de Respaldo", description: error.message || "Ocurrió un error inesperado al intentar respaldar.", duration: 10000 });
    } finally {
        if (isMountedRef.current) {
            setIsBackingUp(false);
        }
    }
 }, [countingList, currentWarehouseId, getWarehouseName, toast, backupUrl]);

  // Save current counting list to local history
  const handleSaveToHistory = useCallback(async (hideToast = false) => { // Add flag to optionally hide toast
    if (!isMountedRef.current) return;
    const currentListForWarehouse = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (currentListForWarehouse.length === 0) {
        if (!hideToast) {
            toast({ title: "Vacío", description: "No hay productos en el inventario actual para guardar en el historial." });
        }
        return;
    }

    setIsSavingToHistory(true);
    try {
        const currentWHName = getWarehouseName(currentWarehouseId);
        const historyEntry: CountingHistoryEntry = {
            id: new Date().toISOString(), // Unique ID for the entry
            timestamp: new Date().toISOString(),
            warehouseId: currentWarehouseId,
            warehouseName: currentWHName,
            products: JSON.parse(JSON.stringify(currentListForWarehouse)) // Deep copy products
        };

        await saveCountingHistory(historyEntry);
         if (!hideToast) {
            toast({ title: "Historial Guardado", description: `Conteo para ${currentWHName} guardado en el historial local.` });
        }
    } catch (error: any) {
        console.error("Error saving counting history:", error);
         if (!hideToast) {
            toast({ variant: "destructive", title: "Error al Guardar Historial", description: error.message || "Ocurrió un error inesperado." });
        }
    } finally {
        if (isMountedRef.current) {
            setIsSavingToHistory(false);
        }
    }
}, [countingList, currentWarehouseId, getWarehouseName, toast]);


 // Refresh stock and details from IndexedDB
 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current) return;
     setIsRefreshingStock(true);
     console.log(`Refreshing stock and product details for warehouse ${currentWarehouseId} from IndexedDB...`);
     try {
         const allDbProducts = await getAllProductsFromDB();

         setCountingList(prevCountingList => {
             // Filter items for the current warehouse FIRST
             const currentWarehouseItems = prevCountingList.filter(item => item.warehouseId === currentWarehouseId);
             // Keep items from other warehouses separate
             const otherWarehouseItems = prevCountingList.filter(item => item.warehouseId !== currentWarehouseId);

             // Update existing items in the current warehouse list
             let updatedCurrentWarehouseList = currentWarehouseItems.map(countingProduct => {
                 const dbProduct = allDbProducts.find(dbP => dbP.barcode === countingProduct.barcode);
                 if (dbProduct) {
                     return {
                         ...countingProduct, // Keep existing count and warehouseId
                         description: dbProduct.description,
                         provider: dbProduct.provider,
                         stock: dbProduct.stock ?? countingProduct.stock ?? 0, // Update stock
                         lastUpdated: new Date().toISOString(), // Update timestamp
                     };
                 }
                 // If not found in DB, keep the existing item as is (maybe it's temporary)
                 return countingProduct;
             });

              // Add items from DB that are not currently in the counting list FOR THIS WAREHOUSE
               allDbProducts.forEach(dbProduct => {
                   if (!updatedCurrentWarehouseList.some(cp => cp.barcode === dbProduct.barcode)) {
                       // Only add if it has a defined stock (or handle default stock case)
                       if (dbProduct.stock !== undefined) {
                           updatedCurrentWarehouseList.push({
                               ...dbProduct, // Get details from DB
                               warehouseId: currentWarehouseId, // Assign to current warehouse
                               count: 0, // Initialize count to 0
                               lastUpdated: new Date().toISOString(),
                           });
                       }
                   }
               });

             // Sort the updated list (newest first)
             updatedCurrentWarehouseList.sort((a, b) => new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime());

             // Combine the updated current warehouse list with items from other warehouses
             return [...updatedCurrentWarehouseList, ...otherWarehouseItems];
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
             setProductToEditDetail(dbProduct);
             setInitialStockForEdit(dbProduct.stock ?? 0); // Use DB stock as initial
             setIsEditDetailDialogOpen(true);
         } else {
             if (!isMountedRef.current) return;
             // Product not in DB (placeholder in counting list)
             setProductToEditDetail({
                 barcode: product.barcode,
                 description: product.description,
                 provider: product.provider,
                 stock: product.stock ?? 0 // Use current stock from list
             });
              setInitialStockForEdit(product.stock ?? 0);
              setIsEditDetailDialogOpen(true);
              toast({ variant: "default", title: "Editando Producto Temporal", description: "Guarde los cambios para añadirlo a la base de datos." });
         }
     } catch (error) {
         if (!isMountedRef.current) return;
         console.error("Error fetching product details for edit:", error);
         toast({ variant: "destructive", title: "Error DB", description: "No se pudieron obtener los datos del producto para editar." });
     } finally {
         if (isMountedRef.current) { // Check moved inside finally
            setIsDbLoading(false);
         }
     }
 }, [toast]);

 // Handle submitting edits from the EditProductDialog
 const handleEditDetailSubmit = useCallback(async (data: ProductDetail) => {
     if (!isMountedRef.current || !productToEditDetail) return;

     setIsDbLoading(true);
     try {
          // Prepare data to update/add in DB
         const updatedProductData: ProductDetail = {
             barcode: productToEditDetail.barcode, // Keep original barcode
             description: data.description.trim(),
             provider: data.provider?.trim() || "Desconocido",
             stock: data.stock ?? 0, // Use stock from form
         };

         await addOrUpdateProductToDB(updatedProductData);

         if (!isMountedRef.current) return;

         // Refresh the local counting list state immediately
         setCountingList(prevList => prevList.map(item =>
             item.barcode === updatedProductData.barcode && item.warehouseId === currentWarehouseId
                 ? {
                     ...item,
                     description: updatedProductData.description,
                     provider: updatedProductData.provider,
                     stock: updatedProductData.stock, // Update stock in list too
                     lastUpdated: new Date().toISOString()
                   }
                 : item
         ));

         toast({
             title: "Producto Actualizado",
             description: `${updatedProductData.description} ha sido actualizado en la base de datos.`,
         });
         setIsEditDetailDialogOpen(false);
         setProductToEditDetail(null);

     } catch (error: any) {
         if (!isMountedRef.current) return;
         console.error("Failed to update product detail/stock:", error);
         toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
     } finally {
         if (isMountedRef.current) {
             setIsDbLoading(false);
         }
     }
 }, [toast, currentWarehouseId, productToEditDetail]);

 // Handle starting count by provider
 const handleStartCountByProvider = useCallback(async (productsToCount: ProductDetail[]) => {
     if (!isMountedRef.current) return;
     if (!productsToCount || productsToCount.length === 0) {
         toast({ title: "Vacío", description: "No hay productos para este proveedor." });
         return;
     }

     // Map DB products to DisplayProducts for the current warehouse
     const productsWithWarehouseContext: DisplayProduct[] = productsToCount.map(dbProduct => ({
         ...dbProduct,
         warehouseId: currentWarehouseId,
         stock: dbProduct.stock ?? 0, // Use DB stock
         count: 0, // Reset count
         lastUpdated: new Date().toISOString(),
     }));

     // Replace the counting list for the current warehouse, keep others
     setCountingList(prevList => {
         const otherWarehouseItems = prevList.filter(item => item.warehouseId !== currentWarehouseId);
         const newList = [...productsWithWarehouseContext, ...otherWarehouseItems];
          // Sort the combined list, putting current warehouse items first (or by lastUpdated)
          newList.sort((a, b) => {
                if (a.warehouseId === currentWarehouseId && b.warehouseId !== currentWarehouseId) return -1;
                if (a.warehouseId !== currentWarehouseId && b.warehouseId === currentWarehouseId) return 1;
                // Optionally sort within the current warehouse by description or last updated
                if (a.warehouseId === currentWarehouseId && b.warehouseId === currentWarehouseId) {
                    return new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime();
                }
                return 0; // Keep order for other warehouses
            });
         return newList;
     });

     setActiveSection("Contador"); // Switch to counter view
     toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para ${getWarehouseName(currentWarehouseId)}.` });
 }, [toast, setActiveSection, currentWarehouseId, getWarehouseName]);


  // Filtered list for display based on search term (only for current warehouse)
  const filteredCountingList = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    const currentWarehouseList = countingList.filter(p => p.warehouseId === currentWarehouseId);

    if (!lowerSearchTerm) {
      return currentWarehouseList;
    }
    return currentWarehouseList.filter(product =>
      product.description.toLowerCase().includes(lowerSearchTerm) ||
      product.barcode.includes(lowerSearchTerm) ||
      (product.provider || '').toLowerCase().includes(lowerSearchTerm)
    );
  }, [countingList, searchTerm, currentWarehouseId]);

  // Handle section change (Contador, Base de Datos, Almacenes, Historial)
  const handleSectionChange = (newSection: string) => {
    setActiveSection(newSection);
    if (newSection === 'Contador') {
       requestAnimationFrame(() => barcodeInputRef.current?.focus());
    }
    // Removed scanner stop logic
  };

   // Handle warehouse change
   const handleWarehouseChange = (newWarehouseId: string) => {
         if (newWarehouseId !== currentWarehouseId) {
             console.log("Switching warehouse to:", newWarehouseId);
             setIsDbLoading(true); // Indicate loading while switching
             setCurrentWarehouseId(newWarehouseId);
             setSearchTerm(""); // Reset search term
             // The useEffect for currentWarehouseId will handle loading the new list
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
              // Automatically switch to the new warehouse
             handleWarehouseChange(newWarehouse.id); // Use handleWarehouseChange to ensure proper state update
             toast({title: "Almacén Agregado", description: `Cambiado al nuevo almacén: ${newWarehouse.name}`});
             return updatedWarehouses;
         });
   };

   // Handle updating the list of warehouses (e.g., after edit/delete)
   const handleUpdateWarehouses = (updatedWarehouses: { id: string; name: string }[]) => {
         setWarehouses(updatedWarehouses);
         // Check if the currently selected warehouse still exists
         if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
              // If not, switch to the first available warehouse or 'main'
             const newCurrentId = updatedWarehouses[0]?.id || 'main';
             if (newCurrentId !== currentWarehouseId) {
                 handleWarehouseChange(newCurrentId); // Switch warehouse
                 toast({title: "Almacén Actualizado", description: `Almacén actual cambiado a ${getWarehouseName(newCurrentId)}.`});
             } else if (updatedWarehouses.length === 0) {
                 // Handle case where all warehouses are deleted - potentially add a default 'main'
                  const defaultWarehouse = { id: 'main', name: 'Almacén Principal' };
                  setWarehouses([defaultWarehouse]);
                  handleWarehouseChange(defaultWarehouse.id);
                  toast({title: "Almacenes Actualizados", description: "Se restauró el almacén principal."});
             }
         }
   };

   // Removed handleScanButtonClick and handleStopScanning

   // Get the current value for the ModifyValueDialog
   const getCurrentValueForDialog = (type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
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
         <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
            {/* Section Selector FIRST */}
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
                </SelectContent>
            </Select>
            {/* Warehouse Selector SECOND */}
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

      {/* Removed video element */}

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
                    onRefreshStock={handleRefreshStock}
                    isLoading={isDbLoading || isRefreshingStock || isBackingUp || isSavingToHistory} // Removed isScannerInitializing
                    isRefreshingStock={isRefreshingStock}
                    inputRef={barcodeInputRef}
                    // Removed onScanClick and isScanning props
                />
                {/* Search Input for Counting List */}
                 <div className="relative mb-4">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Buscar en inventario actual..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                         className="pl-8 w-full bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600" // Celeste claro
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
                    onOpenStockDialog={(product) => handleOpenModifyDialog(product, 'stock')} // Use modify dialog for stock
                    onOpenQuantityDialog={(product) => handleOpenModifyDialog(product, 'count')}
                    onDecrement={handleDecrement}
                    onIncrement={handleIncrement}
                    onEditDetailRequest={handleOpenEditDetailDialog} // Still need this for full detail edit
                    tableHeightClass="h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]" // Adjust height dynamically
                    key={`${currentWarehouseId}-${countingList.length}`} // Add key to force re-render on list change or warehouse switch
                />

              {/* Backup and Export Actions */}
              <div className="mt-4 flex flex-col sm:flex-row justify-end items-center gap-2">
                 {/* Google Apps Script Backup URL Input */}
                 <Input
                    type="url"
                    placeholder="URL de Google Apps Script para Respaldo"
                    value={backupUrl}
                    onChange={(e) => setBackupUrl(e.target.value)}
                    className="w-full sm:w-auto flex-grow bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                    aria-label="URL de Google Apps Script para respaldo"
                    disabled={isDbLoading || isBackingUp || isSavingToHistory}
                 />
                  {/* Save to History Button */}
                  <Button
                        onClick={() => handleSaveToHistory()}
                        className="bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isSavingToHistory}
                        aria-label="Guardar conteo actual en el historial local"
                    >
                        {isSavingToHistory ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        {isSavingToHistory ? "Guardando..." : "Guardar en Historial"}
                    </Button>
                 {/* Backup Button */}
                 <Button
                      onClick={handleBackupToGoogleSheet}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                      disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isBackingUp || !backupUrl.trim() || isSavingToHistory}
                      aria-label="Respaldar inventario actual a Google Sheet vía Apps Script"
                      title="Asegúrate que la URL es correcta y el script está desplegado."
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
                     className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                     disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading}
                     aria-label="Exportar inventario actual a CSV"
                 >
                      <Download className="mr-2 h-4 w-4"/> Exportar Inventario ({getWarehouseName(currentWarehouseId)})
                 </Button>
              </div>
            </div>
        )}

         {/* Base de Datos Section */}
         {activeSection === 'Base de Datos' && (
            <div id="database-content">
               <ProductDatabase
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
                    onClearDatabaseRequest={async () => {
                        console.log("Request to clear all DB data");
                         if (window.confirm("¿Estás seguro de que quieres borrar TODA la base de datos (productos, historial, etc.)? Esta acción es irreversible.")) {
                             try {
                                 await clearAllDatabases();
                                 toast({title: "Base de Datos Borrada", description: "Todos los datos han sido eliminados."});
                                 // Reload or reset states if necessary
                                 if (activeSection === 'Base de Datos') {
                                     // Potentially force a re-render or state reset for ProductDatabase
                                 }
                                 setCountingList([]);
                                 localStorage.removeItem(`${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`);
                             } catch (error: any) {
                                  toast({variant: "destructive", title: "Error al Borrar", description: `No se pudo borrar la base de datos: ${error.message}`});
                             }
                         }
                    }}
                  />
             </div>
           )}

           {/* Historial Section */}
            {activeSection === 'Historial' && (
                <div id="history-content">
                    <CountingHistoryViewer
                        getWarehouseName={getWarehouseName}
                    />
                </div>
            )}
      </div>

      {/* --- Dialogs --- */}

      {/* Modify Value Dialog (for count and stock) */}
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
          }}
      />

      {/* Confirmation for Deleting from Counting List */}
      <ConfirmationDialog
         isOpen={isDeleteDialogOpen}
         onOpenChange={setIsDeleteDialogOpen}
         title="Confirmar Eliminación (Lista Actual)"
         description={`¿Seguro que deseas eliminar "${productToDelete?.description}" (${productToDelete?.barcode}) del inventario actual (${getWarehouseName(productToDelete?.warehouseId)})? Esta acción no se puede deshacer.`}
         onConfirm={confirmDelete}
         onCancel={() => setIsDeleteDialogOpen(false)}
         isDestructive={true}
      />

      {/* Removed Scanner Dialog */}

      {/* Dialog for Editing Product Details */}
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
                   toast({title: "Producto Eliminado (DB)", description: `Producto ${barcode} eliminado de la base de datos.`});
                   setIsEditDetailDialogOpen(false);
                   setProductToEditDetail(null);
               } catch (error: any) {
                    if (!isMountedRef.current) return;
                   console.error("Failed to delete product from DB via edit dialog:", error);
                   toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
               } finally {
                    if (isMountedRef.current) { // Check moved inside finally
                        setIsDbLoading(false);
                    }
                    setIsDeleteDialogOpen(false); // Ensure delete dialog is also closed
                    setProductToDelete(null); // Clear product to delete from main state
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
