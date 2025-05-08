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
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, AlertCircle, Search, Check, AppWindow, Database, Boxes, Loader2, History as HistoryIcon, CalendarIcon, Save, Edit, Download, BarChart, Settings, AlertTriangle } from "lucide-react";
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
  saveCountingHistory, // Import history saving function
  clearAllDatabases, // Import clear all data function
  getCountingHistory,
  clearCountingHistory,
  clearInventoryForWarehouse, // Import function to clear warehouse-specific items
} from '@/lib/database'; // Import IndexedDB helpers
import { CountingHistoryViewer } from '@/components/counting-history-viewer'; // Import History Viewer
import { DiscrepancyReportViewer } from '@/components/discrepancy-report-viewer'; // Import Discrepancy Report Viewer
import Papa from 'papaparse'; // Ensure PapaParse is imported

// --- Constants ---
const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection';
const LOCAL_STORAGE_SAVE_DEBOUNCE_MS = 500; // Debounce time for saving to localStorage

// --- Main Component ---

export default function Home() {
  // --- Refs ---
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
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
  const [isDeleteListDialogOpen, setIsDeleteListDialogOpen] = useState(false); // State for deleting entire list
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true); // Tracks loading for IndexedDB operations or initial list load
  const [isRefreshingStock, setIsRefreshingStock] = useState(false); // For the refresh button action specifically
  const [isSavingToHistory, setIsSavingToHistory] = useState(false); // State for saving to history
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null); // Keep for debouncing manual input
  const [isEditDetailDialogOpen, setIsEditDetailDialogOpen] = useState(false);
  const [productToEditDetail, setProductToEditDetail] = useState<ProductDetail | null>(null); // Detail only for edit dialog
  const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0); // Initial stock for edit dialog
  const [isClearAllDataConfirmOpen, setIsClearAllDataConfirmOpen] = useState(false); // State for clearing ALL data

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
    setIsDbLoading(true); // Start loading
    const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${currentWarehouseId}`;
    let savedList: DisplayProduct[] = [];
    try {
        savedList = getLocalStorageItem<DisplayProduct[]>(savedListKey, []);
    } catch (error) {
        console.error(`Error reading or parsing localStorage for key ${savedListKey}:`, error);
        localStorage.removeItem(savedListKey); // Remove corrupted data
        savedList = []; // Reset to empty array
    }

    if (Array.isArray(savedList) && savedList.every(item => typeof item?.barcode === 'string')) {
        const loadedList = savedList
            .map(item => ({
                ...item,
                stock: item.stock ?? 0,
                count: item.count ?? 0,
                lastUpdated: item.lastUpdated || new Date().toISOString(),
                warehouseId: item.warehouseId || currentWarehouseId // Ensure warehouseId is present
            }));
        console.log(`Loaded ${loadedList.length} items for warehouse ${currentWarehouseId} from localStorage.`);
        // Filter after loading to ensure only items for the current warehouse are in the state
        setCountingList(loadedList.filter(item => item.warehouseId === currentWarehouseId));
    } else {
        console.warn(`Invalid data structure in localStorage for warehouse ${currentWarehouseId}. Clearing.`);
        localStorage.removeItem(savedListKey); // Remove invalid data
        setCountingList([]);
    }
    setIsDbLoading(false); // Finish loading

 }, [currentWarehouseId]); // Only depend on warehouseId

 // Debounced save function for counting list
 const debouncedSaveCountingList = useMemo(
    () =>
      debounce((list: DisplayProduct[], warehouseId: string) => {
        if (!warehouseId || !isMountedRef.current) return;
        const key = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}`;
        // Ensure we save only items related to the current warehouse
        const listToSave = list.filter(item => item.warehouseId === warehouseId);
        setLocalStorageItem(key, listToSave);
        console.log(`Counting list for warehouse ${warehouseId} saved to localStorage.`);
      }, LOCAL_STORAGE_SAVE_DEBOUNCE_MS),
    [] // No dependencies, the function itself doesn't change
  );

  // Save Counting List to LocalStorage (Debounced)
  useEffect(() => {
    // Only save if not loading, component is mounted, and warehouse is selected
    if (!isDbLoading && isMountedRef.current && currentWarehouseId) {
      debouncedSaveCountingList(countingList, currentWarehouseId);
    }
    // Cleanup function for the debounced call
    return () => {
       debouncedSaveCountingList.clear?.(); // Assuming debounce implementation has a clear method
    };
  }, [countingList, currentWarehouseId, isDbLoading, debouncedSaveCountingList]); // Depend on list, warehouse, loading status, and the debounced function


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
      // Toast is safe here as it doesn't directly trigger render
      toast({ variant: "default", title: "Código vacío", description: "Por favor, introduce un código de barras." });
      setBarcode("");
      requestAnimationFrame(() => barcodeInputRef.current?.focus());
      return;
    }
    if (!currentWarehouseId) {
        // Toast is safe here
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
     // This timeout clears the 'lastScannedBarcode' state after a short duration
     // to allow scanning the same barcode again after a pause.
     const clearLastScannedTimeout = setTimeout(() => {
         if (isMountedRef.current) {
              setLastScannedBarcode(null);
         }
     }, 800); // Debounce duration


    let descriptionForToast = '';
    let productWasInList = false;
    let newCountForToast: number | null = null;
    let productAddedForToast: string | null = null;
    let unknownProductForToast: string | null = null;

    // Check the current list state first
    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
        productWasInList = true;
        const productToUpdate = countingList[existingProductIndex];
        descriptionForToast = productToUpdate.description;
        const newCount = (productToUpdate.count ?? 0) + 1;
        newCountForToast = newCount; // Store for toast after state update

        // Check if confirmation is needed before updating state
        const productStock = productToUpdate.stock ?? 0;
        const originalCount = productToUpdate.count ?? 0;
        // Confirmation needed if incrementing ABOVE stock level and the ORIGINAL count was <= stock
        const needsConfirmation = newCount > productStock && originalCount <= productStock && productStock > 0;


        if (needsConfirmation) {
             setConfirmQuantityProductBarcode(productToUpdate.barcode);
             setConfirmQuantityAction('increment');
             setConfirmQuantityNewValue(newCount);
             setIsConfirmQuantityDialogOpen(true);
             // Don't update state yet, wait for confirmation
             playBeep(660, 100); // Play a beep to acknowledge scan, but different pitch/duration?
        } else {
            // Update state asynchronously if no confirmation needed
            setCountingList(currentList => {
                const updatedProductData: DisplayProduct = {
                    ...productToUpdate,
                    count: newCount,
                    lastUpdated: new Date().toISOString(),
                };
                // Move updated product to the top
                return [updatedProductData, ...currentList.filter((_, index) => index !== existingProductIndex)];
            });
             playBeep(880, 100); // Standard increment beep
             // Trigger toast for increment after state update is scheduled
             toast({ title: "Cantidad aumentada", description: `${descriptionForToast} cantidad aumentada a ${newCount}.` });
        }


    } else {
        // Product not in the current list state, check the DB
        setIsDbLoading(true);
        let newProductForList: DisplayProduct | null = null; // Temporary holder
        try {
            const dbProduct = await getProductFromDB(trimmedBarcode);

            if (dbProduct) {
                descriptionForToast = dbProduct.description;
                productAddedForToast = descriptionForToast; // Store for toast
                newProductForList = {
                    ...dbProduct,
                    warehouseId: currentWarehouseId,
                    stock: dbProduct.stock ?? 0, // Use DB stock
                    count: 1, // Start count at 1
                    lastUpdated: new Date().toISOString(),
                };
                playBeep(660, 150); // Success beep
            } else {
                descriptionForToast = `Producto desconocido ${trimmedBarcode}`;
                unknownProductForToast = trimmedBarcode; // Store for toast
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
                playBeep(440, 300); // Play sound for unknown product
            }
             // Update state asynchronously after DB check, adding to the top
             if (isMountedRef.current && newProductForList) {
                 const finalProduct = newProductForList; // Ensure closure capture
                 setCountingList(currentList => [finalProduct, ...currentList]);
             }
        } catch (error) {
            console.error("Error fetching or adding product from IndexedDB:", error);
            // Toast is safe here
            toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo verificar o agregar el producto." });
            playBeep(440, 300); // Error beep
        } finally {
             if (isMountedRef.current) {
                 setIsDbLoading(false);
             }
        }
    }

    // Trigger toasts for non-increment cases (add/unknown) AFTER state updates are scheduled
    if (!productWasInList) {
        if (productAddedForToast) {
            toast({ title: "Producto agregado", description: `${productAddedForToast} agregado al inventario (${getWarehouseName(currentWarehouseId)}).` });
        } else if (unknownProductForToast) {
            toast({
                variant: "destructive",
                title: "Producto Desconocido",
                description: `Producto ${unknownProductForToast} no encontrado. Agregado temporalmente. Edita en 'Base de Datos'.`,
                duration: 7000,
            });
        }
    }


    // Clear input field and refocus regardless of outcome
    setBarcode("");
    requestAnimationFrame(() => barcodeInputRef.current?.focus());

    // Cleanup timeout for last scanned barcode debounce
    return () => clearTimeout(clearLastScannedTimeout);

  }, [barcode, currentWarehouseId, getWarehouseName, lastScannedBarcode, toast, countingList]); // Added countingList dependency


// Modify product value (count or stock) in the counting list and potentially DB
const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    if (!isMountedRef.current) return;

    let productDescription = '';
    let finalValue: number | undefined;
    let showToast = true;
    let needsConfirmation = false;
    let toastTitle = '';
    let toastDescription = '';

    setCountingList(prevList => {
        const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
        if (productIndex === -1) {
             console.warn(`Product ${barcodeToUpdate} not found in list for warehouse ${currentWarehouseId}. Cannot modify.`);
             return prevList;
        }

        const product = prevList[productIndex];
        productDescription = product.description; // Capture description for potential toast later
        const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
        finalValue = Math.max(0, originalValue + change); // Calculate final value first
        const productStock = product.stock ?? 0;

         // Confirmation needed if type is 'count', INCREASING count, final value > stock, and original value was <= stock
         needsConfirmation = type === 'count' && change > 0 && finalValue > productStock && originalValue <= productStock && productStock > 0;


        if (needsConfirmation) {
            setConfirmQuantityProductBarcode(product.barcode);
            setConfirmQuantityAction(change > 0 ? 'increment' : 'decrement'); // Still using increment/decrement here based on 'change'
            setConfirmQuantityNewValue(finalValue);
            setIsConfirmQuantityDialogOpen(true);
            showToast = false; // Defer toast until after confirmation
            return prevList; // Return previous list; confirmation pending
        } else {
            // No confirmation needed, update directly
            const updatedProduct = {
                 ...product,
                 [type]: finalValue,
                 lastUpdated: new Date().toISOString()
            };
             const updatedList = [...prevList];
             const listWithoutProduct = updatedList.filter((_, i) => i !== productIndex);
             // Move updated product to the top
             const newList = [updatedProduct, ...listWithoutProduct];

             // Prepare toast message for generic update (if needed)
              const valueTypeText = type === 'count' ? 'Cantidad' : 'Stock';
              const warehouseNameText = getWarehouseName(currentWarehouseId);
              toastTitle = `${valueTypeText} Modificada`;
              toastDescription = `${valueTypeText} de ${productDescription} (${warehouseNameText}) cambiada a ${finalValue}.`;

            return newList; // Return the modified list with the item at the top
        }
    });

    // --- Post-State Update Logic ---
    // Run this AFTER setCountingList update has been scheduled.

    if (!needsConfirmation && finalValue !== undefined) {
        // Update DB only if type is 'stock'
        if (type === 'stock') {
            try {
                const dbProduct = await getProductFromDB(barcodeToUpdate);
                if (dbProduct) {
                    const updatedDbProduct: ProductDetail = { ...dbProduct, stock: finalValue };
                    await addOrUpdateProductToDB(updatedDbProduct);
                    // Use specific DB toast, override generic one
                    toast({
                         title: `Stock (DB) Actualizado`,
                         description: `Stock de ${productDescription} actualizado a ${finalValue} en la base de datos.`
                     });
                    showToast = false; // Prevent generic toast
                } else {
                    console.warn(`Product ${barcodeToUpdate} not found in DB while trying to update stock.`);
                      // Try to find in potentially stale list state to create new DB entry if needed
                      const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                      if(listProduct) {
                           const newDbProduct: ProductDetail = {
                                barcode: listProduct.barcode,
                                description: listProduct.description,
                                provider: listProduct.provider,
                                stock: finalValue // Use calculated finalValue
                            };
                            await addOrUpdateProductToDB(newDbProduct);
                            // Use specific DB toast
                             toast({
                                 title: `Stock (DB) Establecido`,
                                 description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock} en la base de datos.`
                             });
                            showToast = false;
                      } else {
                         console.error("Could not find product in list state either to create DB entry.");
                         // Optionally show an error toast if product cannot be found anywhere
                      }
                }
            } catch (error) {
                console.error("Error updating stock in IndexedDB:", error);
                // Use specific DB error toast
                toast({
                    variant: "destructive",
                    title: "Error DB",
                    description: `No se pudo actualizar el stock en la base de datos para ${productDescription}.`
                });
                 showToast = false; // Prevent generic toast
            }
        }

        // Show generic toast only if no DB-specific toast was shown
        if (showToast && toastTitle && toastDescription) {
             toast({
                 title: toastTitle,
                 description: toastDescription,
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

    let productDescription = '';
    let finalValue: number | undefined;
    let showToast = true;
    let needsConfirmation = false;
    let toastTitle = '';
    let toastDescription = '';

    setCountingList(prevList => {
        const productIndex = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
        if (productIndex === -1) {
            console.warn(`Product ${barcodeToUpdate} not found in list for warehouse ${currentWarehouseId} during set value.`);
            return prevList;
        }

        const product = prevList[productIndex];
        productDescription = product.description; // Capture description
        const originalValue = type === 'count' ? product.count ?? 0 : product.stock ?? 0;
        let calculatedValue = sumValue ? (originalValue + newValue) : newValue;
        finalValue = Math.max(0, calculatedValue); // Ensure value is not negative
        const productStock = product.stock ?? 0;

        // Confirmation needed if type is 'count', setting/summing a value > stock, and original value was <= stock
        needsConfirmation = type === 'count' && finalValue > productStock && originalValue <= productStock && productStock > 0;


        if (needsConfirmation) {
            setConfirmQuantityProductBarcode(product.barcode);
            setConfirmQuantityAction('set'); // Use 'set' action type for confirmation
            setConfirmQuantityNewValue(finalValue);
            setIsConfirmQuantityDialogOpen(true);
            showToast = false; // Defer toast
            return prevList; // Confirmation pending
        } else {
            const updatedProduct = {
                ...product,
                [type]: finalValue,
                lastUpdated: new Date().toISOString()
            };
            const updatedList = [...prevList];
            const listWithoutProduct = updatedList.filter((_, i) => i !== productIndex);
            const newList = [updatedProduct, ...listWithoutProduct]; // Add updated product to the top
            setOpenModifyDialog(null); // Close dialog if no confirmation needed

            // Prepare generic toast message
            const valueTypeText = type === 'count' ? 'Cantidad' : 'Stock';
            const actionText = sumValue ? "sumada a" : "establecida en";
            const warehouseNameText = getWarehouseName(currentWarehouseId);
            toastTitle = `${valueTypeText} Modificada`;
            toastDescription = `${valueTypeText} de ${productDescription} (${warehouseNameText}) ${actionText} ${finalValue}.`;

            return newList; // Return updated list
        }
    });

    // --- Post-State Update Logic ---
    if (!needsConfirmation && finalValue !== undefined) {
         if (type === 'stock') {
             try {
                 const dbProduct = await getProductFromDB(barcodeToUpdate);
                 if (dbProduct) {
                     const updatedDbProduct: ProductDetail = { ...dbProduct, stock: finalValue };
                     await addOrUpdateProductToDB(updatedDbProduct);
                     // Specific DB toast
                      toast({
                          title: `Stock (DB) Actualizado`,
                          description: `Stock de ${productDescription} actualizado a ${finalValue} en la base de datos.`
                      });
                     showToast = false;
                 } else {
                     console.warn(`Product ${barcodeToUpdate} not found in DB while trying to update stock from dialog.`);
                       // Try to find in list state to create DB entry
                       const listProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === currentWarehouseId);
                       if(listProduct) {
                            const newDbProduct: ProductDetail = {
                                 barcode: listProduct.barcode,
                                 description: listProduct.description,
                                 provider: listProduct.provider,
                                 stock: finalValue
                             };
                             await addOrUpdateProductToDB(newDbProduct);
                             // Specific DB toast
                              toast({
                                  title: `Stock (DB) Establecido`,
                                  description: `Stock de ${newDbProduct.description} establecido a ${newDbProduct.stock} en la base de datos.`
                              });
                             showToast = false;
                       } else {
                          console.error("Could not find product in list state either to create DB entry from dialog.");
                       }
                 }
             } catch (error) {
                 console.error("Error updating stock in IndexedDB from dialog:", error);
                 // Specific DB error toast
                 toast({
                     variant: "destructive",
                     title: "Error DB",
                     description: `No se pudo actualizar el stock en la base de datos para ${productDescription}.`
                 });
                  showToast = false;
             }
         }

        // Show generic toast only if no DB-specific toast was shown
         if (showToast && toastTitle && toastDescription) {
             toast({
                 title: toastTitle,
                 description: toastDescription,
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
     let productDescription = ''; // Variable to hold description for the toast
     let confirmedValue: number | null = null; // Variable to hold the final value for toast

     // First, find the product to get its description before updating the state
     const productInList = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
     if (productInList) {
         productDescription = productInList.description;
     } else {
         console.warn("Product for confirmation not found in the list, cannot show description in toast.");
         // Proceed without description or use barcode as fallback
         productDescription = barcodeToUpdate;
     }

     // Update the state
     setCountingList(prevList => {
         const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (index === -1) return prevList; // Should not happen if productInList was found, but good practice

         const updatedList = [...prevList];
         const product = updatedList[index]; // Get the product again within the updater scope
         const finalConfirmedCount = Math.max(0, newValue); // Ensure non-negative
         confirmedValue = finalConfirmedCount; // Store for toast

         updatedList[index] = {
             ...product,
             count: finalConfirmedCount,
             lastUpdated: new Date().toISOString()
         };

         // Move updated product to the top
         return [updatedList[index], ...updatedList.filter((_, i) => i !== index)];
     });

     // Show toast *after* state update is initiated and if value is confirmed
     if (productDescription && confirmedValue !== null) {
         // Use requestAnimationFrame to ensure toast happens after the render cycle
         requestAnimationFrame(() => {
             toast({
                 title: "Cantidad Modificada",
                 description: `Cantidad de ${productDescription} (${getWarehouseName(warehouseId)}) cambiada a ${confirmedValue}.`
             });
         });
     }

     // Reset confirmation state
     setIsConfirmQuantityDialogOpen(false);
     setConfirmQuantityProductBarcode(null);
     setConfirmQuantityAction(null);
     setConfirmQuantityNewValue(null);
     setOpenModifyDialog(null); // Also close the modify dialog if it was open

 }, [currentWarehouseId, confirmQuantityProductBarcode, confirmQuantityAction, confirmQuantityNewValue, toast, getWarehouseName, countingList]); // Added countingList


 // Request deletion of a product from the counting list
 const handleDeleteRequest = useCallback((product: DisplayProduct) => {
         setProductToDelete(product);
         setIsDeleteDialogOpen(true);
  }, []);

 // Confirm deletion from the counting list
 const confirmDelete = useCallback(async () => {
     if (!isMountedRef.current || !productToDelete) return;

     const descriptionForToast = productToDelete.description;
     const barcodeForToast = productToDelete.barcode; // Get barcode too
     const warehouseId = productToDelete.warehouseId;

     setCountingList(prevList => prevList.filter(p => !(p.barcode === productToDelete.barcode && p.warehouseId === warehouseId)));

     // Toast after state update
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

  // Function to clear the current counting list
 const handleClearCurrentList = useCallback(() => {
     if (!isMountedRef.current || !currentWarehouseId) return;

     // Filter out items belonging to the current warehouse
     setCountingList(prevList => prevList.filter(p => p.warehouseId !== currentWarehouseId));

     requestAnimationFrame(() => {
         toast({
             title: "Lista Actual Borrada",
             description: `Se han eliminado todos los productos del inventario para ${getWarehouseName(currentWarehouseId)}.`,
             variant: "default"
         });
     });

     setIsDeleteListDialogOpen(false); // Close the confirmation dialog
 }, [currentWarehouseId, getWarehouseName, toast]);

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


  // Save current counting list to local history
  const handleSaveToHistory = useCallback(async (hideToast = false) => { // Add flag to optionally hide toast
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
            id: new Date().toISOString(), // Unique ID for the entry
            timestamp: new Date().toISOString(),
            warehouseId: currentWarehouseId,
            warehouseName: currentWHName,
            products: JSON.parse(JSON.stringify(currentListForWarehouse)) // Deep copy products
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


 // Refresh stock and details from IndexedDB
 const handleRefreshStock = useCallback(async () => {
     if (!currentWarehouseId || !isMountedRef.current) return;
     setIsRefreshingStock(true);
     console.log(`Refreshing stock and product details for warehouse ${currentWarehouseId} from IndexedDB...`);
     let updatedProductCount = 0;
     let addedProductCount = 0;
     try {
         const allDbProducts = await getAllProductsFromDB();
         const dbProductMap = new Map(allDbProducts.map(p => [p.barcode, p]));

         setCountingList(prevCountingList => {
             // Filter items for the current warehouse FIRST
             const currentWarehouseItems = prevCountingList.filter(item => item.warehouseId === currentWarehouseId);
             // Keep items from other warehouses separate
             const otherWarehouseItems = prevCountingList.filter(item => item.warehouseId !== currentWarehouseId);

             // Reset counters for this refresh
             updatedProductCount = 0;
             addedProductCount = 0;

             // Update existing items in the current warehouse list
             let updatedCurrentWarehouseList = currentWarehouseItems.map(countingProduct => {
                 const dbProduct = dbProductMap.get(countingProduct.barcode);
                 if (dbProduct) {
                     // Check if details actually changed before updating
                     if (countingProduct.description !== dbProduct.description ||
                         countingProduct.provider !== dbProduct.provider ||
                         countingProduct.stock !== (dbProduct.stock ?? 0))
                     {
                         updatedProductCount++;
                         return {
                             ...countingProduct, // Keep existing count and warehouseId
                             description: dbProduct.description, // Update description
                             provider: dbProduct.provider, // Update provider
                             stock: dbProduct.stock ?? 0, // Update stock
                             lastUpdated: new Date().toISOString(), // Update timestamp
                         };
                     }
                 }
                 // If not found in DB or no changes, keep the existing item as is
                 return countingProduct;
             });

              // Add items from DB that are not currently in the counting list FOR THIS WAREHOUSE
               allDbProducts.forEach(dbProduct => {
                   if (!updatedCurrentWarehouseList.some(cp => cp.barcode === dbProduct.barcode)) {
                       // Only add if it has a defined stock (or handle default stock case)
                       // No check needed, just add as new item for this warehouse
                       addedProductCount++;
                       updatedCurrentWarehouseList.push({
                           ...dbProduct, // Get details from DB
                           warehouseId: currentWarehouseId, // Assign to current warehouse
                           count: 0, // Initialize count to 0
                           lastUpdated: new Date().toISOString(),
                       });
                   }
               });

             // Sort the updated list (newest first)
             updatedCurrentWarehouseList.sort((a, b) => new Date(b.lastUpdated!).getTime() - new Date(a.lastUpdated!).getTime());

             // Combine the updated current warehouse list with items from other warehouses
             return [...updatedCurrentWarehouseList, ...otherWarehouseItems];
         });

         // Toast after state update is scheduled
          requestAnimationFrame(() => {
              toast({ title: "Datos Actualizados", description: `${updatedProductCount} producto(s) actualizado(s) y ${addedProductCount} agregado(s) desde la base de datos para ${getWarehouseName(currentWarehouseId)}.` });
          });
         console.log(`Stock and product details refreshed: ${updatedProductCount} updated, ${addedProductCount} added for warehouse: ${currentWarehouseId}`);

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
             const placeholderDetail: ProductDetail = {
                 barcode: product.barcode,
                 description: product.description,
                 provider: product.provider,
                 stock: product.stock ?? 0 // Stock is not in ProductDetail, get from DisplayProduct
             };
             setProductToEditDetail(placeholderDetail);
             setInitialStockForEdit(product.stock ?? 0); // Use stock from list item
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
         console.error("Failed to update product detail/stock:", error);
          requestAnimationFrame(() => {
             toast({ variant: "destructive", title: "Error al Actualizar", description: `No se pudo actualizar: ${error.message}` });
          });
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
         requestAnimationFrame(() => {
            toast({ title: "Vacío", description: "No hay productos para este proveedor." });
         });
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
      requestAnimationFrame(() => {
         toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos para ${getWarehouseName(currentWarehouseId)}.` });
      });
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

  // Handle section change (Contador, Base de Datos, Almacenes, Historial, Informes)
  const handleSectionChange = useCallback((newSection: string) => {
    setActiveSection(newSection);
    if (newSection === 'Contador') {
       requestAnimationFrame(() => barcodeInputRef.current?.focus());
    }
  }, [setActiveSection]);

   // Handle warehouse change
   const handleWarehouseChange = useCallback((newWarehouseId: string) => {
         if (newWarehouseId !== currentWarehouseId) {
             console.log("Switching warehouse to:", newWarehouseId);
             setIsDbLoading(true); // Indicate loading while switching
             setCurrentWarehouseId(newWarehouseId);
             setSearchTerm(""); // Reset search term
             // The useEffect for currentWarehouseId will handle loading the new list
         }
   }, [currentWarehouseId, setCurrentWarehouseId]);

   // Handle adding a new warehouse
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
              // Automatically switch to the new warehouse
             handleWarehouseChange(newWarehouse.id); // Use handleWarehouseChange to ensure proper state update
             requestAnimationFrame(() => {
                 toast({title: "Almacén Agregado", description: `Cambiado al nuevo almacén: ${newWarehouse.name}`});
              });
             return updatedWarehouses;
         });
   }, [setWarehouses, handleWarehouseChange, toast]);

   // Handle updating the list of warehouses (e.g., after edit/delete)
   const handleUpdateWarehouses = useCallback((updatedWarehouses: { id: string; name: string }[]) => {
         setWarehouses(updatedWarehouses);
         // Check if the currently selected warehouse still exists
         if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
              // If not, switch to the first available warehouse or 'main'
             const newCurrentId = updatedWarehouses[0]?.id || 'main';
             if (newCurrentId !== currentWarehouseId) {
                 handleWarehouseChange(newCurrentId); // Switch warehouse
                  requestAnimationFrame(() => {
                     toast({title: "Almacén Actualizado", description: `Almacén actual cambiado a ${getWarehouseName(newCurrentId)}.`});
                  });
             } else if (updatedWarehouses.length === 0) {
                 // Handle case where all warehouses are deleted - potentially add a default 'main'
                  const defaultWarehouse = { id: 'main', name: 'Almacén Principal' };
                  setWarehouses([defaultWarehouse]);
                  handleWarehouseChange(defaultWarehouse.id);
                   requestAnimationFrame(() => {
                      toast({title: "Almacenes Actualizados", description: "Se restauró el almacén principal."});
                   });
             }
         }
   }, [currentWarehouseId, setWarehouses, handleWarehouseChange, toast, getWarehouseName]);

   // Get the current value for the ModifyValueDialog
   const getCurrentValueForDialog = useCallback((type: 'count' | 'stock') => {
        if (!openModifyDialog?.product || !isMountedRef.current) return 0;
        // Find the most up-to-date item from the state
        const currentItem = countingList.find(
          p => p.barcode === openModifyDialog.product!.barcode && p.warehouseId === currentWarehouseId
        );
        return type === 'stock' ? (currentItem?.stock ?? 0) : (currentItem?.count ?? 0);
   }, [openModifyDialog, countingList, currentWarehouseId]);

  // Handle clearing ALL data (products and history)
   const handleClearAllData = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsDbLoading(true); // Indicate processing
    try {
      await clearAllDatabases(); // Call the DB function to clear all stores
      requestAnimationFrame(() => {
          toast({ title: "Base de Datos Borrada", description: "Todos los productos y el historial han sido eliminados." });
      });
      // Reset relevant states
      setCountingList([]);
      // Reset other related states if necessary (e.g., product database view)
       if (activeSection === 'Base de Datos') {
         // Trigger reload or state reset for ProductDatabase component if needed
         // This might involve a state variable or a key change for the component
       }
    } catch (error: any) {
      console.error("Error clearing all data:", error);
      requestAnimationFrame(() => {
          toast({ variant: "destructive", title: "Error al Borrar", description: `No se pudo borrar la base de datos: ${error.message}` });
      });
    } finally {
      if (isMountedRef.current) {
        setIsDbLoading(false);
      }
       setIsClearAllDataConfirmOpen(false); // Close confirmation dialog
    }
  }, [toast, activeSection]);


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
                    <SelectItem value="Informes">
                          <div className="flex items-center gap-2">
                              <BarChart className="h-4 w-4" /> Informes
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
                    isLoading={isDbLoading || isRefreshingStock || isSavingToHistory}
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
                     // Remove key prop if not causing issues, otherwise use a stable key
                />

              {/* Individual Action Buttons */}
               <div className="mt-4 flex flex-wrap justify-center md:justify-end gap-2">
                    <Button
                        onClick={() => handleSaveToHistory()}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading || isSavingToHistory}
                        variant="outline"
                        className="flex items-center gap-1"
                    >
                        {isSavingToHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {isSavingToHistory ? "Guardando..." : "Guardar Historial"}
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading}
                        variant="outline"
                        className="flex items-center gap-1"
                    >
                        <Download className="h-4 w-4" /> Exportar
                    </Button>
                    <Button
                        onClick={() => {
                            if (countingList.filter(p => p.warehouseId === currentWarehouseId).length > 0) {
                                setIsDeleteListDialogOpen(true); // Open confirmation dialog
                            } else {
                                requestAnimationFrame(() => {
                                    toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                                });
                            }
                        }}
                        disabled={countingList.filter(p => p.warehouseId === currentWarehouseId).length === 0 || isDbLoading}
                        variant="destructive"
                         className="flex items-center gap-1"
                    >
                        <Trash className="h-4 w-4" /> Borrar Lista
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
                    // Pass the handler to open the confirmation dialog for clearing all data
                    onClearDatabaseRequest={() => setIsClearAllDataConfirmOpen(true)}
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

           {/* Discrepancy Report Section */}
           {activeSection === 'Informes' && (
                <div id="discrepancy-report-content">
                    <DiscrepancyReportViewer
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
             // Logic moved to parent for description clarity
             (() => {
               if (confirmQuantityNewValue === null || !confirmQuantityProductBarcode) return "¿Continuar con la modificación?";
               const product = countingList.find(p => p.barcode === confirmQuantityProductBarcode && p.warehouseId === currentWarehouseId);
               const stock = product?.stock ?? 0;
               const description = product?.description ?? confirmQuantityProductBarcode; // Fallback to barcode

               if (confirmQuantityAction === 'set' || confirmQuantityAction === 'increment') {
                  if (stock > 0 && confirmQuantityNewValue > stock) {
                     return `La cantidad contada (${confirmQuantityNewValue}) ahora supera el stock del sistema (${stock}) para "${description}". ¿Confirmar?`;
                  }
               }
               // Generic confirmation for decrement or cases not exceeding stock
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

      {/* Confirmation for Clearing Current Counting List */}
      <ConfirmationDialog
          isOpen={isDeleteListDialogOpen}
          onOpenChange={setIsDeleteListDialogOpen}
          title="Confirmar Borrado de Lista"
          description={`¿Estás seguro de que deseas borrar todos los productos del inventario actual (${getWarehouseName(currentWarehouseId)})? Esta acción no se puede deshacer.`}
          onConfirm={handleClearCurrentList}
          onCancel={() => setIsDeleteListDialogOpen(false)}
          isDestructive={true}
      />

        {/* Confirmation Dialog for Clearing ALL Data */}
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
                    requestAnimationFrame(() => {
                       toast({title: "Producto Eliminado (DB)", description: `Producto ${barcode} eliminado de la base de datos.`});
                    });
                   setIsEditDetailDialogOpen(false);
                   setProductToEditDetail(null);
               } catch (error: any) {
                    if (!isMountedRef.current) return;
                   console.error("Failed to delete product from DB via edit dialog:", error);
                    requestAnimationFrame(() => {
                        toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
                    });
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
