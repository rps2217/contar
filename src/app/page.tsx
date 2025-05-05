

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
import { WarehouseManagement } from "@/components/warehouse-management";
import { format } from 'date-fns';
import { Minus, Plus, Trash, RefreshCw, Warehouse as WarehouseIcon, Camera, AlertCircle, Search, Check, AppWindow, Database, Boxes } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
// Import ZXing library for barcode scanning
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
// Update imports for new DB functions
import {
    addOrUpdateInventoryItem,
    getDisplayProductForWarehouse,
    addOrUpdateProductDetail,
    getInventoryItemsForWarehouse,
} from '@/lib/indexeddb-helpers';

const LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX = 'stockCounterPro_countingList_';
const LOCAL_STORAGE_WAREHOUSE_KEY = 'stockCounterPro_currentWarehouse';
const LOCAL_STORAGE_WAREHOUSES_KEY = 'stockCounterPro_warehouses';
const LOCAL_STORAGE_ACTIVE_SECTION_KEY = 'stockCounterPro_activeSection'; // Key for active section
const LOCAL_STORAGE_GOOGLE_SHEET_URL_KEY = 'stockCounterPro_googleSheetUrl'; // Key for google sheet url

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
           pattern="\d*"
           inputMode="numeric"
           placeholder="Escanear o ingresar código de barras"
           value={barcode}
           onChange={(e) => {
               const numericValue = e.target.value.replace(/\D/g, '');
               setBarcode(numericValue);
           }}
           className="mr-2 flex-grow bg-yellow-100 dark:bg-yellow-900 border-teal-300 dark:border-teal-700 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm"
           ref={inputRef}
           onKeyDown={handleKeyDown}
           aria-label="Código de barras"
           disabled={isLoading}
         />
         <Button
            onClick={onScanClick}
            variant="outline"
            size="icon"
            className={cn(
               "text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
            )}
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
  tableHeightClass?: string; // Allow custom height
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
  tableHeightClass = "h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]" // Restore default height
}) => {
  return (
    <ScrollArea className={cn(tableHeightClass, "border rounded-lg shadow-sm bg-white dark:bg-gray-800")}>
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
                      {product.lastUpdated ? format(new Date(product.lastUpdated), 'PPpp') : 'N/A'}
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
             {countingList.length === 0 && !isLoading && (
               <TableRow>
                 <TableCell colSpan={7} className="text-center px-4 py-10 text-gray-500 dark:text-gray-400">
                   No hay productos en este inventario. Escanea un código de barras para empezar.
                 </TableCell>
               </TableRow>
             )}
             {isLoading && (
                 <TableRow>
                     <TableCell colSpan={7} className="text-center px-4 py-10 text-gray-500 dark:text-gray-400">
                         Cargando datos del almacén...
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
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string>('');
  const [countingList, setCountingList] = useState<DisplayProduct[]>([]); // Products in the current count session for the selected warehouse
  const [searchTerm, setSearchTerm] = useState(""); // State for the search term
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null); // Ref for the video element
  const [openQuantityDialog, setOpenQuantityDialog] = useState(false);
  const [openStockDialog, setOpenStockDialog] = useState(false);
  const [selectedProductForDialog, setSelectedProductForDialog] = useState<DisplayProduct | null>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'increment' | 'decrement' | 'set' | null>(null); // Added 'set'
  const [confirmProductBarcode, setConfirmProductBarcode] = useState<string | null>(null);
  const [confirmNewValue, setConfirmNewValue] = useState<number | null>(null); // Added to store the new value for confirmation
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<DisplayProduct | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true); // Loading state for initial data load for the warehouse
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);
  const [isScanning, setIsScanning] = useState(false); // State to control camera scanning modal
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null); // State for camera permission
  const scannerReaderRef = useRef<BrowserMultiFormatReader | null>(null); // Ref for the scanner reader instance
  const streamRef = useRef<MediaStream | null>(null); // Ref to hold the camera stream
  const [activeSection, setActiveSection] = useState<string>('Contador'); // Default section
  const [isEditingValueInDialog, setIsEditingValueInDialog] = useState(false); // State for inline editing in dialog
  const [editingValue, setEditingValue] = useState<string>(''); // State for the input value
  const valueInputRef = useRef<HTMLInputElement>(null); // Ref for the value input

  // Load initial warehouses and active section from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedWarehouses = localStorage.getItem(LOCAL_STORAGE_WAREHOUSES_KEY);
      const initialWarehouses = storedWarehouses ? JSON.parse(storedWarehouses) : [{ id: 'main', name: 'Almacén Principal' }];
      setWarehouses(initialWarehouses);

      const initialWarehouseId = localStorage.getItem(LOCAL_STORAGE_WAREHOUSE_KEY) || initialWarehouses[0]?.id || 'main';
      setCurrentWarehouseId(initialWarehouseId);

      const initialActiveSection = localStorage.getItem(LOCAL_STORAGE_ACTIVE_SECTION_KEY) || 'Contador';
      setActiveSection(initialActiveSection);
    } else {
      // Default values for server-side rendering or environments without localStorage
      setWarehouses([{ id: 'main', name: 'Almacén Principal' }]);
      setCurrentWarehouseId('main');
      setActiveSection('Contador');
    }
  }, []); // Run only once on mount

  const getLocalStorageKeyForWarehouse = (warehouseId: string) => {
    return `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouseId}`;
  };

  // Function to load data for the selected warehouse
  const loadWarehouseData = useCallback(async (warehouseId: string) => {
    if (!warehouseId) return; // Prevent loading if warehouseId is empty
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
                         typeof item.warehouseId === 'string' && // Ensure warehouseId is always present
                         typeof item.description === 'string' &&
                         typeof item.count === 'number' &&
                         typeof item.stock === 'number'
                     )) {
                         // Filter list to only contain items for the *current* warehouseId
                         loadedList = parsedList.filter(item => item.warehouseId === warehouseId);
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
  }, [toast, isScanning]); // Added isScanning dependency

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
            // Save only items relevant to the current warehouse
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

   // Save selected warehouse to localStorage
  useEffect(() => {
     if (typeof window !== 'undefined' && currentWarehouseId) {
        localStorage.setItem(LOCAL_STORAGE_WAREHOUSE_KEY, currentWarehouseId);
    }
  }, [currentWarehouseId]);

    // Save warehouses list to localStorage
    useEffect(() => {
        if (typeof window !== 'undefined' && warehouses.length > 0) {
            localStorage.setItem(LOCAL_STORAGE_WAREHOUSES_KEY, JSON.stringify(warehouses));
        }
    }, [warehouses]);


   // Save active section to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_ACTIVE_SECTION_KEY, activeSection);
    }
  }, [activeSection]);


   const getWarehouseName = useCallback((warehouseId: string) => {
        if (!warehouseId) return 'N/A';
        const warehouse = warehouses.find(w => w.id === warehouseId);
        return warehouse ? warehouse.name : `Almacén (${warehouseId})`;
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
             if (error.name === 'NotAllowedError') {
                 console.warn("AudioContext playback prevented by browser policy.");
             } else {
                 console.error("Error playing beep sound:", error);
             }
        }
    } else {
        console.warn("AudioContext not supported. Cannot play beep sound.");
    }
    return () => {};
  }, []);

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

    // Use functional update for setCountingList to ensure we have the latest state
    setCountingList(prevList => {
        const existingProductIndex = prevList.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

        if (existingProductIndex !== -1) {
            // Product exists, increment count
            const productToUpdate = prevList[existingProductIndex];
            const newCount = productToUpdate.count + 1;
            const updatedProductData: DisplayProduct = {
                ...productToUpdate,
                count: newCount,
                lastUpdated: new Date().toISOString(),
            };

            const updatedList = [...prevList];
            updatedList.splice(existingProductIndex, 1); // Remove old item
            updatedList.unshift(updatedProductData); // Add updated item to the beginning

            toast({
                title: "Cantidad aumentada",
                description: `${updatedProductData.description} cantidad aumentada a ${newCount}.`,
            });
            playBeep(880, 100);
            return updatedList; // Return the updated list

        } else {
            // Product not in list, add it (asynchronously handled outside state update)
            // For now, just return the previous list and handle the async part below
            return prevList;
        }
    });


     // Asynchronous part: fetch details if product was not found in the current list state
     const listSnapshot = countingList; // Take snapshot *before* async call
     const existingProductIndexSnapshot = listSnapshot.findIndex((p) => p.barcode === trimmedBarcode && p.warehouseId === currentWarehouseId);

    if (existingProductIndexSnapshot === -1) {
        try {
             const displayProduct = await getDisplayProductForWarehouse(trimmedBarcode, currentWarehouseId);

             if (displayProduct) {
                // Found in DB for this warehouse or details found with default inventory
                const newProductForList: DisplayProduct = {
                    ...displayProduct,
                    count: 1,
                    lastUpdated: new Date().toISOString(),
                 };
                 // Add the new product to the beginning using functional update
                  setCountingList(prev => [newProductForList, ...prev]);
                 toast({
                     title: "Producto agregado",
                     description: `${newProductForList.description} agregado al inventario (${getWarehouseName(currentWarehouseId)}).`,
                 });
                 playBeep(660, 150);
             } else {
                // Product detail not found in DB at all
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
                  // Add the unknown product to the beginning using functional update
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

 }, [barcode, countingList, currentWarehouseId, toast, playBeep, getWarehouseName]);


 // Modify product count or stock, handling confirmation dialog
 const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    let productToConfirm: DisplayProduct | null = null;
    let needsConfirmation = false;
    let originalValue = -1;
    let updatedProductDescription = '';
    const warehouseId = currentWarehouseId;
    let finalValue = 0; // Declare outside for scope

    setCountingList(prevList => {
        const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
        if (index === -1) return prevList;

        const updatedList = [...prevList];
        const product = updatedList[index];
        updatedProductDescription = product.description;


        if (type === 'count') {
            originalValue = product.count;
            finalValue = Math.max(0, product.count + change); // Ensure non-negative

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
                // No state update here, handled by confirmation dialog
                return prevList; // Return original list to wait for confirmation
            } else {
                updatedList[index] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
            }

        } else { // type === 'stock'
            originalValue = product.stock;
            finalValue = Math.max(0, product.stock + change); // Ensure non-negative
            updatedList[index] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
        }

        return updatedList;
    });

     // Update stock in IndexedDB if stock changed and no confirmation needed
     if (type === 'stock') {
         try {
             const currentProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
             const itemToUpdate: InventoryItem = {
                barcode: barcodeToUpdate,
                warehouseId: warehouseId,
                stock: finalValue, // Use the calculated finalValue
                count: currentProduct?.count ?? 0, // Keep current count
                lastUpdated: new Date().toISOString()
            };
             await addOrUpdateInventoryItem(itemToUpdate);
             toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${finalValue} en la base de datos.` });
         } catch (error) {
             console.error("Failed to update stock in DB:", error);
             toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
             // Revert stock change in state
             setCountingList(prevList => {
                const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                if (index === -1) return prevList;
                const revertedList = [...prevList];
                revertedList[index] = { ...revertedList[index], stock: originalValue }; // Revert to original value
                return revertedList;
             });
         }
    }

    // Handle confirmation dialog
    if (needsConfirmation && productToConfirm && type === 'count') {
        setConfirmProductBarcode(productToConfirm.barcode);
        setConfirmAction(change > 0 ? 'increment' : 'decrement');
        // Use the calculated finalValue for the confirmation dialog description
        const potentialNewCount = Math.max(0, productToConfirm.count + change);
        setConfirmNewValue(potentialNewCount); // Store potential new value
        setIsConfirmDialogOpen(true);
    } else if (type === 'count' && !needsConfirmation) {
         // Toast for non-confirmed count changes (using the updated finalValue)
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) cambiada a ${finalValue}.` });
    }

 }, [countingList, currentWarehouseId, toast, getWarehouseName]);


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
     let finalValue = 0; // Declare outside for scope

     setCountingList(prevList => {
         const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
         if (index === -1) return prevList;

         const updatedList = [...prevList];
         const product = updatedList[index];
         updatedProductDescription = product.description;


         if (type === 'count') {
             originalValue = product.count;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
             finalValue = Math.max(0, finalValue); // Ensure non-negative

             // Confirmation logic
             if (product.stock !== 0 && finalValue === product.stock && originalValue !== product.stock) {
                 needsConfirmation = true;
                 productToConfirm = { ...product };
             }

             if (needsConfirmation) {
                return prevList; // Return original list to wait for confirmation
             } else {
                 updatedList[index] = { ...product, count: finalValue, lastUpdated: new Date().toISOString() };
             }
         } else { // type === 'stock'
             originalValue = product.stock;
             finalValue = sumValue ? (originalValue + newValue) : newValue;
             finalValue = Math.max(0, finalValue); // Ensure non-negative
             updatedList[index] = { ...product, stock: finalValue, lastUpdated: new Date().toISOString() };
         }
         return updatedList;
     });

     // Update stock in IndexedDB if stock changed
     if (type === 'stock') {
         try {
              const currentProduct = countingList.find(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
              const itemToUpdate: InventoryItem = {
                 barcode: barcodeToUpdate,
                 warehouseId: warehouseId,
                 stock: finalValue, // Use finalValue
                 count: currentProduct?.count ?? 0, // Keep current count
                 lastUpdated: new Date().toISOString()
             };
             await addOrUpdateInventoryItem(itemToUpdate);
             toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) actualizado a ${finalValue} en la base de datos.` });
         } catch (error) {
             console.error("Failed to update stock in DB:", error);
             toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
             // Revert stock change in state
             setCountingList(prevList => {
                 const index = prevList.findIndex(p => p.barcode === barcodeToUpdate && p.warehouseId === warehouseId);
                 if (index === -1) return prevList;
                 const revertedList = [...prevList];
                 revertedList[index] = { ...revertedList[index], stock: originalValue };
                 return revertedList;
             });
         }
     }

     // Handle confirmation dialog
     if (needsConfirmation && productToConfirm && type === 'count') {
         setConfirmProductBarcode(productToConfirm.barcode);
         setConfirmAction('set');
         setConfirmNewValue(finalValue); // Store the calculated final value
         setIsConfirmDialogOpen(true);
     } else if (type === 'count' && !needsConfirmation) {
         const actionText = sumValue ? "sumada a" : "establecida en";
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} (${getWarehouseName(warehouseId)}) ${actionText} ${finalValue}.` });
     }

     setIsEditingValueInDialog(false);

 }, [countingList, currentWarehouseId, toast, getWarehouseName]);


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

    if (confirmProductBarcode && confirmAction !== null) {
        setCountingList(prevList => {
            const index = prevList.findIndex(p => p.barcode === confirmProductBarcode && p.warehouseId === warehouseId);
            if (index === -1) return prevList;

            const updatedList = [...prevList];
            const product = updatedList[index];
            descriptionForToast = product.description;

            // Use confirmNewValue which was calculated earlier
            finalConfirmedCount = confirmNewValue !== null ? Math.max(0, confirmNewValue) : 0;

            updatedList[index] = {
                ...product,
                count: finalConfirmedCount,
                lastUpdated: new Date().toISOString()
            };
            return updatedList;
        });
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${descriptionForToast} (${getWarehouseName(warehouseId)}) cambiada a ${finalConfirmedCount}.` });
    } else {
        console.warn("Confirmation attempted with invalid state:", { confirmProductBarcode, confirmAction, confirmNewValue });
    }
    // Reset confirmation state
    setIsConfirmDialogOpen(false);
    setConfirmProductBarcode(null);
    setConfirmAction(null);
    setConfirmNewValue(null);
}, [currentWarehouseId, confirmProductBarcode, confirmAction, toast, getWarehouseName, confirmNewValue]);


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
 }, [currentWarehouseId, toast, getWarehouseName]);


    // --- Dialog Openers ---
    const handleOpenQuantityDialog = useCallback((product: DisplayProduct) => {
        setSelectedProductForDialog(product);
        setOpenQuantityDialog(true);
        setIsEditingValueInDialog(false);
    }, []);

    const handleOpenStockDialog = useCallback((product: DisplayProduct) => {
        setSelectedProductForDialog(product);
        setOpenStockDialog(true);
        setIsEditingValueInDialog(false);
    }, []);

    const handleCloseDialogs = () => {
        setOpenQuantityDialog(false);
        setOpenStockDialog(false);
        setSelectedProductForDialog(null);
        setIsEditingValueInDialog(false);
    };

     // --- Warehouse Selection ---
    const handleWarehouseChange = (newWarehouseId: string) => {
        if (newWarehouseId !== currentWarehouseId) {
            console.log("Switching warehouse to:", newWarehouseId);
            setCurrentWarehouseId(newWarehouseId);
            // No need to call loadWarehouseData here, the useEffect watching currentWarehouseId will handle it
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
            // Optionally, switch to the new warehouse immediately
            // setCurrentWarehouseId(newWarehouse.id);
            return updatedWarehouses;
        });
    };

    const handleUpdateWarehouses = (updatedWarehouses: { id: string; name: string }[]) => {
        setWarehouses(updatedWarehouses);
        // If the current warehouse was deleted, switch to 'main' or the first available one
        if (!updatedWarehouses.some(w => w.id === currentWarehouseId)) {
            setCurrentWarehouseId(updatedWarehouses[0]?.id || 'main');
        }
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
            scannerReaderRef.current.reset();
        }
    }, []);

    // Effect to request camera permission and set up video stream/scanning
    useEffect(() => {
        let reader: BrowserMultiFormatReader | null = null;
        let cancelled = false;
        let timeoutId: NodeJS.Timeout | null = null;

        const initScanner = async () => {
             if (!isScanning || cancelled) {
                 stopCameraStream();
                 return;
             }

             if (!videoRef.current) {
                 console.error("Video element ref is not available.");
                 // Retry after a short delay if component is still mounted and scanning
                 if (!cancelled) {
                      timeoutId = setTimeout(initScanner, 100);
                 }
                 return;
             }
             const currentVideoRef = videoRef.current;

             if (!scannerReaderRef.current) {
                 scannerReaderRef.current = new BrowserMultiFormatReader();
                 console.log("ZXing BrowserMultiFormatReader initialized.");
             }
             reader = scannerReaderRef.current;

            try {
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

                currentVideoRef.srcObject = stream;
                // Wait for metadata to load before playing
                await new Promise<void>((resolve, reject) => {
                    currentVideoRef.onloadedmetadata = () => resolve();
                    currentVideoRef.onerror = (e) => reject(new Error(`Video metadata error: ${e}`));
                });


                if (cancelled) return; // Check again after await

                 await currentVideoRef.play(); // Play the video stream

                 if (cancelled) return; // Check again after await
                 console.log("Video stream attached and playing.");

                 if (reader) {
                     console.log("Starting barcode decoding from video device...");
                      reader.decodeFromVideoDevice(undefined, currentVideoRef, (result, err) => {
                         if (cancelled) return;

                         if (result) {
                             console.log('Barcode detected:', result.getText());
                             const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, ''); // Clean barcode
                             setIsScanning(false); // Close modal on successful scan
                             playBeep(900, 80);
                             requestAnimationFrame(() => {
                                 setBarcode(detectedBarcode);
                                 handleAddProduct(detectedBarcode);
                             });
                         }
                         if (err && !(err instanceof NotFoundException)) {
                             console.error('Scanning error:', err);
                             // Consider adding non-intrusive UI feedback for scanning errors
                         }
                      }).catch(decodeErr => {
                           if (!cancelled) {
                              console.error("Error starting decodeFromVideoDevice:", decodeErr);
                              toast({ variant: "destructive", title: "Error de Escaneo", description: "No se pudo iniciar la decodificación del código de barras."});
                              stopCameraStream();
                              setIsScanning(false);
                           }
                      });
                     console.log("Barcode decoding started.");
                 } else {
                     if (cancelled) return;
                     console.error("Scanner reader was not initialized.");
                     stopCameraStream();
                     setIsScanning(false);
                     toast({ variant: "destructive", title: "Error de escáner", description: "No se pudo inicializar el lector de códigos."});
                 }

            } catch (error: any) {
                if (cancelled) return;

                console.error('Error accessing camera or starting scanner:', error);
                setHasCameraPermission(false);
                toast({
                    variant: 'destructive',
                    title: 'Acceso a Cámara Denegado',
                    description: `Por favor, habilita los permisos de cámara. Error: ${error.name || error.message}`,
                    duration: 9000
                });
                stopCameraStream();
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

        return () => {
            console.log("Cleaning up camera effect...");
            cancelled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            stopCameraStream();
        };
     // eslint-disable-next-line react-hooks/exhaustive-deps
     }, [isScanning, toast, playBeep, handleAddProduct, stopCameraStream]);


    // Handler to start scanning (open modal)
    const handleScanButtonClick = () => {
        console.log("Scan button clicked, setting isScanning to true.");
        setHasCameraPermission(null); // Reset permission status before starting
        setIsScanning(true);
    };

    // Handler to stop scanning (close modal)
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

        const handleValueClick = () => {
            setEditingValue(currentValue.toString());
            setIsEditingValueInDialog(true);
            requestAnimationFrame(() => {
                valueInputRef.current?.focus();
                valueInputRef.current?.select();
            });
        };

        const handleValueSubmit = (e: React.FormEvent | null, sumValue: boolean = false) => {
            if (e) e.preventDefault();
            const valueToProcess = parseInt(editingValue, 10);
            if (!isNaN(valueToProcess)) {
                handleSetProductValue(product.barcode, type, valueToProcess, sumValue);
            } else {
                toast({ variant: "destructive", title: "Entrada Inválida", description: "Por favor, ingrese un número válido." });
            }
             setEditingValue('');
            setIsEditingValueInDialog(false);
        };

         const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditingValue(e.target.value.replace(/\D/g, ''));
        };

         const handleInputBlur = () => {
             // Simplified blur handling
             setTimeout(() => {
                 if (document.activeElement !== valueInputRef.current) {
                    setIsEditingValueInDialog(false);
                    setEditingValue('');
                }
             }, 150);
         };

         const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
             if (e.key === 'Enter') {
                  e.preventDefault();
                 handleValueSubmit(null, e.shiftKey);
             } else if (e.key === 'Escape') {
                 setIsEditingValueInDialog(false);
                 setEditingValue('');
             }
         };

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
                                 disabled={isEditingValueInDialog}
                             >
                                 <Minus className="h-8 w-8 sm:h-10 sm:w-10" />
                             </Button>
                             {isEditingValueInDialog ? (
                                <form onSubmit={(e) => handleValueSubmit(e, false)} className="flex-grow mx-2 sm:mx-4 relative">
                                    <Input
                                        ref={valueInputRef}
                                        type="number"
                                         pattern="\d*"
                                        inputMode="numeric"
                                        value={editingValue}
                                        onChange={handleInputChange}
                                        onBlur={handleInputBlur}
                                        onKeyDown={handleInputKeyDown}
                                         className="text-5xl sm:text-6xl font-bold text-center w-full h-full p-0 border-2 border-blue-500 dark:bg-gray-800 dark:text-gray-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-md"
                                        aria-label="Editar valor"
                                        autoFocus
                                    />
                                     <div className="absolute -bottom-14 left-0 right-0 flex justify-center gap-2 mt-2">
                                         <Button
                                             type="submit"
                                             size="sm"
                                             variant="outline"
                                             className="bg-green-100 dark:bg-green-900 border-green-500 hover:bg-green-200 dark:hover:bg-green-800 text-green-700 dark:text-green-300"
                                             title="Guardar (Reemplazar)"
                                             onMouseDown={(e) => e.preventDefault()}
                                         >
                                             <Check className="h-4 w-4 mr-1" /> Guardar
                                         </Button>
                                         <Button
                                             type="button"
                                             size="sm"
                                             variant="outline"
                                              className="bg-blue-100 dark:bg-blue-900 border-blue-500 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300"
                                             onClick={() => handleValueSubmit(null, true)}
                                             title="Sumar a la cantidad actual (Shift+Enter)"
                                              onMouseDown={(e) => e.preventDefault()}
                                         >
                                              <Plus className="h-4 w-4 mr-1" /> Sumar
                                         </Button>
                                     </div>
                                </form>
                            ) : (
                                <div
                                    className="text-5xl sm:text-6xl font-bold mx-4 sm:mx-6 text-gray-800 dark:text-gray-100 tabular-nums select-none cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                                    onClick={handleValueClick}
                                    title={`Click para editar ${type}`}
                                >
                                    {currentValue}
                                </div>
                            )}
                             <Button
                                 size="lg"
                                 className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
                                 onClick={() => handleIncrement(product.barcode, type)}
                                 aria-label={`Aumentar ${type}`}
                                  disabled={isEditingValueInDialog}
                             >
                                 <Plus className="h-8 w-8 sm:h-10 sm:w-10" />
                             </Button>
                         </div>
                     </div>
                    <DialogFooter className="mt-16 sm:mt-4">
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
                   {confirmAction === 'set'
                       ? `La cantidad contada ahora coincide con el stock (${countingList.find(p => p.barcode === confirmProductBarcode)?.stock}). ¿Estás seguro de que deseas establecer la cantidad en ${confirmNewValue ?? 'este valor'}?`
                       : `La cantidad contada ${confirmAction === 'increment' ? 'alcanzará' : 'dejará de coincidir con'} el stock (${countingList.find(p => p.barcode === confirmProductBarcode)?.stock}). ¿Estás seguro de que deseas ${confirmAction === 'increment' ? 'aumentar' : 'disminuir'} la cantidad a ${confirmNewValue ?? 'este valor'}?`
                   }
               </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
               <AlertDialogCancel onClick={() => { setIsConfirmDialogOpen(false); setConfirmProductBarcode(null); setConfirmAction(null); setConfirmNewValue(null); }}>Cancelar</AlertDialogCancel>
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
       <Dialog open={isScanning} onOpenChange={(open) => { if (!open) { handleStopScanning(); } else { setIsScanning(true); } }}>
           <DialogContent className="max-w-md w-full p-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
               <DialogHeader>
                   <DialogTitle className="text-center text-lg font-semibold text-gray-800 dark:text-gray-200">Escanear Código de Barras</DialogTitle>
                   <DialogDescription className="text-center text-sm text-gray-600 dark:text-gray-400">
                       Apunta la cámara al código de barras.
                   </DialogDescription>
               </DialogHeader>
                <div className="my-4 relative aspect-video">
                    {/* Video element always rendered to prevent ref issues */}
                    <video ref={videoRef} className={cn("w-full aspect-video rounded-md bg-black")} autoPlay muted playsInline />
                    {/* Overlay elements */}
                    {isScanning && (
                        <div className={cn("absolute inset-0 flex items-center justify-center pointer-events-none")}>
                            <div className="w-3/4 h-1/2 border-2 border-red-500 rounded-md opacity-75"></div>
                        </div>
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
                     {!isScanning && hasCameraPermission === null && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">Iniciando cámara...</div>
                     )}
                </div>
               <DialogFooter className="mt-4">
                   <Button variant="outline" onClick={handleStopScanning}>Cancelar</Button>
               </DialogFooter>
           </DialogContent>
       </Dialog>
   );

 // --- Count by Provider ---
 const handleStartCountByProvider = useCallback(async (productsToCount: DisplayProduct[]) => {
    if (!productsToCount || productsToCount.length === 0) {
        toast({ title: "Vacío", description: "No hay productos para este proveedor en el almacén actual." });
        return;
    }
    // Replace current counting list with the new list for the provider
    setCountingList(productsToCount);
    setActiveSection("Contador"); // Switch to the counting tab
    toast({ title: "Conteo por Proveedor Iniciado", description: `Cargados ${productsToCount.length} productos.` });
 }, [toast]);

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
                          <SelectTrigger className="w-[180px] sm:w-[200px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
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
                    <SelectTrigger className="w-full sm:w-auto md:w-[200px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
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
                    isLoading={isDbLoading}
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
                        className="pl-8 w-full bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600" // Changed background color here
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
            {renderModifyDialog(openQuantityDialog, setOpenQuantityDialog, 'count', selectedProductForDialog)}
            {renderModifyDialog(openStockDialog, setOpenStockDialog, 'stock', selectedProductForDialog)}

            {/* Render Confirmation/Deletion Dialogs */}
            {renderConfirmationDialog()}
            {renderDeleteConfirmationDialog()}

            {/* Render Scanner Modal */}
            {renderScannerView()}

    </div>
  );
}

