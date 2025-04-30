
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Minus, Trash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductDatabase } from "@/components/product-database";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { format } from 'date-fns';
import type { Product } from '@/types/product'; // Import Product type


export default function Home() {
  const [barcode, setBarcode] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [databaseProducts, setDatabaseProducts] = useState<Product[]>([]);
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [openQuantity, setOpenQuantity] = useState(false);
  const [openStock, setOpenStock] = useState(false);
  const [selectedProductBarcode, setSelectedProductBarcode] = useState<string | null>(null);
  const [editingStockBarcode, setEditingStockBarcode] = useState<string | null>(null);
  const [newStockValue, setNewStockValue] = useState<string>("");

  // State for confirmation dialog
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'increment' | 'decrement' | 'delete' | null>(null);
  const [confirmProductBarcode, setConfirmProductBarcode] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);


  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  const playBeep = () => {
      // Check if AudioContext is supported
    if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine'; // Sine wave for a simple beep
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 pitch
        oscillator.connect(audioCtx.destination);
        oscillator.start();
        // Stop the beep after a short duration
        setTimeout(() => {
            oscillator.stop();
            audioCtx.close(); // Close the context to free resources
        }, 100); // 100 milliseconds duration
    } else {
        console.warn("AudioContext not supported in this browser.");
        // Fallback or do nothing if AudioContext is not supported
    }
  };

 const handleAddProduct = useCallback(async () => {
    if (!barcode.trim()) { // Ensure barcode is not just whitespace
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un código de barras válido.",
      });
      return;
    }
    const currentBarcode = barcode.trim(); // Use trimmed barcode

    // 1. Check if already in the counting list
    const existingProductIndex = products.findIndex((p) => p.barcode === currentBarcode);
    if (existingProductIndex !== -1) {
      // Product exists in counting list, increment count
      const updatedProducts = [...products];
      const updatedProduct = {
        ...updatedProducts[existingProductIndex],
        count: updatedProducts[existingProductIndex].count + 1,
        lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      };
      updatedProducts[existingProductIndex] = updatedProduct;
      // Move to top
      setProducts([updatedProduct, ...products.slice(0, existingProductIndex), ...products.slice(existingProductIndex + 1)]);
      toast({
        title: "Cantidad aumentada",
        description: `${updatedProduct.description} cantidad aumentada a ${updatedProduct.count}.`,
      });
    } else {
      // 2. Product not in counting list, look in the database state
      // Ensure databaseProducts state is correctly populated before this lookup
      const productFromDb = databaseProducts.find((p) => p.barcode === currentBarcode);

      if (productFromDb) {
        // Product found in database state, add it to the counting list
        const newProductForList = {
          ...productFromDb, // Use all data from DB record (includes description, provider, stock)
          count: 1,         // Start count at 1 for the counting list
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };
        setProducts([newProductForList, ...products]);
        toast({
          title: "Producto agregado",
          description: `${newProductForList.description} agregado al inventario desde la base de datos.`,
        });
      } else {
        // 3. Product not found in database state, add as new to both lists
        playBeep(); // Beep because it's unknown
        const newProductData = {
          barcode: currentBarcode,
          description: `Nuevo producto ${currentBarcode}`,
          provider: "Desconocido",
          stock: 0,
          count: 0, // Base count for DB state representation is 0
          lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
        };

        // Add to database state (ProductDatabase component listens and updates IndexedDB)
        setDatabaseProducts(prevDbProducts => [...prevDbProducts, newProductData]);

        // Add to counting list state (with count 1)
        setProducts([{ ...newProductData, count: 1 }, ...products]);

        toast({
          title: "Producto no encontrado",
          description: `Producto ${currentBarcode} no encontrado. Agregado como nuevo al inventario y a la base de datos.`,
        });
      }
    }

    setBarcode(""); // Clear input
    barcodeInputRef.current?.focus(); // Refocus

  }, [barcode, products, databaseProducts, setDatabaseProducts, toast]);


  const executeQuantityChange = useCallback((barcode: string, action: 'increment' | 'decrement') => {
    setProducts(prevProducts =>
      prevProducts.map(product => {
        if (product.barcode === barcode) {
          const change = action === 'increment' ? 1 : -1;
          const updatedCount = product.count + change;
          // Prevent going below zero for decrement
          if (action === 'decrement' && updatedCount < 0) return product;

          return { ...product, count: updatedCount, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };
        }
        return product;
      })
    );
  }, []);

  const handleIncrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    const product = products.find(p => p.barcode === barcode);
    if (!product) return;

    if (type === 'count' && product.count === product.stock && product.stock !== 0) {
      // Show confirmation dialog
      setConfirmProductBarcode(barcode);
      setConfirmAction('increment');
      setIsConfirmDialogOpen(true);
    } else {
      // Proceed with the increment directly
      setProducts(prevProducts =>
        prevProducts.map(p => {
          if (p.barcode === barcode) {
            const updatedCount = type === 'count' ? p.count + 1 : p.count;
            const updatedStock = type === 'stock' ? p.stock + 1 : p.stock;
            const updatedProduct = { ...p, count: updatedCount, stock: updatedStock, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };

            // Also update the stock in the database state if stock is changed
            if (type === 'stock') {
              setDatabaseProducts(prevDbProducts =>
                prevDbProducts.map(dbProduct =>
                  dbProduct.barcode === barcode ? { ...dbProduct, stock: updatedStock } : dbProduct
                )
              );
            }
            return updatedProduct;
          }
          return p;
        })
      );
    }
  }, [products, setDatabaseProducts]);

  const handleDecrement = useCallback((barcode: string, type: 'count' | 'stock') => {
    const product = products.find(p => p.barcode === barcode);
    if (!product) return;

    if (type === 'count' && product.count === product.stock && product.stock !== 0) {
      // Show confirmation dialog
      setConfirmProductBarcode(barcode);
      setConfirmAction('decrement');
      setIsConfirmDialogOpen(true);
    } else {
       // Proceed with the decrement directly
      setProducts(prevProducts =>
        prevProducts.map(p => {
          if (p.barcode === barcode) {
            const updatedCount = type === 'count' && p.count > 0 ? p.count - 1 : p.count;
            const updatedStock = type === 'stock' && p.stock > 0 ? p.stock - 1 : p.stock;
            const updatedProduct = { ...p, count: updatedCount, stock: updatedStock, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') };

            // Also update the stock in the database state if stock is changed
            if (type === 'stock') {
              setDatabaseProducts(prevDbProducts =>
                prevDbProducts.map(dbProduct =>
                  dbProduct.barcode === barcode ? { ...dbProduct, stock: updatedStock } : dbProduct
                )
              );
            }
            return updatedProduct;
          }
          return p;
        })
      );
    }
  }, [products, setDatabaseProducts]);

    const handleConfirmQuantityChange = () => {
        if (confirmProductBarcode && confirmAction && (confirmAction === 'increment' || confirmAction === 'decrement')) {
            executeQuantityChange(confirmProductBarcode, confirmAction);
        }
        setIsConfirmDialogOpen(false);
        setConfirmProductBarcode(null);
        setConfirmAction(null);
    };


    const handleDelete = useCallback((product: Product) => {
        setProductToDelete(product);
        setIsDeleteDialogOpen(true); // Open the delete confirmation dialog
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


  const handleExport = useCallback(() => {
    const csvData = convertToCSV(products);
    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "inventory_count.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [products]);

  const convertToCSV = (data: Product[]) => {
    const headers = ["Barcode", "Description", "Provider", "Stock", "Count", "Last Updated"];
    const rows = data.map((product) => [
      product.barcode,
      `"${product.description.replace(/"/g, '""')}"`, // Handle quotes in description
      `"${product.provider.replace(/"/g, '""')}"`, // Handle quotes in provider
      product.stock,
      product.count,
      product.lastUpdated,
    ]);

    const csv = headers.join(",") + "\n" + rows.map((row) => row.join(",")).join("\n");
    return csv;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddProduct();
    }
  };

    const handleOpenQuantityDialog = useCallback((barcode: string) => {
        setSelectedProductBarcode(barcode);
        setOpenQuantity(true);
    }, []);

    const handleOpenStockDialog = useCallback((barcode: string) => {
        setSelectedProductBarcode(barcode);
        setOpenStock(true);
    }, []);

    const handleQuantityChange = useCallback((barcode: string, newCount: number) => {
        setProducts(prevProducts =>
            prevProducts.map(product =>
                product.barcode === barcode ? { ...product, count: newCount,  lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') } : product
            )
        );
    }, []);

    const handleStockChange = useCallback((barcode: string, newStock: number) => {
        setProducts(prevProducts =>
            prevProducts.map(product =>
                product.barcode === barcode ? { ...product, stock: newStock, lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm:ss') } : product
            )
        );
        // Also update the stock in the database state
        setDatabaseProducts(prevDbProducts =>
            prevDbProducts.map(dbProduct =>
                dbProduct.barcode === barcode ? { ...dbProduct, stock: newStock } : dbProduct
            )
        );
    }, [setDatabaseProducts]); // Include setDatabaseProducts dependency

    const getProductByBarcode = useCallback((barcode: string) => {
        return products.find((product) => product.barcode === barcode);
    }, [products]);

    const handleCloseQuantityDialog = () => {
        setOpenQuantity(false);
    };

    const handleCloseStockDialog = () => {
        setOpenStock(false);
    };


  const handleStartEditingStock = (barcode: string) => {
    setSelectedProductBarcode(barcode);
    setOpenStock(true)
  };

  const handleCancelEditingStock = () => {
    setEditingStockBarcode(null);
    setNewStockValue("");
  };

  const handleSaveStock = (barcode: string) => {
      const newStock = parseInt(newStockValue, 10);
      if (!isNaN(newStock)) {
          handleStockChange(barcode, newStock);

          setDatabaseProducts(prevProducts => {
              return prevProducts.map(product => {
                  if (product.barcode === barcode) {
                      return { ...product, stock: newStock };
                  }
                  return product;
              });
          });

          setEditingStockBarcode(null);
          setNewStockValue("");
      } else {
          toast({
              variant: "destructive",
              title: "Error",
              description: "Por favor, introduce un número válido para el stock.",
          });
      }
  };

    const renderQuantityDialog = () => (
        <Dialog open={openQuantity} onOpenChange={setOpenQuantity}>
            <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-lg p-6">
                <DialogHeader>
                    <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                        <span className="flex items-center justify-center gap-2">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="lucide lucide-boxes h-6 w-6 text-teal-600"
                            >
                                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
                                <path d="m3.3 8 8.7 5 8.7-5"/>
                                <path d="M12 22V12"/>
                            </svg>
                            Ajustar Cantidad
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
                            onClick={() => {
                                if (selectedProductBarcode) {
                                    handleDecrement(selectedProductBarcode, 'count');
                                }
                            }}
                            aria-label="Disminuir cantidad"
                        >
                            <Minus className="h-10 w-10" />
                        </Button>

                        {selectedProductBarcode && (
                            <div className="text-6xl font-bold mx-6 text-gray-800 tabular-nums">
                                {getProductByBarcode(selectedProductBarcode)?.count ?? 0}
                            </div>
                        )}

                        <Button
                            size="lg"
                            className="p-6 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-20 h-20 flex items-center justify-center"
                            onClick={() => {
                                if (selectedProductBarcode) {
                                    handleIncrement(selectedProductBarcode, 'count');
                                }
                            }}
                             aria-label="Aumentar cantidad"
                        >
                            <Plus className="h-10 w-10" />
                        </Button>
                    </div>
                </div>
                <DialogFooter className="mt-4">
                    <DialogClose asChild>
                        <Button type="button" variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-100" onClick={handleCloseQuantityDialog}>
                            Cerrar
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

    const renderStockDialog = () => (
         <Dialog open={openStock} onOpenChange={setOpenStock}>
            <DialogContent className="sm:max-w-[425px] bg-white text-black border-teal-500 rounded-lg shadow-lg p-6">
                <DialogHeader>
                    <DialogTitle className="text-center text-xl font-semibold text-gray-800">
                        <span className="flex items-center justify-center gap-2">
                             <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="lucide lucide-archive h-6 w-6 text-teal-600" >
                                    <rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>
                             </svg>
                            Ajustar Stock
                        </span>
                    </DialogTitle>
                    <DialogDescription className="text-center text-gray-600 mt-1">
                        Ajuste el stock del producto manualmente.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-6">
                    <div className="flex justify-around items-center">
                        <Button
                            size="lg"
                             className="p-6 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-20 h-20 flex items-center justify-center"
                            onClick={() => {
                                if (selectedProductBarcode) {
                                    handleDecrement(selectedProductBarcode, 'stock');
                                }
                            }}
                             aria-label="Disminuir stock"
                        >
                            <Minus className="h-10 w-10" />
                        </Button>

                        {selectedProductBarcode && (
                             <div className="text-6xl font-bold mx-6 text-gray-800 tabular-nums">
                                {getProductByBarcode(selectedProductBarcode)?.stock ?? 0}
                            </div>
                        )}

                        <Button
                            size="lg"
                             className="p-6 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-20 h-20 flex items-center justify-center"
                            onClick={() => {
                                if (selectedProductBarcode) {
                                    handleIncrement(selectedProductBarcode, 'stock');
                                }
                            }}
                            aria-label="Aumentar stock"
                        >
                            <Plus className="h-10 w-10" />
                        </Button>
                    </div>
                </div>
                <DialogFooter className="mt-4">
                    <DialogClose asChild>
                         <Button type="button" variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-100" onClick={handleCloseStockDialog}>
                            Cerrar
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

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
              type="number"
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
                   <TableHead className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/5">Última Actualización</TableHead>
                   <TableHead className="hidden sm:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-[5%]">Validación</TableHead>
                  <TableHead className="text-center sm:table-cell hidden px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-[15%]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow
                    key={product.barcode}
                    className={`hover:bg-gray-50 transition-colors duration-150 ${
                      product.count === product.stock && product.stock !== 0 ? "bg-green-50" : ""
                    }`}
                  >
                    <TableCell
                        className="px-4 py-3 font-medium text-gray-900 cursor-pointer hover:text-red-600 hover:underline"
                        onClick={() => handleDelete(product)}
                        aria-label={`Eliminar ${product.description}`}
                    >
                      {product.description}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell px-4 py-3 text-gray-600">
                      {product.provider}
                    </TableCell>
                      <TableCell
                                  className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold"
                                  onClick={() => handleOpenStockDialog(product.barcode)}
                                  aria-label={`Editar stock para ${product.description}`}
                              >
                                  {product.stock}
                      </TableCell>
                    <TableCell
                      className="px-4 py-3 text-center text-gray-600 cursor-pointer hover:text-teal-700 hover:font-semibold"
                      onClick={() => handleOpenQuantityDialog(product.barcode)}
                       aria-label={`Editar cantidad para ${product.description}`}
                    >
                      {product.count}
                    </TableCell>
                     <TableCell className="hidden sm:table-cell px-4 py-3 text-gray-500 text-xs">{product.lastUpdated}</TableCell>
                      <TableCell className="hidden sm:table-cell px-4 py-3 text-center">
                          {product.count === product.stock && product.stock !== 0 ? (
                              <span className="text-green-600 font-semibold">OK</span>
                          ) : null}
                      </TableCell>
                    <TableCell className="text-center sm:table-cell hidden px-4 py-3">
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
                          {/* Remove Trash button here as click on description handles delete */}
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
