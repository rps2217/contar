
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
import { Minus, Plus, Trash } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react"; // Import React
import { updateProductInDB, getAllProductsFromDB } from '@/lib/indexeddb-helpers'; // Import DB helpers


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
    // Focus input on mount (moved to finally block)
    // barcodeInputRef.current?.focus();
  }, [toast]); // Dependency array includes toast

  // Function to play a beep sound
  const playBeep = useCallback(() => {
    // Web Audio API for better control and compatibility
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        try {
             const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
             const oscillator = audioCtx.createOscillator();
             const gainNode = audioCtx.createGain(); // Control volume

             oscillator.type = 'sine'; // Standard beep sound
             oscillator.frequency.setValueAtTime(660, audioCtx.currentTime); // Higher pitch beep (A5)
             gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); // Reduce volume slightly
             gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15); // Fade out quickly

             oscillator.connect(gainNode);
             gainNode.connect(audioCtx.destination);

             oscillator.start(audioCtx.currentTime);
             oscillator.stop(audioCtx.currentTime + 0.15); // Stop after 150ms

             // Close context after sound finishes to free resources
             setTimeout(() => {
                audioCtx.close().catch(err => console.warn("Error closing AudioContext:", err));
            }, 200);

        } catch (error) {
             console.error("Error playing beep sound:", error);
        }

    } else {
        console.warn("AudioContext not supported in this browser. Cannot play beep sound.");
    }
  }, []); // Empty dependency array as it doesn't depend on external state

 // Handles adding or incrementing a product in the counting list
 const handleAddProduct = useCallback(async () => {
    // Trim whitespace from barcode input which might be added by some scanners
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

    // 1. Check if product is already in the *counting* list
    const existingProductIndex = products.findIndex((p) => p.barcode === currentBarcode);

    if (existingProductIndex !== -1) {
      // Get the product to update *before* calling setProducts
      const productToUpdate = products[existingProductIndex];
      const newCount = productToUpdate.count + 1;
      const descriptionForToast = productToUpdate.description;

      // --- Product exists in counting list: Increment count ---
      setProducts(prevProducts => {
        const updatedProducts = [...prevProducts];
        // Find index again within the updater function's scope if necessary
        const internalIndex = updatedProducts.findIndex(p => p.barcode === currentBarcode);
        if (internalIndex === -1) return prevProducts; // Should not happen, but safe check

        const productDataToUpdate = updatedProducts[internalIndex];
        const updatedProductData = { // Use data calculated above
          ...productDataToUpdate,
          count: productDataToUpdate.count + 1, // Correctly increments
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };
        // Move updated product to the top for visibility
        updatedProducts.splice(internalIndex, 1);
        // Update the specific product data
        updatedProducts.unshift(updatedProductData); // Add the updated product data
        return updatedProducts;
      });
      // Call toast *after* scheduling the state update, using pre-calculated info
      toast({
        title: "Cantidad aumentada",
        description: `${descriptionForToast} cantidad aumentada a ${newCount}.`,
      });

    } else {
      // --- Product not in counting list: Look in the database state ---
      const productFromDb = databaseProducts.find((p) => p.barcode === currentBarcode);

      if (productFromDb) {
        // --- Product found in database: Add to counting list ---
        const newProductForList: Product = {
          ...productFromDb, // Get description, provider, stock from DB
          count: 1, // Start count at 1 for the counting list
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };
        // Add new product to the top of the counting list
        setProducts(prevProducts => [newProductForList, ...prevProducts]);
        toast({
          title: "Producto agregado",
          description: `${newProductForList.description} agregado al inventario.`,
        });
      } else {
        // --- Product not found in database: Add as unknown ---
        playBeep(); // Beep because it's unknown
        const newProductData: Product = {
          barcode: currentBarcode,
          description: `Producto desconocido ${currentBarcode}`,
          provider: "Desconocido",
          stock: 0, // Stock is unknown
          count: 1, // Start count at 1
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };

        // Add unknown product to the top of the counting list
        setProducts(prevProducts => [newProductData, ...prevProducts]);

        toast({
          variant: "destructive",
          title: "Producto desconocido",
          description: `Producto ${currentBarcode} no encontrado en la base de datos. Agregado al inventario.`,
          duration: 5000,
        });
        // Consider adding a button to the toast or a separate mechanism
        // to quickly add this unknown product to the database.
      }
    }

    // Clear input and refocus AFTER all state updates are likely processed
    setBarcode("");
    // Use requestAnimationFrame to ensure focus happens after potential re-renders
    requestAnimationFrame(() => {
        barcodeInputRef.current?.focus();
    });

  }, [barcode, products, databaseProducts, toast, playBeep]);


  // --- Quantity/Stock Modification Callbacks ---

  // General function to modify count or stock, handling confirmations and DB updates
  const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    let productToConfirm: Product | null = null;
    let needsConfirmation = false;
    let originalCount = -1; // Store original count for potential revert
    let updatedProductDescription = ''; // Store description for toast

    // Optimistic UI update for counting list state
    setProducts(prevProducts => {
        const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
        if (index === -1) return prevProducts; // Product not found

        const updatedProducts = [...prevProducts];
        const product = updatedProducts[index];
        originalCount = product.count; // Store original count before modification
        updatedProductDescription = product.description; // Store description
        let finalValue;

        if (type === 'count') {
            finalValue = product.count + change;
            if (finalValue < 0) finalValue = 0; // Prevent count going below zero

            // Check if confirmation is needed (only when count matches non-zero stock)
            if (product.stock !== 0) {
                const changingToMatch = change > 0 && finalValue === product.stock;
                const changingFromMatch = change < 0 && product.count === product.stock;
                if (changingToMatch || changingFromMatch) {
                    productToConfirm = { ...product }; // Clone product state at this point
                    needsConfirmation = true;
                }
            }
             // If confirmation is needed, revert the optimistic update for now, otherwise apply
            if (needsConfirmation) {
                // Do nothing to the state here, revert happens below
                console.log("Confirmation needed for", product.barcode);
                 updatedProducts[index] = { ...product }; // No change yet

            } else {
                updatedProducts[index] = { ...product, count: finalValue, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
            }

        } else { // type === 'stock'
            finalValue = product.stock + change;
             if (finalValue < 0) finalValue = 0; // Prevent stock going below zero
            // Update stock in counting list (optimistic for UI)
            updatedProducts[index] = { ...product, stock: finalValue, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
        }

        return updatedProducts;
    });

     // Update stock in IndexedDB *after* state update if stock changed
    if (type === 'stock') {
       // Find the product in the *database* state to ensure we update the correct base stock
        const productInDb = databaseProducts.find(p => p.barcode === barcodeToUpdate);

       if (productInDb) {
           const newStock = productInDb.stock + change; // Calculate new stock based on DB state + change
           if (newStock >= 0) {
                try {
                    // Prepare the data for DB update (only barcode, description, provider, stock, lastUpdated are needed)
                    const productToUpdateInDB: Product = {
                         ...productInDb,
                         stock: newStock,
                         lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
                         // count is irrelevant for the DB product record itself
                     };
                    await updateProductInDB(productToUpdateInDB); // Update DB

                    // Also update the databaseProducts state for consistency across tabs
                    setDatabaseProducts(prevDbProducts =>
                        prevDbProducts.map(dbP =>
                            dbP.barcode === barcodeToUpdate ? productToUpdateInDB : dbP
                        )
                    );
                     // Use the description captured earlier
                    toast({ title: "Stock Actualizado", description: `Stock de ${updatedProductDescription} actualizado a ${newStock} en la base de datos.` });
                } catch (error) {
                    console.error("Failed to update stock in DB:", error);
                    toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
                    // Revert stock change in `products` state if DB update failed
                     setProducts(prevProducts => {
                         const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
                         if (index === -1) return prevProducts;
                         const revertedProducts = [...prevProducts];
                         // Revert to the stock value held in the *databaseProducts* state before the failed attempt
                         revertedProducts[index] = { ...revertedProducts[index], stock: productInDb.stock };
                         return revertedProducts;
                     });
                     // Also revert the change in databaseProducts state if the optimistic update there happened
                    // (Though technically the state update might not have happened if await failed early)
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
                 // If we don't have DB state, revert to the original stock value from the list item itself
                 // This assumes the stock value in the list was initially correct or 0 if unknown
                 const originalListStock = productInList.stock - change; // Calculate original before change
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
        // State update was already skipped above if confirmation is needed
    } else if (type === 'count' && !needsConfirmation) {
         // If no confirmation was needed, show success toast for count change
         const finalCountValue = originalCount + change;
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${updatedProductDescription} cambiada a ${finalCountValue < 0 ? 0 : finalCountValue}.` });
    }

  }, [products, databaseProducts, setDatabaseProducts, toast]); // Added dependencies

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
        // Re-apply the count change after confirmation
         setProducts(prevProducts => {
             const index = prevProducts.findIndex(p => p.barcode === confirmProductBarcode);
             if (index === -1) return prevProducts; // Should not happen if dialog was shown

             const updatedProducts = [...prevProducts];
             const product = updatedProducts[index];
             descriptionForToast = product.description; // Capture description
             newCount = product.count + change;
             updatedProducts[index] = {
                 ...product,
                 count: newCount < 0 ? 0 : newCount, // Ensure count doesn't go below 0
                 lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
             };
             return updatedProducts;
         });
         // Show toast outside the state updater
         toast({ title: "Cantidad Modificada", description: `Cantidad de ${descriptionForToast} cambiada a ${newCount}.` });
    }
    // Reset confirmation state
    setIsConfirmDialogOpen(false);
    setConfirmProductBarcode(null);
    setConfirmAction(null);
  }, [confirmProductBarcode, confirmAction, toast]); // Added toast

  // --- Deletion Handlers ---

  // Initiates the delete process by opening the confirmation dialog
  const handleDeleteRequest = useCallback((product: Product) => {
        setProductToDelete(product);
        setIsDeleteDialogOpen(true);
    }, []);

    // Confirms the deletion and removes the product from the counting list
    const confirmDelete = useCallback(() => {
        if (productToDelete) {
            const descriptionForToast = productToDelete.description; // Capture before state update
            setProducts(prevProducts => prevProducts.filter(p => p.barcode !== productToDelete.barcode));
            toast({
                title: "Producto eliminado",
                description: `${descriptionForToast} ha sido eliminado del inventario actual.`,
                variant: "default" // Use default variant for successful deletion
            });
        }
        // Reset deletion state
        setIsDeleteDialogOpen(false);
        setProductToDelete(null);
    }, [productToDelete, toast]);


    // --- Export Functionality ---
    // Exports the current counting list to a CSV file
    const handleExport = useCallback(() => {
        if (products.length === 0) {
            toast({ title: "Vacío", description: "No hay productos en el inventario para exportar." });
            return;
        }
        try {
            const csvData = convertToCSV(products);
            const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" }); // Add BOM for Excel compatibility
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
            link.setAttribute("download", `inventory_count_${timestamp}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link); // Clean up the link element
             URL.revokeObjectURL(link.href); // Clean up the blob URL
            toast({ title: "Exportado", description: "Inventario exportado a CSV." });
        } catch (error) {
            console.error("Error exporting inventory:", error);
            toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
        }
    }, [products, toast]); // Dependencies

  // Converts an array of Product objects to a CSV string
  const convertToCSV = (data: Product[]) => {
    const headers = ["Barcode", "Description", "Provider", "Stock", "Count", "Last Updated"];
     // Helper function to safely quote CSV fields containing commas or quotes
     const safeQuote = (field: any): string => {
        const str = String(field ?? ''); // Ensure it's a string, handle null/undefined
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
             // Escape double quotes within the field by doubling them, then enclose in double quotes.
             const escapedStr = str.replace(/"/g, '""');
            return `"${escapedStr}"`;
        }
        return str; // Return as is if no special characters
    };

    const rows = data.map((product) => [
      safeQuote(product.barcode),
      safeQuote(product.description),
      safeQuote(product.provider),
      product.stock ?? 0, // Default stock to 0 if null/undefined
      product.count ?? 0, // Default count to 0
      product.lastUpdated ? safeQuote(format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss')) : '""', // Format date safely
    ]);

    // Combine headers and rows into a single CSV string
    return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
  };

  // --- Event Handlers ---
  // Handles Enter key press in the barcode input field
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
       e.preventDefault(); // Prevent default form submission if applicable
       handleAddProduct(); // Trigger add product action
    }
  };

    // --- Dialog Openers ---
    // Opens the quantity adjustment dialog for a specific product
    const handleOpenQuantityDialog = useCallback((product: Product) => {
        setSelectedProductForDialog(product);
        setOpenQuantityDialog(true);
    }, []);

    // Opens the stock adjustment dialog for a specific product
    const handleOpenStockDialog = useCallback((product: Product) => {
        setSelectedProductForDialog(product);
        setOpenStockDialog(true);
    }, []);

    // Closes all adjustment dialogs and clears the selected product
    const handleCloseDialogs = () => {
        setOpenQuantityDialog(false);
        setOpenStockDialog(false);
        setSelectedProductForDialog(null); // Clear selected product when closing any dialog
    };

    // --- Dialog Renderers ---
    // Renders the quantity adjustment dialog
    const renderQuantityDialog = () => {
       const product = selectedProductForDialog;
       if (!product) return null; // Don't render if no product is selected

        // Find the latest count from the 'products' state
       const currentCount = products.find(p => p.barcode === product.barcode)?.count ?? product.count ?? 0;


       return (
            <Dialog open={openQuantityDialog} onOpenChange={(isOpen) => { if (!isOpen) handleCloseDialogs(); else setOpenQuantityDialog(true); }}>
                <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                            <span className="flex items-center justify-center gap-2">
                                {/* SVG Icon */}
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
                                size="lg" // Keep size large
                                className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center" // Adjusted padding and size
                                onClick={() => handleDecrement(product.barcode, 'count')}
                                aria-label="Disminuir cantidad"
                            >
                                <Minus className="h-8 w-8 sm:h-10 sm:w-10" /> {/* Adjusted icon size */}
                            </Button>

                             {/* Display the current count, ensuring it reflects updates */}
                            <div className="text-5xl sm:text-6xl font-bold mx-4 sm:mx-6 text-gray-800 tabular-nums select-none"> {/* Make number unselectable */}
                                {currentCount}
                            </div>

                            <Button
                                size="lg" // Keep size large
                                className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center" // Adjusted padding and size
                                onClick={() => handleIncrement(product.barcode, 'count')}
                                aria-label="Aumentar cantidad"
                            >
                                <Plus className="h-8 w-8 sm:h-10 sm:w-10" /> {/* Adjusted icon size */}
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="mt-4">
                        {/* Use DialogClose for the close button */}
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

    // Renders the stock adjustment dialog
    const renderStockDialog = () => {
        const product = selectedProductForDialog;
        if (!product) return null;

         // Find the latest stock from the 'databaseProducts' state or 'products' state for consistency
        const currentStock = products.find(p => p.barcode === product.barcode)?.stock ?? product.stock ?? 0;


        return (
             <Dialog open={openStockDialog} onOpenChange={(isOpen) => { if (!isOpen) handleCloseDialogs(); else setOpenStockDialog(true); }}>
                <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-xl p-6">
                    <DialogHeader>
                        <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                            <span className="flex items-center justify-center gap-2">
                                {/* SVG Icon */}
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
                                className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center" // Adjusted padding and size
                                onClick={() => handleDecrement(product.barcode, 'stock')}
                                aria-label="Disminuir stock"
                            >
                                <Minus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>

                            <div className="text-5xl sm:text-6xl font-bold mx-4 sm:mx-6 text-gray-800 tabular-nums select-none"> {/* Make number unselectable */}
                                {currentStock}
                            </div>

                            <Button
                                size="lg"
                                className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center" // Adjusted padding and size
                                onClick={() => handleIncrement(product.barcode, 'stock')}
                                aria-label="Aumentar stock"
                            >
                                <Plus className="h-8 w-8 sm:h-10 sm:w-10" />
                            </Button>
                        </div>
                    </div>
                    <DialogFooter className="mt-4">
                         {/* Use DialogClose for the close button */}
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


     // Renders the confirmation dialog for quantity changes when count matches stock
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
                {/* Confirm button triggers the final quantity change */}
                <AlertDialogAction onClick={handleConfirmQuantityChange}>Confirmar</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
     );

      // Renders the confirmation dialog for deleting a product from the counting list
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
                    {/* Cancel button */}
                    <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>Cancelar</AlertDialogCancel>
                    {/* Delete confirmation button */}
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

      {/* Use Tabs for switching between Counter and Database views */}
      <Tabs defaultValue="Contador" className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
        <TabsList className="grid w-full grid-cols-2 bg-gray-100 p-1 rounded-lg mb-4 shadow-inner">
          {/* Tab trigger for the Counter view */}
          <TabsTrigger
             value="Contador"
             className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 py-2 px-4 rounded-md transition-colors duration-200 ease-in-out font-medium"
          >
              Contador de Existencias
          </TabsTrigger>
           {/* Tab trigger for the Database view */}
          <TabsTrigger
             value="Base de Datos"
             className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 py-2 px-4 rounded-md transition-colors duration-200 ease-in-out font-medium"
           >
               Base de Datos
           </TabsTrigger>
        </TabsList>

        {/* Content for the Counter Tab */}
        <TabsContent value="Contador">
          <div className="flex items-center mb-4 gap-2"> {/* Added gap */}
            {/* Barcode input field */}
            <Input
              type="text" // Keep as text for scanners that might send non-numeric chars or prefix/suffix
              placeholder="Escanear o ingresar código de barras"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
               // Apply pale yellow background using Tailwind classes
              className="mr-2 flex-grow bg-yellow-100 border-teal-300 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm"
              ref={barcodeInputRef}
              onKeyDown={handleKeyDown} // Handle Enter key press
               aria-label="Código de barras"
            />
             {/* Button to add product */}
            <Button
              onClick={handleAddProduct}
              className="bg-teal-600 hover:bg-teal-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200"
              aria-label="Agregar producto"
            >
              Agregar
            </Button>
          </div>

           {/* Scrollable area for the product counting table */}
           {/* Adjusted height calculation for better responsiveness */}
          <ScrollArea className="h-[calc(100vh-280px)] md:h-[calc(100vh-250px)] border rounded-lg shadow-sm bg-white">
            <Table>
              <TableCaption className="py-3 text-sm text-gray-500">Inventario de productos escaneados.</TableCaption>
              {/* Sticky Table Header */}
              <TableHeader className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                <TableRow>
                  {/* Column Headers */}
                  <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[35%] sm:w-2/5">Descripción</TableHead>
                  {/* Hidden on small screens */}
                  <TableHead className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">
                    Proveedor
                  </TableHead>
                  <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%] sm:w-[10%]">Stock</TableHead>
                  <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%] sm:w-[10%]">Cantidad</TableHead>
                   {/* Hidden on smaller screens */}
                   <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">Última Actualización</TableHead>
                   <TableHead className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[5%]">Validación</TableHead>
                  {/* Actions column hidden on mobile, visible on medium screens and up */}
                  <TableHead className="text-center hidden md:table-cell px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-[15%]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Map through products in the counting list */}
                {products.map((product) => (
                  <TableRow
                    key={product.barcode}
                    className={cn(
                      "hover:bg-gray-50 transition-colors duration-150",
                       // Apply green background if count matches non-zero stock
                      product.count === product.stock && product.stock !== 0 ? "bg-green-50" : ""
                    )}
                    aria-rowindex={products.indexOf(product) + 1}
                  >
                    {/* Product Description - Clickable to request deletion */}
                    <TableCell
                        className="px-4 py-3 font-medium text-gray-900 cursor-pointer hover:text-red-600 hover:underline"
                        onClick={() => handleDeleteRequest(product)} // Trigger delete confirmation
                        title={`Eliminar ${product.description}`} // Tooltip for clarity
                        aria-label={`Eliminar ${product.description}`}
                    >
                      {product.description}
                    </TableCell>
                    {/* Provider - Hidden on small screens */}
                    <TableCell className="hidden sm:table-cell px-4 py-3 text-gray-600">
                      {product.provider || 'N/A'}
                    </TableCell>
                      {/* Stock - Clickable to open stock adjustment dialog */}
                      <TableCell
                                  className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold tabular-nums"
                                  onClick={() => handleOpenStockDialog(product)}
                                  title={`Editar stock para ${product.description}`}
                                  aria-label={`Editar stock para ${product.description}`}
                              >
                                  {product.stock ?? 0}
                      </TableCell>
                      {/* Count - Clickable to open quantity adjustment dialog */}
                    <TableCell
                      className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold tabular-nums"
                      onClick={() => handleOpenQuantityDialog(product)}
                      title={`Editar cantidad para ${product.description}`}
                       aria-label={`Editar cantidad para ${product.description}`}
                    >
                      {product.count ?? 0}
                    </TableCell>
                     {/* Last Updated Timestamp - Hidden on smaller screens */}
                     <TableCell className="hidden md:table-cell px-4 py-3 text-gray-500 text-xs">
                         {product.lastUpdated ? format(new Date(product.lastUpdated), 'PPpp', { timeZone: 'auto' }) : 'N/A'}
                     </TableCell>
                      {/* Validation Status (OK if count matches stock) - Hidden on smaller screens */}
                      <TableCell className="hidden md:table-cell px-4 py-3 text-center">
                          {product.count === product.stock && product.stock !== 0 ? (
                              <span className="text-green-600 font-semibold">OK</span>
                          ) : product.count > product.stock ? (
                              <span className="text-yellow-600 font-semibold">+{product.count - product.stock}</span>
                          ) : product.stock > 0 && product.count < product.stock ? (
                               <span className="text-red-600 font-semibold">{product.count - product.stock}</span>
                          ) : null }
                      </TableCell>
                     {/* Action Buttons - Hidden on mobile, visible on desktop */}
                    <TableCell className="text-center hidden md:table-cell px-4 py-3">
                       <div className="flex justify-center items-center space-x-1">
                           {/* Decrement Count Button */}
                          <Button
                            onClick={() => handleDecrement(product.barcode, 'count')}
                            size="icon"
                             variant="ghost"
                             className="text-gray-500 hover:text-red-600 hover:bg-red-100 rounded-full w-8 h-8" // Smaller icon button
                             aria-label={`Disminuir cantidad para ${product.description}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                           {/* Increment Count Button */}
                          <Button
                            onClick={() => handleIncrement(product.barcode, 'count')}
                             size="icon"
                             variant="ghost"
                             className="text-gray-500 hover:text-green-600 hover:bg-green-100 rounded-full w-8 h-8" // Smaller icon button
                             aria-label={`Aumentar cantidad para ${product.description}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          {/* Delete button is now triggered by clicking description */}
                       </div>
                    </TableCell>
                  </TableRow>
                ))}
                 {/* Message shown when the counting list is empty */}
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

           {/* Export button for the counting list */}
          <div className="mt-4 flex justify-end items-center">
            <Button
                onClick={handleExport}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200"
                disabled={products.length === 0} // Disable if no products to export
                aria-label="Exportar inventario a CSV"
            >
                 Exportar Inventario
            </Button>
          </div>
        </TabsContent>

         {/* Content for the Database Tab */}
        <TabsContent value="Base de Datos">
          {/* Render the ProductDatabase component, passing state and setter */}
          {/* The ProductDatabase component manages its own internal logic */}
          {/* but receives the initial/updated DB product list from this parent */}
          <ProductDatabase
            databaseProducts={databaseProducts}
            setDatabaseProducts={setDatabaseProducts}
          />
        </TabsContent>
      </Tabs>

            {/* Render dialogs */}
            {renderQuantityDialog()}
            {renderStockDialog()}
            {renderConfirmationDialog()}
            {renderDeleteConfirmationDialog()}
    </div>
  );
}

