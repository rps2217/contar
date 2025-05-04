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
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProductDatabase } from "@/components/product-database";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WarehouseManagement } from "@/components/warehouse-management";
import { format } from 'date-fns';
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, Camera, AlertCircle } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
// Import ZXing library for barcode scanning
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
// Update imports for new DB functions
import {
    addOrUpdateInventoryItem,
    getDisplayProductForWarehouse,
    getAllDisplayProductsForWarehouse,
    getProductDetail,
    addOrUpdateProductDetail,
    getInventoryItemsForWarehouse,
} from '@/lib/indexeddb-helpers';

const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';

// --- Helper Components ---

interface BarcodeEntryProps {
  barcode: string;
  setBarcode: (value: string) => void;
  onAddProduct: () => void;
  onScanClick: () => void;
  onRefreshStock: () => void;
  isLoading: boolean;
  isScanning: boolean;
  isRefreshingStock: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
}

const BarcodeEntry: React.FC<BarcodeEntryProps> = ({
  barcode,
  setBarcode,
  onAddProduct,
  onScanClick,
  onRefreshStock,
  isLoading,
  isScanning,
  isRefreshingStock,
  inputRef
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
       e.preventDefault();
       onAddProduct();
    }
 };

 return (
    <div className="flex items-center mb-4 gap-2">
        <Input
           type="number"
           pattern="\d*" // Ensures numeric keyboard on mobile if supported
           inputMode="numeric" // Better semantic for numeric input
           placeholder="Escanear o ingresar código de barras"
           value={barcode}
           onChange={(e) => {
               // Ensure only digits are entered
               const numericValue = e.target.value.replace(/\D/g, '');
               setBarcode(numericValue);
           }}
           className="mr-2 flex-grow bg-yellow-100 dark:bg-yellow-900 border-teal-300 dark:border-teal-700 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm"
           ref={inputRef}
           onKeyDown={handleKeyDown}
            aria-label="Código de barras"
         />
         <Button
            onClick={onScanClick}
            variant="outline"
            size="icon"
            className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
            aria-label="Escanear código de barras con la cámara"
            title="Escanear con Cámara"
            disabled={isLoading || isScanning}
         >
             <Camera className="h-5 w-5" />
         </Button>
         <Button
           onClick={onAddProduct}
           className="bg-teal-600 hover:bg-teal-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200"
           aria-label="Agregar producto al almacén actual"
           disabled={isLoading}
         >
           Agregar
         </Button>
         <Button
             onClick={onRefreshStock}
             variant="outline"
             size="icon"
             className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
             disabled={isRefreshingStock || isLoading}
             aria-label="Actualizar stocks desde la base de datos para este almacén"
             title="Actualizar Stocks"
         >
              <RefreshCw className={`h-5 w-5 ${isRefreshingStock ? 'animate-spin' : ''}`} />
         </Button>
      </div>
 );
};


interface CountingListTableProps {
  countingList: DisplayProduct[];
  warehouseName: string;
  isLoading: boolean;
  onDeleteRequest: (product: DisplayProduct) => void;
  onOpenStockDialog: (product: DisplayProduct) => void;
  onOpenQuantityDialog: (product: DisplayProduct) => void;
  onDecrement: (barcode: string, type: 'count' | 'stock') => void;
  onIncrement: (barcode: string, type: 'count' | 'stock') => void;
}

const CountingListTable: React.FC<CountingListTableProps> = ({
  countingList,
  warehouseName,
  isLoading,
  onDeleteRequest,
  onOpenStockDialog,
  onOpenQuantityDialog,
  onDecrement,
  onIncrement,
}) => {
  return (
    <ScrollArea className="h-[calc(100vh-310px)] md:h-[calc(100vh-280px)] border rounded-lg shadow-sm bg-white dark:bg-gray-800">
        <Table>
           <TableCaption className="py-3 text-sm text-gray-500 dark:text-gray-400">Inventario para {warehouseName}.</TableCaption>
           <TableHeader className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10 shadow-sm">
             <TableRow>
               <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[35%] sm:w-2/5">Descripción</TableHead>
               <TableHead className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/5">
                 Proveedor
               </TableHead>
               <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[10%] sm:w-[10%]">Stock</TableHead>
               <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[10%] sm:w-[10%]">Cantidad</TableHead>
               <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/5">Última Actualización</TableHead>
               <TableHead className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[5%]">Validación</TableHead>
               <TableHead className="text-center hidden md:table-cell px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[15%]">Acciones</TableHead>
             </TableRow>
           </TableHeader>
           <TableBody>
             {countingList.map((product, index) => (
               <TableRow
                 key={`${product.barcode}-${product.warehouseId}`} // Unique key per warehouse
                 className={cn(
                   "hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150",
                   product.count === product.stock && product.stock !== 0 ? "bg-green-50 dark:bg-green-900/30" : ""
                 )}
                 aria-rowindex={index + 1}
               >
                 <TableCell
                     className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:text-red-600 dark:hover:text-red-400 hover:underline"
                     onClick={() => onDeleteRequest(product)}
                     title={`Eliminar ${product.description} de este inventario`}
                     aria-label={`Eliminar ${product.description}`}
                 >
                   {product.description}
                 </TableCell>
                 <TableCell className="hidden sm:table-cell px-4 py-3 text-gray-600 dark:text-gray-300">
                   {product.provider || 'N/A'}
                 </TableCell>
                 <TableCell
                     className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 cursor-pointer hover:text-teal-700 dark:hover:text-teal-400 hover:font-semibold tabular-nums"
                     onClick={() => onOpenStockDialog(product)}
                     title={`Editar stock para ${product.description} en ${warehouseName}`}
                     aria-label={`Editar stock para ${product.description}`}
                 >
                       {product.stock ?? 0}
                 </TableCell>
                 <TableCell
                   className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 cursor-pointer hover:text-teal-700 dark:hover:text-teal-400 hover:font-semibold tabular-nums"
                   onClick={() => onOpenQuantityDialog(product)}
                   title={`Editar cantidad para ${product.description} en ${warehouseName}`}
                    aria-label={`Editar cantidad para ${product.description}`}
                 >
                   {product.count ?? 0}
                 </TableCell>
                  <TableCell className="hidden md:table-cell px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {product.lastUpdated ? format(new Date(product.lastUpdated), 'PPpp', { timeZone: 'auto' }) : 'N/A'}
                  </TableCell>
                   <TableCell className="hidden md:table-cell px-4 py-3 text-center">
                       {product.count === product.stock && product.stock !== 0 ? (
                           <span className="text-green-600 dark:text-green-400 font-semibold">OK</span>
                       ) : product.count > product.stock ? (
                           <span className="text-yellow-600 dark:text-yellow-400 font-semibold">+{product.count - product.stock}</span>
                       ) : product.stock > 0 && product.count < product.stock ? (
                            <span className="text-red-600 dark:text-red-400 font-semibold">{product.count - product.stock}</span>
                       ) : null }
                   </TableCell>
                 <TableCell className="text-center hidden md:table-cell px-4 py-3">
                    <div className="flex justify-center items-center space-x-1">
                       <Button
                         onClick={() => onDecrement(product.barcode, 'count')}
                         size="icon"
                          variant="ghost"
                          className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full w-8 h-8"
                          aria-label={`Disminuir cantidad para ${product.description}`}
                       >
                         <Minus className="h-4 w-4" />
                       </Button>
                       <Button
                         onClick={() => onIncrement(product.barcode, 'count')}
                          size="icon"
                          variant="ghost"
                          className="text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 rounded-full w-8 h-8"
                          aria-label={`Aumentar cantidad para ${product.description}`}
                       >
                         <Plus className="h-4 w-4" />
                       </Button>
                    </div>
                 </TableCell>
               </TableRow>
             ))}
             {countingList.length === 0 && (
               <TableRow>
                 <TableCell colSpan={7} className="text-center px-4 py-10 text-gray-500 dark:text-gray-400">
                   {isLoading ? "Cargando datos del almacén..." : "No hay productos en este inventario. Escanea un código de barras para empezar."}
                 </TableCell>
               </TableRow>
             )}
           </TableBody>
         </Table>
       </ScrollArea>
  );
};


// --- Main Component ---

export default function Home() {
  const [barcode, setBarcode] = useState("");
  const [warehouses, setWarehouses] = useState(() => {
    if (typeof window !== 'undefined') {
      const storedWarehouses = localStorage.getItem(LOCAL_STORAGE_WAREHOUSES_KEY);
      return storedWarehouses ? JSON.parse(storedWarehouses) : [{ id: 'main', name: 'Almacén Principal' }];
    }
    return [{ id: 'main', name: 'Almacén Principal' }]; // Default warehouses
  });

  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>(() => {
     if (typeof window !== 'undefined') {
      return localStorage.getItem(LOCAL_STORAGE_WAREHOUSE_KEY) || warehouses[0].id;
    }
    return warehouses[0].id; // Default warehouse
  });
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]); // Products in the current count session for the selected warehouse
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null); // Ref for the video element
  const [openQuantityDialog, setOpenQuantityDialog] = useState(false);
  const [openStockDialog, setOpenStockDialog] = useState(false);
  const [selectedProductForDialog, setSelectedProductForDialog] = useState<DisplayProduct | null>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'increment' | 'decrement' | null>(null);
  const [confirmProductBarcode, setConfirmProductBarcode] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true); // Loading state for initial data load for the warehouse
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  const [isScanning, setIsScanning] = useState(false); // State to control camera scanning view/modal
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null); // State for camera permission
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null); // Ref for the scanner reader instance
  const streamRef = useRef<MediaStream | null>(null); // Ref to hold the camera stream


  const getLocalStorageKeyForWarehouse = (warehouseId: string) => {
    return `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}`;
  };

  // Function to load data for the selected warehouse
  const loadWarehouseData = useCallback(async (warehouseId: string) => {
    setIsDbLoading(true);
    console.log(`page.tsx: Loading data for warehouse: ${warehouseId}...`);
    try {
        // Load counting list from localStorage for the specific warehouse
         if (typeof window !== 'undefined') {
            const savedListKey = getLocalStorageKeyForWarehouse(warehouseId);
            const savedList = localStorage.getItem(savedListKey);
            if (savedList) {
                 const parsedList: DisplayProduct[] = JSON.parse(savedList);
                 // Basic validation
                 if (Array.isArray(parsedList) && parsedList.every(item =>
                    typeof item === 'object' && item !== null &&
                    typeof item.barcode === 'string' &&
                    typeof item.warehouseId === 'string' &&
                    typeof item.description === 'string' &&
                    typeof item.count === 'number' &&
                    typeof item.stock === 'number'
                 )) {
                    setCountingList(parsedList);
                     console.log(`Loaded counting list for warehouse ${warehouseId} from localStorage:`, parsedList.length, "items");
                } else {
                     console.warn(`Invalid data in localStorage for warehouse ${warehouseId}. Clearing.`);
                     localStorage.removeItem(savedListKey);
                     setCountingList([]);
                 }
            } else {
                setCountingList([]);
                console.log(`No counting list found in localStorage for warehouse ${warehouseId}. Starting fresh.`);
            }
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
        barcodeInputRef.current?.focus();
    }
  }, [toast]);

  // Load data when the component mounts or warehouse changes
  useEffect(() => {
    loadWarehouseData(currentWarehouseId);
  }, [currentWarehouseId, loadWarehouseData]);

  // Save counting list to localStorage whenever it changes for the current warehouse
  useEffect(() => {
    if (typeof window !== 'undefined' && !isDbLoading) { // Avoid saving during initial load
      try {
          const key = getLocalStorageKeyForWarehouse(currentWarehouseId);
          localStorage.setItem(key, JSON.stringify(countingList));
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

   // Save selected warehouse to localStorage
  useEffect(() => {
     if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_STORAGE_WAREHOUSE_KEY, currentWarehouseId);
    }
  }, [currentWarehouseId]);

    useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_WAREHOUSES_KEY, JSON.stringify(warehouses));
    }
  }, [warehouses]);


   const getWarehouseName = useCallback((warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : 'Unknown Warehouse';
  }, [warehouses]);


  const playBeep = useCallback((frequency = 660, duration = 150) => {
     if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        try {
             const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
             const oscillator = audioCtx.createOscillator();
             const gainNode = audioCtx.createGain();

             oscillator.type = 'sine';
             oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
             gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
             gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);

             oscillator.connect(gainNode);
             gainNode.connect(audioCtx.destination);

             oscillator.start(audioCtx.currentTime);
             oscillator.stop(audioCtx.currentTime + duration / 1000);

             // Close context after sound finishes playing
             const closeTimeout = setTimeout(() => {
                 audioCtx.close().catch(err => console.warn("Error closing AudioContext:", err));
             }, duration + 100);

             return () => clearTimeout(closeTimeout);

        } catch (error: any) {
             // Ignore NotAllowedError
             if (error.name === 'NotAllowedError') {
                 console.warn("AudioContext playback prevented by browser policy.");
             } else {
                 console.error("Error playing beep sound:", error);
             }
        }
    } else {
        console.warn("AudioContext not supported. Cannot play beep sound.");
    }
    return () => {}; // Return empty cleanup if AudioContext not supported
  }, []);

 // Handles adding or incrementing a product in the counting list for the current warehouse
 const handleAddProduct = useCallback(async (barcodeToAdd?: string) => {
    const trimmedBarcode = (barcodeToAdd ?? barcode).trim();

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

    const existingProductIndex = countingList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndex !== -1) {
        // Product exists, increment count
        const productToUpdate = countingList[existingProductIndex];
        const newCount = productToUpdate.count + 1;
        const descriptionForToast = productToUpdate.description;

        setCountingList(prevList => {
            const updatedList = [...prevList];
            const internalIndex = updatedList.findIndex(p => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);
            if (internalIndex === -1) return prevList;

            const updatedProductData: DisplayProduct = {
                ...updatedList[internalIndex],
                count: newCount,
                lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
            };
             updatedList.splice(internalIndex, 1);
             updatedList.unshift(updatedProductData);

            return updatedList;
        });

        toast({
            title: "Cantidad aumentada",
            description: `${descriptionForToast} cantidad aumentada a ${newCount}.`,
        });
        playBeep(880, 100); // Higher pitch beep for increment

    } else {
        // Product not in list, fetch details and inventory
        try {
             const displayProduct = await getDisplayProductForWarehouse(trimmedBarcode, currentWarehouseId);

             if (displayProduct) {
                // Found in DB for this warehouse or details found with default inventory
                const newProductForList: DisplayProduct = {
                    ...displayProduct,
                    count: 1,
                    lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
                 };
                 setCountingList(prevList => [newProductForList, ...prevList]);
                 toast({
                     title: "Producto agregado",
                     description: `${newProductForList.description} agregado al inventario (${getWarehouseName(currentWarehouseId)}).`,
                 });
                 playBeep(660, 150); // Standard beep
             } else {
                // Product detail not found in DB at all
                 playBeep(440, 300); // Lower pitch for unknown product
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
                    lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
                 };

                 await addOrUpdateProductDetail(newProductDetail);
                 await addOrUpdateInventoryItem(newInventoryItem);

                  const newDisplayProduct: DisplayProduct = {
                      ...newProductDetail,
                      ...newInventoryItem,
                  };
                  setCountingList(prevList => [newDisplayProduct, ...prevList]);

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

 }, [barcode, countingList, currentWarehouseId, toast, playBeep, getWarehouseName]);


 // Modify product count or stock, handling confirmation dialog
 const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    let productToConfirm: DisplayProduct | null = null;
    let needsConfirmation = false;
    let originalValue = -1;
    let updatedProductDescription = '';
    const warehouseId = currentWarehouseId;

     setCountingList(prevList => {
        const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
        if (index === -1) return prevList;

        const updatedList = [...prevList];
        const product = updatedList[index];
        updatedProductDescription = product.description;
        let finalValue;

        if (type === 'count') {
            originalValue = product.count;
            finalValue = product.count + change;
            if (finalValue < 0) finalValue = 0;

            // Confirmation logic
            if (product.stock !== 0) {
                 const changingToMatch = change > 0 && finalValue === product.stock;
                 const changingFromMatch = change < 0 && product.count === product.stock;
                if (changingToMatch || changingFromMatch) {
                    productToConfirm = { ...product };
                    needsConfirmation = true;
                }
            }

             if (needsConfirmation) {
                 console.log("Confirmation needed for", product.barcode, "in warehouse", warehouseId);
                 updatedList[index] = { ...product }; // Keep current state temporarily
             } else {
                 updatedList[index] = { ...product, count: finalValue, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
             }

        } else { // type === 'stock'
            originalValue = product.stock;
            finalValue = product.stock + change;
            if (finalValue < 0) finalValue = 0;
            updatedList[index] = { ...product, stock: finalValue, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
        }

        return updatedList;
    });

     // Update stock in IndexedDB if stock changed
     if (type === 'stock') {
        const originalStockValue = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId)?.stock ?? 0;
        const newStock = originalStockValue + change;

         if (newStock >= 0) {
             try {
                 const itemToUpdate: InventoryItem = {
                    barcode: barcodeToUpdate,
                    warehouseId: warehouseId,
                    stock: newStock,
                    count: countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId)?.count ?? 0,
                    lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
                };
                 await addOrUpdateInventoryItem(itemToUpdate);
                 toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${newStock} en la base de datos.` });
             } catch (error) {
                 console.error("Failed to update stock in DB:", error);
                 toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
                 // Revert stock change in state
                 setCountingList(prevList => {
                    const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                    if (index === -1) return prevList;
                    const revertedList = [...prevList];
                    revertedList[index] = { ...revertedList[index], stock: originalStockValue };
                    return revertedList;
                });
            }
        } else {
            toast({ variant: "destructive", title: "Stock Inválido", description: "El stock no puede ser negativo." });
             // Revert optimistic UI update
              setCountingList(prevList => {
                 const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                 if (index === -1) return prevList;
                 const revertedList = [...prevList];
                 revertedList[index] = { ...revertedList[index], stock: originalStockValue };
                 return revertedList;
             });
        }
    }

    // Handle confirmation dialog
    if (needsConfirmation && productToConfirm && type === 'count') {
        console.log("Setting up confirmation dialog for:", productToConfirm.barcode, "in warehouse", warehouseId);
        setConfirmProductBarcode(productToConfirm.barcode);
        setConfirmAction(change > 0 ? 'increment' : 'decrement');
        setIsConfirmDialogOpen(true);
    } else if (type === 'count' && !needsConfirmation) {
        // Toast for non-confirmed count changes
         const finalCountValue = originalValue + change;
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) cambiada a ${finalCountValue < 0 ? 0 : finalCountValue}.` });
    }

 }, [countingList, currentWarehouseId, toast, getWarehouseName]); // Removed warehouses dependency


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
    let newCount = 0;
    const warehouseId = currentWarehouseId;

    if (confirmProductBarcode && confirmAction) {
      const change = confirmAction === 'increment' ? 1 : -1;
      setCountingList(prevList => {
          const index = prevList.findIndex(p => p.barcode === confirmProductBarcode && p.warehouseId === warehouseId);
          if (index === -1) return prevList;

          const updatedList = [...prevList];
          const product = updatedList[index];
          descriptionForToast = product.description;
          newCount = product.count + change;
          updatedList[index] = {
              ...product,
              count: newCount < 0 ? 0 : newCount,
              lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
          };
          return updatedList;
      });
      toast({ title: "Cantidad Modificada", description: `Cantidad de ${descriptionForToast} (${getWarehouseName(warehouseId)}) cambiada a ${newCount}.` });
    }
    // Reset confirmation state
    setIsConfirmDialogOpen(false);
    setConfirmProductBarcode(null);
    setConfirmAction(null);
 }, [currentWarehouseId, confirmProductBarcode, confirmAction, toast, getWarehouseName]);


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
 }, [productToDelete, toast, getWarehouseName]);

 // --- Export Functionality ---
 const handleExport = useCallback(() => {
    if (countingList.length === 0) {
        toast({ title: "Vacío", description: "No hay productos en el inventario actual para exportar." });
        return;
    }
    try {
        // Add warehouse name to exported data
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
    setIsRefreshingStock(true);
    console.log(`Refreshing stock counts for warehouse ${currentWarehouseId} from database...`);
    try {
      const warehouseInventory = await getInventoryItemsForWarehouse(currentWarehouseId);
      const inventoryMap = new Map<string, InventoryItem>();
      warehouseInventory.forEach(item => inventoryMap.set(item.barcode, item));

      setCountingList(prevCountingList => {
        return prevCountingList.map(countingProduct => {
          const dbInventoryItem = inventoryMap.get(countingProduct.barcode);
          return dbInventoryItem
            ? { ...countingProduct, stock: dbInventoryItem.stock, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') }
            : countingProduct;
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
 }, [currentWarehouseId, toast, getWarehouseName]);


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
        setSelectedProductForDialog(null); // Clear selected product when closing
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
                description: 'Warehouse ID already exists. Please use a unique ID.',
                });
                return prevWarehouses;
            }
            return [...prevWarehouses, newWarehouse];
        });
    };

    const handleUpdateWarehouses = (updatedWarehouses: { id: string; name: string }[]) => {
        setWarehouses(updatedWarehouses);
    };


    // --- Camera Scanning Logic ---

    // Function to stop camera stream and release resources
    const stopCameraStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            console.log("Camera stream stopped.");
        }
         if (videoRef.current) {
            videoRef.current.srcObject = null; // Clear video source
        }
        if (scannerReaderRef.current) {
            scannerReaderRef.current.reset(); // Reset the scanner reader
            // Don't nullify scannerReaderRef here, keep the instance for potential reuse
        }
    }, []);

    // Effect to request camera permission and set up video stream/scanning
    useEffect(() => {
        let reader: BrowserMultiFormatReader | null = null;
        let cancelled = false; // Flag to prevent updates after component unmounts or effect cleans up

        const initScanner = async () => {
             if (!isScanning) {
                stopCameraStream(); // Ensure cleanup when scanning stops
                return;
            }

             // Ensure videoRef is available before proceeding
             if (!videoRef.current) {
                console.warn("Video element ref not available yet. Retrying...");
                 // Retry after a short delay
                 setTimeout(() => {
                     if (isScanning && !cancelled) {
                         initScanner();
                     }
                 }, 100);
                 return;
             }

             // Initialize the scanner reader only once
             if (!scannerReaderRef.current) {
                 scannerReaderRef.current = new BrowserMultiFormatReader();
                 console.log("ZXing BrowserMultiFormatReader initialized.");
             }
             reader = scannerReaderRef.current;

            try {
                // Request camera permission and get stream
                console.log("Requesting camera permission...");
                const constraints = { video: { facingMode: "environment" } };
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                 if (cancelled) {
                     stream.getTracks().forEach(track => track.stop());
                     return;
                 }

                console.log("Camera permission granted.");
                setHasCameraPermission(true);
                streamRef.current = stream;

                 // Attach stream to video element if it's still mounted
                 if (videoRef.current) {
                     videoRef.current.srcObject = stream;
                      await videoRef.current.play();
                     console.log("Video stream attached and playing.");
                 } else {
                     console.warn("Video ref became null before attaching stream.");
                     stream.getTracks().forEach(track => track.stop());
                     return;
                 }

                 // Start continuous scanning
                 console.log("Starting barcode decoding from video device...");
                 reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
                      if (cancelled) return;

                      if (result) {
                          console.log('Barcode detected:', result.getText());
                          const detectedBarcode = result.getText();
                          setIsScanning(false);
                          playBeep(900, 80);
                          requestAnimationFrame(() => {
                              setBarcode(detectedBarcode); // Update state first
                              handleAddProduct(detectedBarcode); // Then call add product
                          });
                      }
                      if (err && !(err instanceof NotFoundException)) {
                          console.error('Scanning error:', err);
                          // Maybe add a non-intrusive indicator of scanning issues?
                      }
                 });
                 console.log("Barcode decoding started.");

            } catch (error: any) {
                if (cancelled) return;

                console.error('Error accessing camera or starting scanner:', error);
                setHasCameraPermission(false);
                toast({
                    variant: 'destructive',
                    title: 'Acceso a Cámara Denegado',
                    description: `Por favor, habilita los permisos de cámara. Error: ${error.message}`,
                    duration: 9000
                });
                setIsScanning(false);
            }
        };

        if (isScanning) {
             console.log("isScanning is true, initializing scanner...");
             initScanner();
         } else {
             console.log("isScanning is false, ensuring camera is stopped.");
             stopCameraStream();
         }

        // Cleanup function
        return () => {
            console.log("Cleaning up camera effect...");
            cancelled = true;
            stopCameraStream();
            // Explicitly release the reader instance? According to docs, reset should be enough.
            // scannerReaderRef.current = null; // Consider if this is necessary
        };
     }, [isScanning, toast, playBeep, handleAddProduct, stopCameraStream]);


    // Handler to start scanning
    const handleScanButtonClick = () => {
        console.log("Scan button clicked, setting isScanning to true.");
        setHasCameraPermission(null); // Reset permission status before starting
        setIsScanning(true);
    };

    // Handler to stop scanning
    const handleStopScanning = () => {
        console.log("Stop scanning button clicked, setting isScanning to false.");
        setIsScanning(false);
    };

    // --- Dialog Renderers ---
    const renderModifyDialog = (
        isOpen: boolean,
        setIsOpen: (open: boolean) => void,
        type: 'count' | 'stock',
        product: DisplayProduct | null
    ) => {
        if (!product) return null;
        const isStockDialog = type === 'stock';
        const currentValue = isStockDialog ?
            (countingList.find(p => p.barcode === product.barcode && p.warehouseId === currentWarehouseId)?.stock ?? 0) :
            (countingList.find(p => p.barcode === product.barcode && p.warehouseId === currentWarehouseId)?.count ?? 0);
        const titleText = isStockDialog ? `Ajustar Stock (${product.description})` : `Ajustar Cantidad (${product.description})`;
        const descriptionText = isStockDialog ?
            `Ajuste el stock del producto en este almacén (${getWarehouseName(currentWarehouseId)}). Este cambio se reflejará en la base de datos.` :
            `Ajuste la cantidad contada manualmente en ${getWarehouseName(currentWarehouseId)}.`;

        return (
             <Dialog open={isOpen} onOpenChange={(openState) => { if (!openState) handleCloseDialogs(); else setIsOpen(true); }}>
                <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-900 text-black dark:text-white border-teal-500 rounded-lg shadow-xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-center text-xl font-semibold text-gray-800 dark:text-gray-200">
                             <span className="flex items-center justify-center gap-2">
                                <WarehouseIcon className="h-6 w-6 text-teal-600"/>
                                {getWarehouseName(currentWarehouseId)}
                            </span>
                            {titleText}
                        </DialogTitle>
                        <DialogDescription className="text-center text-gray-600 dark:text-gray-400 mt-1">
                            {descriptionText}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-6">
                         <div className="flex justify-around items-center">
                            <Button
                                size="lg"
                                className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
                                onClick={() => handleDecrement(product.barcode, type)}
                                aria-label={`Disminuir ${type}`}
                            >
                                <Minus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>
                            <div className="text-5xl sm:text-6xl font-bold mx-4 sm:mx-6 text-gray-800 dark:text-gray-100 tabular-nums select-none">
                                {currentValue}
                            </div>
                            <Button
                                size="lg"
                                className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
                                onClick={() => handleIncrement(product.barcode, type)}
                                aria-label={`Aumentar ${type}`}
                            >
                                <Plus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="mt-4">
                         <DialogClose asChild>
                             <Button type="button" variant="outline" className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={handleCloseDialogs}>
                                Cerrar
                            </Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }


    // --- Confirmation and Deletion Dialogs ---
    const renderConfirmationDialog = () => (
        <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
           <AlertDialogContent>
               <AlertDialogHeader>
               <AlertDialogTitle>Confirmar Modificación</AlertDialogTitle>
               <AlertDialogDescription>
                   La cantidad contada coincide con el stock ({countingList.find(p=>p.barcode===confirmProductBarcode)?.stock}). ¿Estás seguro de que deseas modificar la cantidad?
               </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
               <AlertDialogCancel onClick={() => setIsConfirmDialogOpen(false)}>Cancelar</AlertDialogCancel>
               <AlertDialogAction onClick={handleConfirmQuantityChange}>Confirmar</AlertDialogAction>
               </AlertDialogFooter>
           </AlertDialogContent>
       </AlertDialog>
    );

    const renderDeleteConfirmationDialog = () => (
       <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
           <AlertDialogContent>
               <AlertDialogHeader>
                   <AlertDialogTitle>Confirmar Eliminación</AlertDialogTitle>
                   <AlertDialogDescription>
                       ¿Estás seguro de que deseas eliminar el producto "{productToDelete?.description}" del inventario actual ({getWarehouseName(productToDelete?.warehouseId)})? Esta acción no se puede deshacer.
                   </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                   <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>Cancelar</AlertDialogCancel>
                   <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">
                       Eliminar
                   </AlertDialogAction>
               </AlertDialogFooter>
           </AlertDialogContent>
       </AlertDialog>
   );

   // --- Camera Scanning Modal/View ---
   const renderScannerView = () => (
       <Dialog open={isScanning} onOpenChange={(open) => { if (!open) { setIsScanning(false); } else { setIsScanning(true); } }}>
           <DialogContent className="max-w-md w-full p-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
               <DialogHeader>
                   <DialogTitle className="text-center text-lg font-semibold text-gray-800 dark:text-gray-200">Escanear Código de Barras</DialogTitle>
                   <DialogDescription className="text-center text-sm text-gray-600 dark:text-gray-400">
                       Apunta la cámara al código de barras.
                   </DialogDescription>
               </DialogHeader>
                <div className="my-4 relative aspect-video">
                    <video ref={videoRef} className="w-full aspect-video rounded-md bg-black" autoPlay muted playsInline />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-3/4 h-1/2 border-2 border-red-500 rounded-md opacity-75"></div>
                    </div>
                    {hasCameraPermission === null && !isScanning && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">Iniciando cámara...</div>
                    )}
                    {hasCameraPermission === null && isScanning && (
                       <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">Solicitando permiso...</div>
                    )}
                    {hasCameraPermission === false && (
                       <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 p-4 rounded-md">
                         <Alert variant="destructive" className="w-full">
                           <AlertCircle className="h-4 w-4" />
                           <AlertTitle>Acceso a Cámara Requerido</AlertTitle>
                           <AlertDescription>
                             Permite el acceso a la cámara en la configuración de tu navegador.
                           </AlertDescription>
                         </Alert>
                       </div>
                     )}
                </div>
               <DialogFooter className="mt-4">
                   <Button variant="outline" onClick={handleStopScanning}>Cancelar</Button>
               </DialogFooter>
           </DialogContent>
       </Dialog>
   );


  // --- Main Component Render ---
  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
         <h1 className="text-2xl font-bold text-gray-700 dark:text-gray-200">StockCounter Pro</h1>
         <div className="flex items-center gap-2">
              <WarehouseIcon className="h-5 w-5 text-gray-600 dark:text-gray-400"/>
              <Select value={currentWarehouseId} onValueChange={handleWarehouseChange}>
                <SelectTrigger className="w-[180px] sm:w-[250px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
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
      </div>


      <Tabs defaultValue="Contador" className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
         <TabsList className="grid w-full grid-cols-3 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg mb-4 shadow-inner">
           <TabsTrigger
              value="Contador"
              className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-300 py-2 px-4 rounded-md transition-colors duration-200 ease-in-out font-medium text-xs sm:text-sm"
           >
               Contador ({getWarehouseName(currentWarehouseId)})
           </TabsTrigger>
           <TabsTrigger
              value="Base de Datos"
              className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-300 py-2 px-4 rounded-md transition-colors duration-200 ease-in-out font-medium text-xs sm:text-sm"
            >
                Base de Datos
            </TabsTrigger>
              <TabsTrigger
              value="Almacenes"
              className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 dark:data-[state=inactive]:text-gray-300 py-2 px-4 rounded-md transition-colors duration-200 ease-in-out font-medium text-xs sm:text-sm"
            >
                Almacenes
            </TabsTrigger>
         </TabsList>

        {/* Content for the Counter Tab */}
        <TabsContent value="Contador">
            <BarcodeEntry
                barcode={barcode}
                setBarcode={setBarcode}
                onAddProduct={() => handleAddProduct()}
                onScanClick={handleScanButtonClick}
                onRefreshStock={handleRefreshStock}
                isLoading={isDbLoading}
                isScanning={isScanning}
                isRefreshingStock={isRefreshingStock}
                inputRef={barcodeInputRef}
            />
           <CountingListTable
                countingList={countingList}
                warehouseName={getWarehouseName(currentWarehouseId)}
                isLoading={isDbLoading}
                onDeleteRequest={handleDeleteRequest}
                onOpenStockDialog={handleOpenStockDialog}
                onOpenQuantityDialog={handleOpenQuantityDialog}
                onDecrement={handleDecrement}
                onIncrement={handleIncrement}
            />

          <div className="mt-4 flex justify-end items-center">
            <Button
                onClick={handleExport}
                 className="bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200"
                 disabled={countingList.length === 0 || isDbLoading}
                 aria-label="Exportar inventario actual a CSV"
             >
                  Exportar Inventario ({getWarehouseName(currentWarehouseId)})
             </Button>
          </div>
        </TabsContent>

         <TabsContent value="Base de Datos">
           <ProductDatabase />
         </TabsContent>

          <TabsContent value="Almacenes">
             <WarehouseManagement
                warehouses={warehouses}
                onAddWarehouse={handleAddWarehouse}
                onUpdateWarehouses={handleUpdateWarehouses}
              />
           </TabsContent>
      </Tabs>

            {/* Render Modify Dialogs */}
            {renderModifyDialog(openQuantityDialog, setOpenQuantityDialog, 'count', selectedProductForDialog)}
            {renderModifyDialog(openStockDialog, setOpenStockDialog, 'stock', selectedProductForDialog)}

            {/* Render Confirmation/Deletion Dialogs */}
            {renderConfirmationDialog()}
            {renderDeleteConfirmationDialog()}

            {/* Render Scanner View */}
            {renderScannerView()}
    </div>
  );
}
