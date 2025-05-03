
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
  const [products, setProducts] = useState<Product[]>([]);
  const [databaseProducts, setDatabaseProducts] = useState<Product[]>([]);
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [openQuantityDialog, setOpenQuantityDialog] = useState(false);
  const [openStockDialog, setOpenStockDialog] = useState(false);
  const [selectedProductForDialog, setSelectedProductForDialog] = useState<Product | null>(null); // Use one state for dialog product
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'increment' | 'decrement' | null>(null);
  const [confirmProductBarcode, setConfirmProductBarcode] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  // Load database products on initial mount
  useEffect(() => {
    const loadDb = async () => {
      try {
        const dbProducts = await getAllProductsFromDB();
        setDatabaseProducts(dbProducts);
      } catch (error) {
        console.error("Failed to load database products:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudieron cargar los productos de la base de datos.",
        });
      }
    };
    loadDb();
    barcodeInputRef.current?.focus();
  }, [toast]); // Dependency array includes toast

  const playBeep = useCallback(() => {
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
        oscillator.connect(audioCtx.destination);
        oscillator.start();
        setTimeout(() => {
            oscillator.stop();
            audioCtx.close();
        }, 100);
    } else {
        console.warn("AudioContext not supported in this browser.");
    }
  }, []); // Empty dependency array as it doesn't depend on external state

 const handleAddProduct = useCallback(async () => {
    const currentBarcode = barcode.trim(); // Trim barcode immediately

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
      // Product exists in counting list, increment count
      setProducts(prevProducts => {
        const updatedProducts = [...prevProducts];
        const productToUpdate = updatedProducts[existingProductIndex];
        const updatedProduct = {
          ...productToUpdate,
          count: productToUpdate.count + 1,
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };
        // Move updated product to the top
        updatedProducts.splice(existingProductIndex, 1);
        updatedProducts.unshift(updatedProduct);
        toast({
          title: "Cantidad aumentada",
          description: `${updatedProduct.description} cantidad aumentada a ${updatedProduct.count}.`,
        });
        return updatedProducts;
      });

    } else {
      // Product not in counting list, look in the database state
      const productFromDb = databaseProducts.find((p) => p.barcode === currentBarcode);

      if (productFromDb) {
        // Product found in database state, add it to the counting list
        const newProductForList: Product = {
          ...productFromDb,
          count: 1,
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };
        // Add to top
        setProducts(prevProducts => [newProductForList, ...prevProducts]);
        toast({
          title: "Producto agregado",
          description: `${newProductForList.description} agregado al inventario desde la base de datos.`,
        });
      } else {
        // Product not found in database state, add as new (unknown)
        playBeep(); // Beep because it's unknown
        const newProductData: Product = {
          barcode: currentBarcode,
          description: `Producto desconocido ${currentBarcode}`,
          provider: "Desconocido",
          stock: 0,
          count: 1, // Start count at 1 for the counting list
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };

        // Add to counting list state (add to top)
        setProducts(prevProducts => [newProductData, ...prevProducts]);

        // Optionally, decide if you want to add unknown products to the database automatically
        // If so, call addProductsToDB here and update databaseProducts state
        // Example:
        // try {
        //   await addProductsToDB([{...newProductData, count: 0}]); // Add to DB with count 0
        //   setDatabaseProducts(prevDb => [{...newProductData, count: 0}, ...prevDb]);
        // } catch (error) { console.error("Failed to add unknown product to DB", error); }


        toast({
          variant: "destructive",
          title: "Producto desconocido",
          description: `Producto ${currentBarcode} no encontrado. Agregado al inventario. Considere agregarlo a la base de datos.`,
        });
      }
    }

    // Clear input and refocus AFTER all logic is done
    setBarcode("");
    barcodeInputRef.current?.focus();

  }, [barcode, products, databaseProducts, toast, playBeep, setDatabaseProducts]); // Ensure all dependencies are listed


  // --- Quantity/Stock Modification Callbacks ---

  const modifyProductValue = useCallback(async (barcodeToUpdate: string, type: 'count' | 'stock', change: number) => {
    let productToConfirm: Product | null = null;
    let shouldConfirm = false;

    setProducts(prevProducts => {
        const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
        if (index === -1) return prevProducts; // Product not found in list

        const updatedProducts = [...prevProducts];
        const product = updatedProducts[index];
        let finalChange = change;

        if (type === 'count') {
            const newCount = product.count + change;
            if (newCount < 0) finalChange = 0; // Prevent count going below zero

            // Check for confirmation only when INCREMENTING count to match stock
            if (change > 0 && newCount === product.stock && product.stock !== 0) {
                 productToConfirm = product;
                 shouldConfirm = true;
            }
            // Check for confirmation when DECREMENTING count when it matches stock
             if (change < 0 && product.count === product.stock && product.stock !== 0) {
                productToConfirm = product;
                shouldConfirm = true;
             }


            updatedProducts[index] = { ...product, count: product.count + finalChange, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
        } else { // type === 'stock'
            const newStock = product.stock + change;
            if (newStock < 0) finalChange = 0; // Prevent stock going below zero
            updatedProducts[index] = { ...product, stock: product.stock + finalChange, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
        }

        return updatedProducts;
    });

     // Update stock in IndexedDB if stock changed
    if (type === 'stock') {
       const product = products.find(p => p.barcode === barcodeToUpdate);
       if (product) {
           const newStock = product.stock + change;
           if (newStock >= 0) {
                try {
                    // Fetch the latest version from DB first? Or just update based on current state?
                    // Assuming current state is accurate enough for this update.
                    await updateProductInDB({ ...product, stock: newStock });
                    // Also update the databaseProducts state for consistency
                    setDatabaseProducts(prevDbProducts =>
                        prevDbProducts.map(dbP => dbP.barcode === barcodeToUpdate ? { ...dbP, stock: newStock } : dbP)
                    );
                } catch (error) {
                    console.error("Failed to update stock in DB:", error);
                    toast({ variant: "destructive", title: "Error DB", description: "No se pudo actualizar el stock en la base de datos." });
                    // Optionally revert the state change in `products` state here
                }
           }
       }
    }

    // Handle confirmation dialog outside of state update
    if (shouldConfirm && productToConfirm) {
        setConfirmProductBarcode(productToConfirm.barcode);
        setConfirmAction(change > 0 ? 'increment' : 'decrement');
        setIsConfirmDialogOpen(true);
        // Revert the optimistic UI update for count if confirmation is needed
         setProducts(prevProducts => {
             const index = prevProducts.findIndex(p => p.barcode === barcodeToUpdate);
             if (index === -1) return prevProducts;
             const revertedProducts = [...prevProducts];
             revertedProducts[index] = { ...revertedProducts[index], count: revertedProducts[index].count - change }; // Revert the change
             return revertedProducts;
         });

    }

  }, [products, setDatabaseProducts, toast]); // Added setDatabaseProducts

  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    modifyProductValue(barcode, type, 1);
  }, [modifyProductValue]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    modifyProductValue(barcode, type, -1);
  }, [modifyProductValue]);

  const handleConfirmQuantityChange = useCallback(() => {
    if (confirmProductBarcode && confirmAction) {
      const change = confirmAction === 'increment' ? 1 : -1;
        // Re-apply the change after confirmation
         setProducts(prevProducts => {
             const index = prevProducts.findIndex(p => p.barcode === confirmProductBarcode);
             if (index === -1) return prevProducts;
             const updatedProducts = [...prevProducts];
             const product = updatedProducts[index];
             const newCount = product.count + change;
             updatedProducts[index] = { ...product, count: newCount < 0 ? 0 : newCount, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
             return updatedProducts;
         });
    }
    setIsConfirmDialogOpen(false);
    setConfirmProductBarcode(null);
    setConfirmAction(null);
  }, [confirmProductBarcode, confirmAction]);

  const handleDeleteRequest = useCallback((product: Product) => {
        setProductToDelete(product);
        setIsDeleteDialogOpen(true);
    }, []);

    const confirmDelete = useCallback(() => {
        if (productToDelete) {
            setProducts(prevProducts => prevProducts.filter(p => p.barcode !== productToDelete.barcode));
            toast({
                title: "Producto eliminado",
                description: `${productToDelete.description} ha sido eliminado del inventario.`,
            });
        }
        setIsDeleteDialogOpen(false);
        setProductToDelete(null);
    }, [productToDelete, toast]);


    // --- Export ---
    const handleExport = useCallback(() => {
        if (products.length === 0) {
            toast({ title: "Vacío", description: "No hay productos en el inventario para exportar." });
            return;
        }
        const csvData = convertToCSV(products);
        const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" }); // Add BOM for Excel
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
        link.setAttribute("download", `inventory_count_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({ title: "Exportado", description: "Inventario exportado a CSV." });
    }, [products, toast]);

  const convertToCSV = (data: Product[]) => {
    const headers = ["Barcode", "Description", "Provider", "Stock", "Count", "Last Updated"];
    const rows = data.map((product) => [
      `"${product.barcode}"`, // Ensure barcode is treated as string
      `"${product.description?.replace(/"/g, '""') ?? ''}"`, // Handle quotes and null description
      `"${product.provider?.replace(/"/g, '""') ?? 'Desconocido'}"`, // Handle quotes and null provider
      product.stock ?? 0,
      product.count ?? 0,
      product.lastUpdated ? `"${format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss')}"` : '""', // Format date
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
        setSelectedProductForDialog(null); // Clear selected product when closing
    };

    // --- Dialog Renderers ---
    const renderQuantityDialog = () => {
       const product = selectedProductForDialog; // Get the product from state
       if (!product) return null; // Don't render if no product is selected

       return (
            <Dialog open={openQuantityDialog} onOpenChange={setOpenQuantityDialog}>
                <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-lg p-6">
                    <DialogHeader>
                        <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                            <span className="flex items-center justify-center gap-2">
                                {/* SVG Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-boxes h-6 w-6 text-teal-600"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 8 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
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
                                className="p-6 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-20 h-20 flex items-center justify-center"
                                onClick={() => handleDecrement(product.barcode, 'count')}
                                aria-label="Disminuir cantidad"
                            >
                                <Minus className="h-10 w-10" />
                            </Button>

                            <div className="text-6xl font-bold mx-6 text-gray-800 tabular-nums">
                                {products.find(p => p.barcode === product.barcode)?.count ?? 0}
                            </div>

                            <Button
                                size="lg"
                                className="p-6 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-20 h-20 flex items-center justify-center"
                                onClick={() => handleIncrement(product.barcode, 'count')}
                                aria-label="Aumentar cantidad"
                            >
                                <Plus className="h-10 w-10" />
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
        const product = selectedProductForDialog; // Get the product from state
        if (!product) return null; // Don't render if no product is selected

        return (
            <Dialog open={openStockDialog} onOpenChange={setOpenStockDialog}>
                <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-lg p-6">
                    <DialogHeader>
                        <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                            <span className="flex items-center justify-center gap-2">
                                {/* SVG Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-archive h-6 w-6 text-teal-600"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                                Ajustar Stock ({product.description})
                            </span>
                        </DialogTitle>
                        <DialogDescription className="text-center text-gray-600 mt-1">
                            Ajuste el stock del producto manualmente. Este cambio se reflejará en la base de datos.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-6">
                        <div className="flex justify-around items-center">
                            <Button
                                size="lg"
                                className="p-6 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-20 h-20 flex items-center justify-center"
                                onClick={() => handleDecrement(product.barcode, 'stock')}
                                aria-label="Disminuir stock"
                            >
                                <Minus className="h-10 w-10" />
                            </Button>

                             <div className="text-6xl font-bold mx-6 text-gray-800 tabular-nums">
                                {products.find(p => p.barcode === product.barcode)?.stock ?? 0}
                            </div>

                            <Button
                                size="lg"
                                className="p-6 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-20 h-20 flex items-center justify-center"
                                onClick={() => handleIncrement(product.barcode, 'stock')}
                                aria-label="Aumentar stock"
                            >
                                <Plus className="h-10 w-10" />
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
                        ¿Estás seguro de que deseas eliminar el producto "{productToDelete?.description}" del inventario?
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


  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4 text-center text-gray-700">StockCounter Pro</h1>

      <Tabs defaultValue="Contador" className="w-full md:w-[800px] lg:w-[1000px] mx-auto">
        <TabsList className="grid w-full grid-cols-2 bg-gray-100 p-1 rounded-lg mb-4">
          <TabsTrigger value="Contador" className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 py-2 px-4 rounded-md transition-colors duration-200">Contador de Existencias</TabsTrigger>
          <TabsTrigger value="Base de Datos" className="data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=inactive]:text-gray-600 py-2 px-4 rounded-md transition-colors duration-200">Base de Datos</TabsTrigger>
        </TabsList>
        <TabsContent value="Contador">
          <div className="flex items-center mb-4">
            <Input
              type="text" // Keep as text for scanners
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
            >
              Agregar
            </Button>
          </div>

          <ScrollArea className="h-[calc(100vh-280px)] border rounded-lg shadow-sm">
            <Table>
              <TableCaption className="py-3 text-sm text-gray-500">Inventario de productos escaneados.</TableCaption>
              <TableHeader className="bg-gray-50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/5">Descripción</TableHead>
                  <TableHead className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">
                    Proveedor
                  </TableHead>
                  <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">Stock</TableHead>
                  <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">Cantidad</TableHead>
                   <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">Última Actualización</TableHead>
                   <TableHead className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[5%]">Validación</TableHead>
                  {/* Actions column hidden on mobile */}
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
                  >
                    <TableCell
                        className="px-4 py-3 font-medium text-gray-900 cursor-pointer hover:text-red-600 hover:underline"
                        onClick={() => handleDeleteRequest(product)} // Changed to request delete
                        aria-label={`Eliminar ${product.description}`}
                    >
                      {product.description}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell px-4 py-3 text-gray-600">
                      {product.provider}
                    </TableCell>
                      <TableCell
                                  className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold"
                                  onClick={() => handleOpenStockDialog(product)} // Use correct product object
                                  aria-label={`Editar stock para ${product.description}`}
                              >
                                  {product.stock}
                      </TableCell>
                    <TableCell
                      className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold"
                      onClick={() => handleOpenQuantityDialog(product)} // Use correct product object
                       aria-label={`Editar cantidad para ${product.description}`}
                    >
                      {product.count}
                    </TableCell>
                     <TableCell className="hidden md:table-cell px-4 py-3 text-gray-500 text-xs">
                         {product.lastUpdated ? format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A'}
                     </TableCell>
                      <TableCell className="hidden md:table-cell px-4 py-3 text-center">
                          {product.count === product.stock && product.stock !== 0 ? (
                              <span className="text-green-600 font-semibold">OK</span>
                          ) : null}
                      </TableCell>
                     {/* Actions hidden on mobile, visible on desktop */}
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
                          {/* Trash button removed, delete is now triggered by clicking description */}
                       </div>
                    </TableCell>
                  </TableRow>
                ))}
                {products.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center px-4 py-10 text-gray-500">
                      No hay productos agregados al inventario. Escanea un código de barras para empezar.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          <div className="mt-4 flex justify-end items-center">
            <Button onClick={handleExport} className="bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200">Exportar Inventario</Button>
          </div>
        </TabsContent>
        <TabsContent value="Base de Datos">
          {/* Pass the state and setter correctly */}
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
