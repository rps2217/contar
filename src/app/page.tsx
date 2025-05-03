
"use client";

import type { Product } from '@/types/product'; // Import Product type
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils"; // Import cn if needed, otherwise remove
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProductDatabase } from "@/components/product-database";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from 'date-fns';
import { Minus, Plus, Trash, RefreshCw } from "lucide-react"; // Added RefreshCw icon
import React, { useCallback, useEffect, useRef, useState } from "react"; // Import React
import { updateProductInDB, getAllProductsFromDB } from '@/lib/indexeddb-helpers'; // Import DB helpers

const LOCAL_STORAGE_COUNTING_LIST_KEY = 'stockCounterPro_countingList';

export default function Home() {
  const [barcode, setBarcode] = useState("");
  const [products, setProducts] = useState<Product[]>([]); // State for counting list
  const [databaseProducts, setDatabaseProducts] = useState<Product[]>([]); // State for DB products (managed here)
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [openQuantityDialog, setOpenQuantityDialog] = useState(false);
  const [openStockDialog, setOpenStockDialog] = useState(false);
  const [selectedProductForDialog, setSelectedProductForDialog] = useState<Product | null>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'increment' | 'decrement' | null>(null);
  const [confirmProductBarcode, setConfirmProductBarcode] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true); // Loading state for initial DB load
  const [isRefreshingStock, setIsRefreshingStock] = useState(false); // State for stock refresh loading

  // Load database products from IndexedDB on initial mount
  useEffect(() => {
    const loadDb = async () => {
      setIsDbLoading(true); // Start loading
      console.log("page.tsx: Loading initial data from IndexedDB...");
      try {
        const dbProducts = await getAllProductsFromDB();
        setDatabaseProducts(dbProducts);
        console.log("page.tsx: Loaded initial data:", dbProducts.length, "items");
      } catch (error) {
        console.error("page.tsx: Failed to load database products:", error);
        toast({
          variant: "destructive",
          title: "Error de Base de Datos",
          description: "No se pudieron cargar los productos de la base de datos local.",
          duration: 9000,
        });
        setDatabaseProducts([]); // Ensure it's an empty array on error
      } finally {
        setIsDbLoading(false); // Finish loading
         barcodeInputRef.current?.focus(); // Focus after loading attempt
      }
    };
    loadDb();
  }, [toast]); // Dependency array includes toast

  // Load counting list from localStorage on initial mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedList = localStorage.getItem(LOCAL_STORAGE_COUNTING_LIST_KEY);
        if (savedList) {
          const parsedList = JSON.parse(savedList);
          if (Array.isArray(parsedList)) {
             // Basic validation for structure (optional but recommended)
             const isValid = parsedList.every(item =>
                typeof item === 'object' && item !== null &&
                typeof item.barcode === 'string' &&
                typeof item.description === 'string' &&
                typeof item.count === 'number'
             );
             if (isValid) {
                setProducts(parsedList);
                console.log("Loaded counting list from localStorage:", parsedList.length, "items");
             } else {
                 console.warn("Invalid data found in localStorage for counting list. Clearing.");
                 localStorage.removeItem(LOCAL_STORAGE_COUNTING_LIST_KEY);
             }
          }
        }
      } catch (error) {
        console.error("Failed to load counting list from localStorage:", error);
        // Optionally clear corrupted data
        localStorage.removeItem(LOCAL_STORAGE_COUNTING_LIST_KEY);
      }
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  // Save counting list to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(LOCAL_STORAGE_COUNTING_LIST_KEY, JSON.stringify(products));
      } catch (error) {
        console.error("Failed to save counting list to localStorage:", error);
        toast({
            variant: "destructive",
            title: "Error de Almacenamiento Local",
            description: "No se pudo guardar el estado del inventario actual.",
            duration: 5000,
        });
      }
    }
  }, [products, toast]); // Runs whenever the products state changes


  // Function to play a beep sound
  const playBeep = useCallback(() => {
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        try {
             const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
             const oscillator = audioCtx.createOscillator();
             const gainNode = audioCtx.createGain();

             oscillator.type = 'sine';
             oscillator.frequency.setValueAtTime(660, audioCtx.currentTime);
             gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
             gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

             oscillator.connect(gainNode);
             gainNode.connect(audioCtx.destination);

             oscillator.start(audioCtx.currentTime);
             oscillator.stop(audioCtx.currentTime + 0.15);

             setTimeout(() => {
                audioCtx.close().catch(err => console.warn("Error closing AudioContext:", err));
            }, 200);

        } catch (error) {
             console.error("Error playing beep sound:", error);
        }

    } else {
        console.warn("AudioContext not supported in this browser. Cannot play beep sound.");
    }
  }, []);

 // Handles adding or incrementing a product in the counting list
 const handleAddProduct = useCallback(async () => {
    const currentBarcode = barcode.trim();

    if (!currentBarcode) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un código de barras válido.",
      });
      setBarcode("");
      barcodeInputRef.current?.focus();
      return;
    }

    const existingProductIndex = products.findIndex((p) => p.barcode === currentBarcode);

    if (existingProductIndex !== -1) {
      const productToUpdate = products[existingProductIndex];
      const newCount = productToUpdate.count + 1;
      const descriptionForToast = productToUpdate.description;

      setProducts(prevProducts => {
        const updatedProducts = [...prevProducts];
        const internalIndex = updatedProducts.findIndex(p => p.barcode === currentBarcode);
        if (internalIndex === -1) return prevProducts;

        const productDataToUpdate = updatedProducts[internalIndex];
        const updatedProductData = {
          ...productDataToUpdate,
          count: productDataToUpdate.count + 1,
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };
        updatedProducts.splice(internalIndex, 1);
        updatedProducts.unshift(updatedProductData);
        return updatedProducts;
      });
      toast({
        title: "Cantidad aumentada",
        description: `${descriptionForToast} cantidad aumentada a ${newCount}.`,
      });

    } else {
      const productFromDb = databaseProducts.find((p) => p.barcode === currentBarcode);

      if (productFromDb) {
        const newProductForList: Product = {
          ...productFromDb,
          count: 1,
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };
        setProducts(prevProducts => [newProductForList, ...prevProducts]);
        toast({
          title: "Producto agregado",
          description: `${newProductForList.description} agregado al inventario.`,
        });
      } else {
        playBeep();
        const newProductData: Product = {
          barcode: currentBarcode,
          description: `Producto desconocido ${currentBarcode}`,
          provider: "Desconocido",
          stock: 0,
          count: 1,
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };

        setProducts(prevProducts => [newProductData, ...prevProducts]);

        toast({
          variant: "destructive",
          title: "Producto desconocido",
          description: `Producto ${currentBarcode} no encontrado en la base de datos. Agregado al inventario.`,
          duration: 5000,
        });
      }
    }

    setBarcode("");
    requestAnimationFrame(() => {
        barcodeInputRef.current?.focus();
    });

  }, [barcode, products, databaseProducts, toast, playBeep]);


  // --- Quantity/Stock Modification Callbacks ---

  const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    let productToConfirm: Product | null = null;
    let needsConfirmation = false;
    let originalCount = -1;
    let updatedProductDescription = '';

    // Optimistic UI update for counting list state
    setProducts(prevProducts => {
        const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
        if (index === -1) return prevProducts; // Product not found

        const updatedProducts = [...prevProducts];
        const product = updatedProducts[index];
        originalCount = product.count;
        updatedProductDescription = product.description;
        let finalValue;

        if (type === 'count') {
            finalValue = product.count + change;
            if (finalValue < 0) finalValue = 0;

            // Check if confirmation is needed (only when count matches non-zero stock)
            if (product.stock !== 0) {
                const changingToMatch = change > 0 && finalValue === product.stock;
                const changingFromMatch = change < 0 && product.count === product.stock;
                if (changingToMatch || changingFromMatch) {
                    productToConfirm = { ...product };
                    needsConfirmation = true;
                }
            }
            if (needsConfirmation) {
                console.log("Confirmation needed for", product.barcode);
                 updatedProducts[index] = { ...product };

            } else {
                updatedProducts[index] = { ...product, count: finalValue, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
            }

        } else { // type === 'stock'
            finalValue = product.stock + change;
             if (finalValue < 0) finalValue = 0;
            updatedProducts[index] = { ...product, stock: finalValue, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
        }

        return updatedProducts;
    });

     // Update stock in IndexedDB *after* state update if stock changed
    if (type === 'stock') {
       const productInDb = databaseProducts.find(p => p.barcode === barcodeToUpdate);

       if (productInDb) {
           const newStock = productInDb.stock + change;
           if (newStock >= 0) {
                try {
                    const productToUpdateInDB: Product = {
                         ...productInDb,
                         stock: newStock,
                         lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
                     };
                    await updateProductInDB(productToUpdateInDB);

                    // Also update the databaseProducts state for consistency across tabs
                    setDatabaseProducts(prevDbProducts =>
                        prevDbProducts.map(dbP =>
                            dbP.barcode === barcodeToUpdate ? productToUpdateInDB : dbP
                        )
                    );
                    toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} actualizado a ${newStock} en la base de datos.` });
                } catch (error) {
                    console.error("Failed to update stock in DB:", error);
                    toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
                    // Revert stock change in `products` state if DB update failed
                     setProducts(prevProducts => {
                         const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
                         if (index === -1) return prevProducts;
                         const revertedProducts = [...prevProducts];
                         revertedProducts[index] = { ...revertedProducts[index], stock: productInDb.stock };
                         return revertedProducts;
                     });
                    // Revert change in databaseProducts state
                     setDatabaseProducts(prevDbProducts =>
                        prevDbProducts.map(dbP =>
                            dbP.barcode === barcodeToUpdate ? productInDb : dbP // Revert to original DB product
                        )
                    );
                }
           } else {
                toast({ variant: "destructive", title: "Stock Inválido", description: "El stock no puede ser negativo." });
                 // Revert the optimistic UI update in 'products' state as well
                 setProducts(prevProducts => {
                    const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
                    if (index === -1) return prevProducts;
                    const revertedProducts = [...prevProducts];
                    revertedProducts[index] = { ...revertedProducts[index], stock: productInDb.stock }; // Revert to original DB stock
                    return revertedProducts;
                 });
           }
       } else {
            console.warn("Attempted to update stock for a product not found in DB state:", barcodeToUpdate);
            toast({ variant: "destructive", title: "Error", description: "No se encontró el producto en la base de datos para actualizar el stock." });
             // Revert optimistic UI update in products state
             setProducts(prevProducts => {
                 const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
                 if (index === -1) return prevProducts;
                 const productInList = prevProducts[index];
                 const originalListStock = productInList.stock - change;
                 const revertedProducts = [...prevProducts];
                 revertedProducts[index] = { ...productInList, stock: originalListStock < 0 ? 0 : originalListStock };
                 return revertedProducts;
             });
       }
    }

    // Handle confirmation dialog outside of state update
    if (needsConfirmation && productToConfirm && type === 'count') {
        console.log("Setting up confirmation dialog for:", productToConfirm.barcode);
        setConfirmProductBarcode(productToConfirm.barcode);
        setConfirmAction(change > 0 ? 'increment' : 'decrement');
        setIsConfirmDialogOpen(true);
    } else if (type === 'count' && !needsConfirmation) {
         const finalCountValue = originalCount + change;
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} cambiada a ${finalCountValue < 0 ? 0 : finalCountValue}.` });
    }

  }, [products, databaseProducts, setDatabaseProducts, toast]);

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

    if (confirmProductBarcode && confirmAction) {
      const change = confirmAction === 'increment' ? 1 : -1;
         setProducts(prevProducts => {
             const index = prevProducts.findIndex(p => p.barcode === confirmProductBarcode);
             if (index === -1) return prevProducts;

             const updatedProducts = [...prevProducts];
             const product = updatedProducts[index];
             descriptionForToast = product.description;
             newCount = product.count + change;
             updatedProducts[index] = {
                 ...product,
                 count: newCount < 0 ? 0 : newCount,
                 lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
             };
             return updatedProducts;
         });
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${descriptionForToast} cambiada a ${newCount}.` });
    }
    setIsConfirmDialogOpen(false);
    setConfirmProductBarcode(null);
    setConfirmAction(null);
  }, [confirmProductBarcode, confirmAction, toast]);

  // --- Deletion Handlers ---

  const handleDeleteRequest = useCallback((product: Product) => {
        setProductToDelete(product);
        setIsDeleteDialogOpen(true);
    }, []);

    const confirmDelete = useCallback(() => {
        if (productToDelete) {
            const descriptionForToast = productToDelete.description;
            setProducts(prevProducts => prevProducts.filter(p => p.barcode !== productToDelete.barcode));
            toast({
                title: "Producto eliminado",
                description: `${descriptionForToast} ha sido eliminado del inventario actual.`,
                variant: "default"
            });
        }
        setIsDeleteDialogOpen(false);
        setProductToDelete(null);
    }, [productToDelete, toast]);


    // --- Export Functionality ---
    const handleExport = useCallback(() => {
        if (products.length === 0) {
            toast({ title: "Vacío", description: "No hay productos en el inventario para exportar." });
            return;
        }
        try {
            const csvData = convertToCSV(products);
            const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
            link.setAttribute("download", `inventory_count_${timestamp}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
             URL.revokeObjectURL(link.href);
            toast({ title: "Exportado", description: "Inventario exportado a CSV." });
        } catch (error) {
            console.error("Error exporting inventory:", error);
            toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
        }
    }, [products, toast]);

  // Converts an array of Product objects to a CSV string
  const convertToCSV = (data: Product[]) => {
    const headers = ["Barcode", "Description", "Provider", "Stock", "Count", "Last Updated"];
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
      product.stock ?? 0,
      product.count ?? 0,
      product.lastUpdated ? safeQuote(format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss')) : '""',
    ]);

    return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
  };

  // --- Event Handlers ---
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
       e.preventDefault();
       handleAddProduct();
    }
  };

  // --- Stock Refresh Functionality ---
  const handleRefreshStock = useCallback(async () => {
    setIsRefreshingStock(true);
    console.log("Refreshing stock counts from database...");
    try {
      const currentDbProducts = await getAllProductsFromDB();
      setDatabaseProducts(currentDbProducts); // Update the local DB state first

      // Now update the stock counts in the counting list (products state)
      setProducts(prevCountingProducts => {
        return prevCountingProducts.map(countingProduct => {
          const dbProduct = currentDbProducts.find(dbP => dbP.barcode === countingProduct.barcode);
          // If found in DB, update stock. Otherwise, keep current stock (or maybe set to 0?)
          return dbProduct
            ? { ...countingProduct, stock: dbProduct.stock, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') }
            : countingProduct; // Or: { ...countingProduct, stock: 0, lastUpdated: ... } if unknown should have 0 stock
        });
      });

      toast({ title: "Stock Actualizado", description: "Los stocks de los productos en el inventario han sido actualizados desde la base de datos." });
      console.log("Stock counts refreshed.");

    } catch (error) {
      console.error("Error refreshing stock counts:", error);
      toast({ variant: "destructive", title: "Error al Actualizar Stock", description: "No se pudieron actualizar los stocks desde la base de datos." });
    } finally {
      setIsRefreshingStock(false);
    }
  }, [toast]);

    // --- Dialog Openers ---
    const handleOpenQuantityDialog = useCallback((product: Product) => {
        setSelectedProductForDialog(product);
        setOpenQuantityDialog(true);
    }, []);

    const handleOpenStockDialog = useCallback((product: Product) => {
        setSelectedProductForDialog(product);
        setOpenStockDialog(true);
    }, []);

    const handleCloseDialogs = () => {
        setOpenQuantityDialog(false);
        setOpenStockDialog(false);
        setSelectedProductForDialog(null);
    };

    // --- Dialog Renderers ---
    const renderQuantityDialog = () => {
       const product = selectedProductForDialog;
       if (!product) return null;
       const currentCount = products.find(p => p.barcode === product.barcode)?.count ?? product.count ?? 0;

       return (
            <Dialog open={openQuantityDialog} onOpenChange={(isOpen) => { if (!isOpen) handleCloseDialogs(); else setOpenQuantityDialog(true); }}>
                <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                            <span className="flex items-center justify-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-boxes h-6 w-6 text-teal-600"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l-7 4A2 2 0 0 0 21 16Z"/><path d="m3.3 8 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                                Ajustar Cantidad ({product.description})
                            </span>
                        </DialogTitle>
                        <DialogDescription className="text-center text-gray-600 mt-1">
                            Ajuste la cantidad contada manualmente.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-6">
                        <div className="flex justify-around items-center">
                            <Button
                                size="lg"
                                className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
                                onClick={() => handleDecrement(product.barcode, 'count')}
                                aria-label="Disminuir cantidad"
                            >
                                <Minus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>

                            <div className="text-5xl sm:text-6xl font-bold mx-4 sm:mx-6 text-gray-800 tabular-nums select-none">
                                {currentCount}
                            </div>

                            <Button
                                size="lg"
                                className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
                                onClick={() => handleIncrement(product.barcode, 'count')}
                                aria-label="Aumentar cantidad"
                            >
                                <Plus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="mt-4">
                        <DialogClose asChild>
                            <Button type="button" variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-100" onClick={handleCloseDialogs}>
                                Cerrar
                            </Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    const renderStockDialog = () => {
        const product = selectedProductForDialog;
        if (!product) return null;
        const currentStock = products.find(p => p.barcode === product.barcode)?.stock ?? product.stock ?? 0;

        return (
             <Dialog open={openStockDialog} onOpenChange={(isOpen) => { if (!isOpen) handleCloseDialogs(); else setOpenStockDialog(true); }}>
                <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                            <span className="flex items-center justify-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-archive h-6 w-6 text-teal-600"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                                Ajustar Stock ({product.description})
                            </span>
                        </DialogTitle>
                        <DialogDescription className="text-center text-gray-600 mt-1">
                            Ajuste el stock del producto. Este cambio se reflejará en la base de datos.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-6">
                         <div className="flex justify-around items-center">
                            <Button
                                size="lg"
                                className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
                                onClick={() => handleDecrement(product.barcode, 'stock')}
                                aria-label="Disminuir stock"
                            >
                                <Minus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>

                            <div className="text-5xl sm:text-6xl font-bold mx-4 sm:mx-6 text-gray-800 tabular-nums select-none">
                                {currentStock}
                            </div>

                            <Button
                                size="lg"
                                className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
                                onClick={() => handleIncrement(product.barcode, 'stock')}
                                aria-label="Aumentar stock"
                            >
                                <Plus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="mt-4">
                         <DialogClose asChild>
                             <Button type="button" variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-100" onClick={handleCloseDialogs}>
                                Cerrar
                            </Button>
                        </DialogClose>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }


     const renderConfirmationDialog = () => (
         <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>Confirmar Modificación</AlertDialogTitle>
                <AlertDialogDescription>
                    La cantidad contada coincide con el stock. ¿Estás seguro de que deseas modificar la cantidad?
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
                        ¿Estás seguro de que deseas eliminar el producto "{productToDelete?.description}" del inventario actual? Esta acción no se puede deshacer.
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


  // --- Main Component Render ---
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4 text-center text-gray-700">StockCounter Pro</h1>

      <Tabs defaultValue="Contador" className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
        <TabsList className="grid w-full grid-cols-2 bg-gray-100 p-1 rounded-lg mb-4 shadow-inner">
          <TabsTrigger
             value="Contador"
             className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 py-2 px-4 rounded-md transition-colors duration-200 ease-in-out font-medium"
          >
              Contador de Existencias
          </TabsTrigger>
          <TabsTrigger
             value="Base de Datos"
             className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 py-2 px-4 rounded-md transition-colors duration-200 ease-in-out font-medium"
           >
               Base de Datos
           </TabsTrigger>
        </TabsList>

        {/* Content for the Counter Tab */}
        <TabsContent value="Contador">
          <div className="flex items-center mb-4 gap-2">
            <Input
              type="text"
              placeholder="Escanear o ingresar código de barras"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="mr-2 flex-grow bg-yellow-100 border-teal-300 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm"
              ref={barcodeInputRef}
              onKeyDown={handleKeyDown}
               aria-label="Código de barras"
            />
            <Button
              onClick={handleAddProduct}
              className="bg-teal-600 hover:bg-teal-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200"
              aria-label="Agregar producto"
            >
              Agregar
            </Button>
            {/* Add refresh stock button */}
            <Button
                onClick={handleRefreshStock}
                variant="outline"
                size="icon"
                className="text-blue-600 border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                disabled={isRefreshingStock}
                aria-label="Actualizar stocks desde la base de datos"
                title="Actualizar Stocks"
            >
                 <RefreshCw className={`h-5 w-5 ${isRefreshingStock ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <ScrollArea className="h-[calc(100vh-280px)] md:h-[calc(100vh-250px)] border rounded-lg shadow-sm bg-white">
            <Table>
              <TableCaption className="py-3 text-sm text-gray-500">Inventario de productos escaneados.</TableCaption>
              <TableHeader className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[35%] sm:w-2/5">Descripción</TableHead>
                  <TableHead className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">
                    Proveedor
                  </TableHead>
                  <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%] sm:w-[10%]">Stock</TableHead>
                  <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%] sm:w-[10%]">Cantidad</TableHead>
                   <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">Última Actualización</TableHead>
                   <TableHead className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[5%]">Validación</TableHead>
                   {/* Actions column hidden on mobile, visible on medium screens and up */}
                   <TableHead className="text-center hidden md:table-cell px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-[15%]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow
                    key={product.barcode}
                    className={cn(
                      "hover:bg-gray-50 transition-colors duration-150",
                      product.count === product.stock && product.stock !== 0 ? "bg-green-50" : ""
                    )}
                    aria-rowindex={products.indexOf(product) + 1}
                  >
                    <TableCell
                        className="px-4 py-3 font-medium text-gray-900 cursor-pointer hover:text-red-600 hover:underline"
                        onClick={() => handleDeleteRequest(product)}
                        title={`Eliminar ${product.description}`}
                        aria-label={`Eliminar ${product.description}`}
                    >
                      {product.description}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell px-4 py-3 text-gray-600">
                      {product.provider || 'N/A'}
                    </TableCell>
                      <TableCell
                                  className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold tabular-nums"
                                  onClick={() => handleOpenStockDialog(product)}
                                  title={`Editar stock para ${product.description}`}
                                  aria-label={`Editar stock para ${product.description}`}
                              >
                                  {product.stock ?? 0}
                      </TableCell>
                    <TableCell
                      className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold tabular-nums"
                      onClick={() => handleOpenQuantityDialog(product)}
                      title={`Editar cantidad para ${product.description}`}
                       aria-label={`Editar cantidad para ${product.description}`}
                    >
                      {product.count ?? 0}
                    </TableCell>
                     <TableCell className="hidden md:table-cell px-4 py-3 text-gray-500 text-xs">
                         {product.lastUpdated ? format(new Date(product.lastUpdated), 'PPpp', { timeZone: 'auto' }) : 'N/A'}
                     </TableCell>
                      <TableCell className="hidden md:table-cell px-4 py-3 text-center">
                          {product.count === product.stock && product.stock !== 0 ? (
                              <span className="text-green-600 font-semibold">OK</span>
                          ) : product.count > product.stock ? (
                              <span className="text-yellow-600 font-semibold">+{product.count - product.stock}</span>
                          ) : product.stock > 0 && product.count < product.stock ? (
                               <span className="text-red-600 font-semibold">{product.count - product.stock}</span>
                          ) : null }
                      </TableCell>
                    <TableCell className="text-center hidden md:table-cell px-4 py-3">
                       <div className="flex justify-center items-center space-x-1">
                          <Button
                            onClick={() => handleDecrement(product.barcode, 'count')}
                            size="icon"
                             variant="ghost"
                             className="text-gray-500 hover:text-red-600 hover:bg-red-100 rounded-full w-8 h-8"
                             aria-label={`Disminuir cantidad para ${product.description}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => handleIncrement(product.barcode, 'count')}
                             size="icon"
                             variant="ghost"
                             className="text-gray-500 hover:text-green-600 hover:bg-green-100 rounded-full w-8 h-8"
                             aria-label={`Aumentar cantidad para ${product.description}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                       </div>
                    </TableCell>
                  </TableRow>
                ))}
                {products.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center px-4 py-10 text-gray-500">
                      {isDbLoading ? "Cargando base de datos..." : "No hay productos agregados al inventario. Escanea un código de barras para empezar."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          <div className="mt-4 flex justify-end items-center">
            <Button
                onClick={handleExport}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200"
                disabled={products.length === 0}
                aria-label="Exportar inventario a CSV"
            >
                 Exportar Inventario
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="Base de Datos">
          <ProductDatabase
            databaseProducts={databaseProducts}
            setDatabaseProducts={setDatabaseProducts}
          />
        </TabsContent>
      </Tabs>

            {renderQuantityDialog()}
            {renderStockDialog()}
            {renderConfirmationDialog()}
            {renderDeleteConfirmationDialog()}
    </div>
  );
}

        