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
import { format } from 'date-fns';
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, Camera, AlertCircle, Search, Check, AppWindow, Database, Boxes, UploadCloud, Loader2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    addOrUpdateInventoryItem,
    getDisplayProductForWarehouse,
    getProductDetail,
    addOrUpdateProductDetail,
    getInventoryItemsForWarehouse,
    getAllProductDetails, // Import function to get all product details
    getInventoryItem, // Import to get current stock before edit
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
import { EditProductDialog } from '@/components/edit-product-dialog'; // Import EditProductDialog

// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_BACKUP_SCRIPT_URL_KEY = 'stockCounterPro_backupScriptUrl'; // Renamed key

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
  const [backupScriptUrl, setBackupScriptUrl] = useLocalStorage<string>( // Using Script URL now
      LOCAL_STORAGE_BACKUP_SCRIPT_URL_KEY,
      ''
  );

   const getWarehouseName = useCallback((warehouseId: string | null | undefined) => {
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
    let descriptionForToast = ''; // Variable to store description for toast

    // First, try to find the product in the current list
    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
      productExists = true;
      const productToUpdate = countingList[existingProductIndex];
      descriptionForToast = productToUpdate.description; // Get description before updating state
      const newCount = (productToUpdate.count ?? 0) + 1;
      const updatedProductData: DisplayProduct = {
        ...productToUpdate,
        count: newCount,
        lastUpdated: new Date().toISOString(),
      };

      // Update the state immutably
      setCountingList(prevList => {
        const updatedList = [...prevList];
        updatedList.splice(existingProductIndex, 1); // Remove old item
        updatedList.unshift(updatedProductData); // Add updated item to the beginning
        return updatedList;
      });

      toast({
        title: "Cantidad aumentada",
        description: `${descriptionForToast} cantidad aumentada a ${newCount}.`,
      });
      playBeep(880, 100);

    } else {
      // Product not in the current list, fetch from DB
      try {
        const displayProduct = await getDisplayProductForWarehouse(trimmedBarcode, currentWarehouseId);

        if (displayProduct) {
          descriptionForToast = displayProduct.description; // Get description
          const newProductForList: DisplayProduct = {
            ...displayProduct,
            count: 1, // Initial count is 1
            lastUpdated: new Date().toISOString(),
          };
          // Add to the beginning of the list
          setCountingList(prev => [newProductForList, ...prev]);
          toast({
            title: "Producto agregado",
            description: `${descriptionForToast} agregado al inventario (${getWarehouseName(currentWarehouseId)}).`,
          });
          playBeep(660, 150); // Different beep for adding
        } else {
          // Product not found in DB either
          playBeep(440, 300); // Error/not found beep
          const newProductDetail: ProductDetail = {
            barcode: trimmedBarcode,
            description: `Producto desconocido ${trimmedBarcode}`,
            provider: "Desconocido",
          };
          const newInventoryItem: InventoryItem = {
            barcode: trimmedBarcode,
            warehouseId: currentWarehouseId,
            stock: 0,
            count: 1, // Initial count is 1
            lastUpdated: new Date().toISOString(),
          };

          // Add to both DB stores first
          await addOrUpdateProductDetail(newProductDetail);
          await addOrUpdateInventoryItem(newInventoryItem);

          // Then add to the list state
          const newDisplayProduct: DisplayProduct = {
            ...newProductDetail,
            ...newInventoryItem,
          };
          descriptionForToast = newDisplayProduct.description; // Get description
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
        playBeep(440, 300); // Error beep
      }
    }

    // Clear barcode input and focus after any operation
    setBarcode("");
    requestAnimationFrame(() => {
        barcodeInputRef.current?.focus();
    });

 }, [barcode, currentWarehouseId, toast, getWarehouseName, countingList, setCountingList]); // Include countingList and setCountingList

 // --- Barcode Scanner Hook Setup ---
  const handleScanSuccess = useCallback((detectedBarcode: string) => {
    console.log("handleScanSuccess triggered with barcode:", detectedBarcode);
    setIsScanning(false); // Close the scanner dialog
    requestAnimationFrame(() => {
      setBarcode(detectedBarcode); // Set the barcode state
      // Immediately attempt to add the product using the scanned barcode
      // Ensure handleAddProduct uses the *latest* state by passing the barcode directly
      handleAddProduct(detectedBarcode);
    });
  }, [handleAddProduct, setIsScanning, setBarcode]); // Depend on handleAddProduct

  const {
    isInitializing: isScannerInitializing,
    hasPermission: hasCameraPermission,
    startScanning, // Keep this if you want manual start
    stopScanning,  // Keep this for manual stop/cancel
  } = useBarcodeScanner({
    onScanSuccess: handleScanSuccess,
    videoRef: videoRef, // Pass the ref to the video element
    isEnabled: isScanning, // Control activation based on isScanning state
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
                    const parsedList: any[] = JSON.parse(savedList); // Parse first, then validate
                     if (Array.isArray(parsedList) && parsedList.every(item =>
                         typeof item === 'object' && item !== null &&
                         typeof item.barcode === 'string' &&
                         // Ensure warehouseId exists and matches, or is added if undefined
                         (typeof item.warehouseId === 'undefined' || item.warehouseId === warehouseId) &&
                         typeof item.description === 'string' &&
                         typeof item.count === 'number' &&
                         (typeof item.stock === 'number' || typeof item.stock === 'undefined' || item.stock === null) // Allow missing/null stock initially
                        )) {
                         loadedList = parsedList.map(item => ({
                             ...item,
                             // Ensure warehouseId is set correctly
                             warehouseId: warehouseId,
                             // Ensure count and stock are numbers, default to 0 if not
                             count: typeof item.count === 'number' ? item.count : 0,
                             stock: typeof item.stock === 'number' ? item.stock : 0, // Default stock to 0
                             // Add lastUpdated if missing
                              lastUpdated: item.lastUpdated || new Date().toISOString(),
                          }));
                          console.log(`Validated and loaded ${loadedList.length} items for warehouse ${warehouseId} from localStorage.`);
                      } else {
                           console.warn(`Invalid data structure or warehouse mismatch in localStorage for warehouse ${warehouseId}. Clearing.`);
                           localStorage.removeItem(savedListKey); // Clear invalid data
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
            description: `No se pudieron cargar los datos para el almacén seleccionado (${getWarehouseName(warehouseId)}).`,
            duration: 9000,
        });
        setCountingList([]);
    } finally {
        setIsDbLoading(false);
        if (!isScanning && barcodeInputRef.current) {
             requestAnimationFrame(() => {
                barcodeInputRef.current?.focus();
             });
        }
    }
  }, [toast, isScanning, setCountingList, getWarehouseName]); // Include dependencies


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
            // Ensure we only save items belonging to the current warehouse
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
    let currentStockValue = 0; // To store stock value for confirmation message

    setCountingList(prevList => {
        const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
        if (index === -1) return prevList;

        const updatedList = [...prevList];
        const product = updatedList[index];
        updatedProductDescription = product.description;
        currentStockValue = product.stock ?? 0; // Store current stock


        if (type === 'count') {
            originalValue = product.count ?? 0;
            finalValue = Math.max(0, originalValue + change);

            // Confirmation needed if count now matches a non-zero stock,
            // or if it previously matched stock and is now changing away from it.
             if (product.stock !== 0) {
                const changingToMatch = finalValue === product.stock && originalValue !== product.stock;
                const changingFromMatch = originalValue === product.stock && finalValue !== product.stock;
                if (changingToMatch || changingFromMatch) {
                    productToConfirm = { ...product }; // Store the state *before* potential update
                    needsConfirmation = true;
                }
            }


            if (needsConfirmation) {
                 console.log(`Confirmation needed for ${product.barcode}. Final: ${finalValue}, Stock: ${product.stock}`);
                return prevList; // Don't update state yet, wait for confirmation
            } else {
                 // Update directly if no confirmation needed
                 console.log(`Updating count directly for ${product.barcode} to ${finalValue}`);
                 updatedList[index] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
            }

        } else { // type === 'stock'
            originalValue = product.stock ?? 0;
            finalValue = Math.max(0, originalValue + change);
            updatedList[index] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
        }

        return updatedList;
    });

     // Update stock in DB only if type is 'stock'
     if (type === 'stock' && !needsConfirmation) { // Only update DB if not waiting for confirmation
         try {
              // Get the potentially updated product from the state AFTER setCountingList runs (or intended value)
             const itemToUpdate: InventoryItem = {
                barcode: barcodeToUpdate,
                warehouseId: warehouseId,
                stock: finalValue, // Use the calculated finalValue
                // Fetch current count from state if possible, or use 0 as fallback
                count: countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId)?.count ?? 0,
                lastUpdated: new Date().toISOString()
            };
             await addOrUpdateInventoryItem(itemToUpdate);
             toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${finalValue} en la base de datos.` });
         } catch (error) {
             console.error("Failed to update stock in DB:", error);
             toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
             // Revert stock change in UI state if DB update fails
             setCountingList(prevList => {
                const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                if (index === -1) return prevList;
                const revertedList = [...prevList];
                revertedList[index] = { ...revertedList[index], stock: originalValue }; // Use originalValue captured earlier
                return revertedList;
             });
         }
    }

    // Trigger confirmation dialog if needed (only for 'count' changes)
    if (needsConfirmation && productToConfirm && type === 'count') {
        setConfirmQuantityProductBarcode(productToConfirm.barcode);
        setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement');
        const potentialNewCount = Math.max(0, (productToConfirm.count ?? 0) + change);
        setConfirmQuantityNewValue(potentialNewCount);
        setIsConfirmQuantityDialogOpen(true);
    } else if (type === 'count' && !needsConfirmation) {
          // Show immediate toast if no confirmation was needed
          // Find the product again in the *potentially* updated list to get the description
         const updatedProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (updatedProduct) {
            toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProduct.description} (${getWarehouseName(warehouseId)}) cambiada a ${updatedProduct.count ?? 0}.` });
         }
    } else if (type === 'stock' && !needsConfirmation) {
        // Toast for stock change already handled inside the DB update success block
    }

 }, [countingList, currentWarehouseId, toast, getWarehouseName, setCountingList]);


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
     let currentStockValue = 0; // To store stock value for confirmation message

     setCountingList(prevList => {
         const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (index === -1) return prevList;

         const updatedList = [...prevList];
         const product = updatedList[index];
         updatedProductDescription = product.description;
         currentStockValue = product.stock ?? 0; // Store current stock


         if (type === 'count') {
             originalValue = product.count ?? 0;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
             finalValue = Math.max(0, finalValue);

             // Confirmation needed only if changing TO match a non-zero stock
             if (product.stock !== 0 && finalValue === product.stock && originalValue !== product.stock) {
                 needsConfirmation = true;
                 productToConfirm = { ...product }; // Store state *before* update
             }

             if (needsConfirmation) {
                  console.log(`Confirmation needed for 'set' ${product.barcode}. Final: ${finalValue}, Stock: ${product.stock}`);
                 return prevList; // Don't update yet
             } else {
                 console.log(`Updating count directly for 'set' ${product.barcode} to ${finalValue}`);
                  updatedList[index] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
             }
         } else { // type === 'stock'
             originalValue = product.stock ?? 0;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
              finalValue = Math.max(0, finalValue);
             updatedList[index] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
         }
         return updatedList;
     });

      // Update stock in DB only if type is 'stock' and not waiting for confirmation
      if (type === 'stock' && !needsConfirmation) {
          try {
               const itemToUpdate: InventoryItem = {
                  barcode: barcodeToUpdate,
                  warehouseId: warehouseId,
                  stock: finalValue, // Use calculated finalValue
                  // Fetch current count from state or use 0
                  count: countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId)?.count ?? 0,
                  lastUpdated: new Date().toISOString()
              };
              await addOrUpdateInventoryItem(itemToUpdate);
              toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${finalValue} en la base de datos.` });
          } catch (error) {
              console.error("Failed to update stock in DB:", error);
              toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
              // Revert stock change in UI state if DB update fails
              setCountingList(prevList => {
                  const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                  if (index === -1) return prevList;
                  const revertedList = [...prevList];
                  revertedList[index] = { ...revertedList[index], stock: originalValue };
                  return revertedList;
              });
          }
      }

      // Trigger confirmation dialog if needed (only for 'count' changes)
      if (needsConfirmation && productToConfirm && type === 'count') {
          setConfirmQuantityProductBarcode(productToConfirm.barcode);
          setConfirmQuantityAction('set'); // Action is 'set'
          setConfirmQuantityNewValue(finalValue); // The target value
          setIsConfirmQuantityDialogOpen(true);
      } else if (type === 'count' && !needsConfirmation) {
           // Show immediate toast if no confirmation was needed
           const actionText = sumValue ? "sumada a" : "establecida en";
            // Find the product again in the *potentially* updated list
            const updatedProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
             if (updatedProduct) {
                toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProduct.description} (${getWarehouseName(warehouseId)}) ${actionText} ${updatedProduct.count ?? 0}.` });
            }
      } else if (type === 'stock' && !needsConfirmation) {
           // Toast for stock change already handled inside the DB update success block
      }

      // Close the appropriate dialog and clear selection after any operation (unless confirmation pending)
      if (!needsConfirmation) {
           if (type === 'count') setOpenQuantityDialog(false);
           if (type === 'stock') setOpenStockDialog(false);
           setSelectedProductForDialog(null);
       }


 }, [countingList, currentWarehouseId, toast, getWarehouseName, setCountingList]);


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

    if (confirmQuantityProductBarcode && confirmQuantityAction !== null && confirmQuantityNewValue !== null) {
         // Apply the confirmed change to the state
         setCountingList(prevList => {
             const index = prevList.findIndex(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === warehouseId);
             if (index === -1) return prevList;

             const updatedList = [...prevList];
             const product = updatedList[index];
             descriptionForToast = product.description;
             finalConfirmedCount = Math.max(0, confirmQuantityNewValue); // Use the stored new value

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
     // Reset confirmation state regardless of success/failure
     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
}, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, toast, getWarehouseName, confirmQuantityNewValue, setCountingList]);


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
     if (!backupScriptUrl.trim()) { // Check if URL is present
        toast({
            variant: "destructive",
            title: "URL de Script Requerida",
            description: "Por favor, introduce la URL del Google Apps Script para el respaldo.",
        });
        return;
    }
    setIsBackingUp(true); // Start loading indicator
    try {
        const currentWHName = getWarehouseName(currentWarehouseId);
        // Pass the Apps Script URL to the server action
        const result = await backupToGoogleSheet(countingList, currentWHName, backupScriptUrl);

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
 }, [countingList, currentWarehouseId, getWarehouseName, toast, backupScriptUrl]); // Depend on backupScriptUrl


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
    console.log(`Refreshing stock and product details for warehouse ${currentWarehouseId} from database...`);
    try {
      // Fetch both inventory for the current warehouse and all product details
      const [warehouseInventory, allProductDetails] = await Promise.all([
        getInventoryItemsForWarehouse(currentWarehouseId),
        getAllProductDetails(), // Fetch all product details
      ]);

      // Create maps for quick lookup
      const inventoryMap = new Map<string, InventoryItem>();
      warehouseInventory.forEach(item => inventoryMap.set(item.barcode, item));

      const detailsMap = new Map<string, ProductDetail>();
      allProductDetails.forEach(detail => detailsMap.set(detail.barcode, detail));

      setCountingList(prevCountingList => {
        return prevCountingList.map(countingProduct => {
          const dbInventoryItem = inventoryMap.get(countingProduct.barcode);
          const dbProductDetail = detailsMap.get(countingProduct.barcode);

          // Update stock, description, and provider based on DB data
          // Preserve existing count
          const updatedStock = dbInventoryItem?.stock ?? countingProduct.stock ?? 0;
          const updatedDescription = dbProductDetail?.description ?? countingProduct.description;
          const updatedProvider = dbProductDetail?.provider ?? countingProduct.provider;

          return {
            ...countingProduct,
            stock: updatedStock,
            description: updatedDescription,
            provider: updatedProvider,
            lastUpdated: new Date().toISOString(), // Always update timestamp on refresh
          };
        });
      });

      toast({ title: "Datos Actualizados", description: `Stock y detalles de productos para ${getWarehouseName(currentWarehouseId)} han sido actualizados.` });
      console.log("Stock and product details refreshed for warehouse:", currentWarehouseId);

    } catch (error) {
      console.error(`Error refreshing stock and details for warehouse ${currentWarehouseId}:`, error);
      toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudieron actualizar los datos desde la base de datos para ${getWarehouseName(currentWarehouseId)}. ` });
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
             // Automatically switch to the newly added warehouse
             setCurrentWarehouseId(newWarehouse.id);
             toast({title: "Almacén Agregado", description: `Cambiado al nuevo almacén: ${newWarehouse.name}`});
            return updatedWarehouses;
        });
    };

    const handleUpdateWarehouses = (updatedWarehouses: { id: string; name: string }[]) => {
        setWarehouses(updatedWarehouses);
        // If the currently selected warehouse was deleted, switch to the first available one
        if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
            const newCurrentId = updatedWarehouses[0]?.id || 'main'; // Fallback to 'main' if list is empty (shouldn't happen if 'main' is protected)
            setCurrentWarehouseId(newCurrentId);
            toast({title: "Almacén Actualizado", description: `Almacén actual cambiado a ${getWarehouseName(newCurrentId)}.`});
        }
    };

    // --- Camera Scanning Logic ---
    const handleScanButtonClick = () => {
        console.log("Scan button clicked, requesting scanner start.");
        if (!isScanning) { // Only start if not already scanning
            setIsScanning(true); // Update state to enable the scanner hook
            startScanning(); // Call the hook's start function
        }
    };

    const handleStopScanning = () => {
        console.log("Stop scanning button clicked, requesting scanner stop.");
        if (isScanning) {
            stopScanning(); // Call the hook's stop function
            setIsScanning(false); // Update state to disable the hook
        }
         // Return focus to barcode input after closing scanner
         requestAnimationFrame(() => {
            barcodeInputRef.current?.focus();
         });
    };

   // Edit Product Detail from Counting List (for stock)
   const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
   const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null);
   const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0);

   const handleOpenEditDetailDialog = useCallback(async (product: DisplayProduct) => {
       if (!product || !product.barcode) return;
       try {
           const detail = await getProductDetail(product.barcode);
           if (detail) {
               const inventoryItem = await getInventoryItem(product.barcode, 'main'); // Get stock from 'main'
               setProductToEditDetail(detail);
               setInitialStockForEdit(inventoryItem?.stock ?? 0); // Use stock from 'main' or 0
               setIsEditDetailDialogOpen(true);
           } else {
               toast({ variant: "destructive", title: "Error", description: "Detalles del producto no encontrados en la base de datos." });
           }
       } catch (error) {
           console.error("Error fetching product details for edit:", error);
           toast({ variant: "destructive", title: "Error DB", description: "No se pudieron obtener los detalles del producto." });
       }
   }, [toast]);


   const handleEditDetailSubmit = useCallback(async (data: ProductDetail & { stock: number }) => {
       // This function is called from EditProductDialog when saving changes
       const detailData: ProductDetail = {
           barcode: data.barcode, // Barcode shouldn't change during edit
           description: data.description,
           provider: data.provider,
       };
       const stockForMainWarehouse = data.stock; // Stock is specifically for 'main'

       try {
           // Update product details
           await addOrUpdateProductDetail(detailData);

            // Update inventory item specifically for 'main' warehouse
           const mainInventoryItem = await getInventoryItem(data.barcode, 'main');
           const updatedMainInventory: InventoryItem = {
                barcode: data.barcode,
                warehouseId: 'main',
                stock: stockForMainWarehouse,
                count: mainInventoryItem?.count ?? 0, // Preserve existing count for 'main'
                lastUpdated: new Date().toISOString(),
           };
           await addOrUpdateInventoryItem(updatedMainInventory);

           // Refresh the counting list to reflect potential changes
           await handleRefreshStock();

           toast({
               title: "Producto Actualizado",
               description: `${detailData.description} ha sido actualizado.`,
           });
           setIsEditDetailDialogOpen(false); // Close the dialog
       } catch (error: any) {
           console.error("Failed to update product detail/stock:", error);
           toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
       }
   }, [toast, handleRefreshStock]); // Depend on handleRefreshStock


 // --- Count by Provider ---
 const handleStartCountByProvider = useCallback(async (productsToCount: DisplayProduct[]) => {
    if (!productsToCount || productsToCount.length === 0) {
        toast({ title: "Vacío", description: "No hay productos para este proveedor en el almacén actual." });
        return;
    }
     // Merge with existing list or replace? Let's replace for simplicity now.
     // Add warehouseId to each product before setting the list
    const productsWithWarehouseId = productsToCount.map(p => ({
         ...p,
         warehouseId: currentWarehouseId, // Ensure correct warehouse ID
         count: 0, // Reset count when starting count by provider
     }));
    setCountingList(productsWithWarehouseId);
    setActiveSection("Contador");
    toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para ${getWarehouseName(currentWarehouseId)}.` });
 }, [toast, setActiveSection, setCountingList, currentWarehouseId, getWarehouseName]); // Include setCountingList, currentWarehouseId, getWarehouseName

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
    // Focus barcode input when switching back to Contador section
    if (newSection === 'Contador') {
       requestAnimationFrame(() => {
          barcodeInputRef.current?.focus();
       });
    }
     // Stop scanning if leaving Contador section
    if (newSection !== 'Contador' && isScanning) {
       handleStopScanning();
    }
  };

  // Get current value for the modify dialogs based on the latest state
  const getCurrentValueForDialog = (type: 'count' | 'stock') => {
    if (!selectedProductForDialog) return 0;
    const currentItem = countingList.find(
      p => p.barcode === selectedProductForDialog.barcode && p.warehouseId === currentWarehouseId
    );
     // Use nullish coalescing for potentially undefined count/stock
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
                    onEditDetailRequest={handleOpenEditDetailDialog} // Pass handler
                    tableHeightClass="h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]"
                />

              <div className="mt-4 flex flex-col sm:flex-row justify-end items-center gap-2">
                 <Input
                    type="url" // Use type="url" for better semantic meaning
                    placeholder="URL del Script de Google para Respaldo" // Updated placeholder
                    value={backupScriptUrl}
                    onChange={(e) => setBackupScriptUrl(e.target.value)}
                    className="w-full sm:w-auto flex-grow bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                    aria-label="URL del Google Apps Script para respaldo" // Updated aria-label
                    disabled={isDbLoading || isBackingUp}
                 />
                 <Button
                      onClick={handleBackupToGoogleSheet}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200 w-full sm:w-auto"
                      disabled={countingList.length === 0 || isDbLoading || isBackingUp || !backupScriptUrl.trim()} // Check URL presence
                      aria-label="Respaldar inventario actual a Google Sheet via Apps Script" // Updated aria-label
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
                    (() => {
                        const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
                        const stockValue = product?.stock ?? 0;
                        let actionDescription = '';
                        if (confirmQuantityAction === 'increment') actionDescription = 'aumentar';
                        if (confirmQuantityAction === 'decrement') actionDescription = 'disminuir';
                        if (confirmQuantityAction === 'set') actionDescription = 'establecer';

                         if (confirmQuantityAction === 'set') {
                             return `La cantidad contada (${confirmQuantityNewValue ?? 'N/A'}) ahora coincide con el stock (${stockValue}). ¿Estás seguro de que deseas ${actionDescription} la cantidad?`;
                         } else {
                             const willMatch = (confirmQuantityNewValue ?? 0) === stockValue;
                             const previouslyMatched = (product?.count ?? 0) === stockValue;
                             let matchChangeDescription = '';
                             if (willMatch && !previouslyMatched) matchChangeDescription = 'ahora coincidirá con';
                             if (!willMatch && previouslyMatched) matchChangeDescription = 'ya no coincidirá con';

                             return `Al ${actionDescription} la cantidad a ${confirmQuantityNewValue ?? 'N/A'}, ${matchChangeDescription ? matchChangeDescription + ' el' : 'el'} stock (${stockValue}). ¿Estás seguro?`;
                         }
                    })()
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

            {/* Dialog for Editing Product Details (triggered from Counting List stock click) */}
             <EditProductDialog
                isOpen={isEditDetailDialogOpen}
                setIsOpen={setIsEditDetailDialogOpen}
                selectedDetail={productToEditDetail}
                setSelectedDetail={setProductToEditDetail}
                onSubmit={handleEditDetailSubmit}
                onDelete={(barcode) => { /* Implement delete from this dialog if needed */
                     console.warn("Delete action from counting list edit dialog not fully implemented yet.");
                      toast({variant: "default", title: "Info", description: "Para eliminar, usa la sección Base de Datos."})
                     // Optionally, trigger the delete confirmation from here
                     // const detail = { barcode, description: productToEditDetail?.description || '', provider: productToEditDetail?.provider || ''};
                     // triggerDeleteProductAlert(detail); // Need triggerDeleteProductAlert if implementing
                }}
                isProcessing={false} // Add processing state if needed
                initialStock={initialStockForEdit}
                context="countingList" // Indicate the context
             />


    </div>
  );
}
