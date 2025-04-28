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

interface Product {
  barcode: string;
  description: string;
  provider: string;
  stock: number;
  count: number;
}

const initialProducts: Product[] = [
  {
    barcode: "12345",
    description: "Paracetamol 500mg",
    provider: "Genfar",
    stock: 100,
    count: 0,
  },
  {
    barcode: "67890",
    description: "Amoxicilina 250mg",
    provider: "MK",
    stock: 50,
    count: 0,
  },
];

export default function Home() {
  const [barcode, setBarcode] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [databaseProducts, setDatabaseProducts] = useState<Product[]>(initialProducts);
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedProductBarcode, setSelectedProductBarcode] = useState<string | null>(null);
  const [editingStockBarcode, setEditingStockBarcode] = useState<string | null>(null);
  const [newStockValue, setNewStockValue] = useState<string>("");

  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, []);

  const playBeep = () => {
    const audio = new Audio('/beep.mp3'); // Path to the beep sound file
    audio.play();
  };

  const handleAddProduct = useCallback(async () => {
    if (!barcode) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un código de barras.",
      });
      return;
    }

    let productInfo = databaseProducts.find((p) => p.barcode === barcode);

    if (!productInfo) {
      playBeep();
      productInfo = {
        barcode: barcode,
        description: `Nuevo producto ${barcode}`,
        provider: "Desconocido",
        stock: 0,
        count: 0,
      };
      toast({
        title: "Producto no encontrado",
        description: `Producto con código de barras ${barcode} no encontrado. Se ha creado un nuevo producto.`,
      });
    }

    const existingProductIndex = products.findIndex((p) => p.barcode === productInfo!.barcode);

    if (existingProductIndex !== -1) {
      const updatedProducts = [...products];
      updatedProducts[existingProductIndex] = {
        ...updatedProducts[existingProductIndex],
        count: updatedProducts[existingProductIndex].count + 1,
      };
      setProducts([updatedProducts[existingProductIndex], ...products.slice(0, existingProductIndex), ...products.slice(existingProductIndex + 1)]);

    } else {
      setProducts([{ ...productInfo!, count: 1 }, ...products]);
    }

    setBarcode("");
    if (barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
    toast({
      title: "Producto agregado",
      description: `${productInfo!.description} agregado al inventario.`,
    });
  }, [barcode, databaseProducts, products, toast]);

  const handleIncrement = useCallback((barcode: string) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.barcode === barcode
          ? { ...product, count: product.count + 1 }
          : product
      )
    );
  }, []);

  const handleDecrement = useCallback((barcode: string) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.barcode === barcode && product.count > 0
          ? { ...product, count: product.count - 1 }
          : product
      )
    );
  }, []);

  const handleDelete = useCallback((barcode: string) => {
    setProducts(prevProducts => prevProducts.filter(product => product.barcode !== barcode));
  }, []);

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
    const headers = ["Barcode", "Description", "Provider", "Stock", "Count"];
    const rows = data.map((product) => [
      product.barcode,
      product.description,
      product.provider,
      product.stock,
      product.count,
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
    setOpen(true);
  }, []);

  const handleQuantityChange = useCallback((barcode: string, newCount: number) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.barcode === barcode ? { ...product, count: newCount } : product
      )
    );
  }, []);

  const getProductByBarcode = useCallback((barcode: string) => {
    return products.find((product) => product.barcode === barcode);
  }, [products]);

  const handleStockChange = useCallback((barcode: string, newStock: number) => {
    setProducts(prevProducts =>
      prevProducts.map(product =>
        product.barcode === barcode ? { ...product, stock: newStock } : product
      )
    );
  }, []);

  const handleStartEditingStock = (barcode: string) => {
    setSelectedProductBarcode(barcode);
    setOpen(true)
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

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4 text-center">StockCounter Pro</h1>

      <Tabs defaultValue="Contador" className="w-full md:w-[600px] mx-auto">
        <TabsList>
          <TabsTrigger value="Contador" style={{ backgroundColor: "#E3F2FD", color: "#008080" }}>Contador de Existencias</TabsTrigger>
          <TabsTrigger value="Base de Datos" style={{ backgroundColor: "#E3F2FD", color: "#008080" }}>Base de Datos</TabsTrigger>
        </TabsList>
        <TabsContent value="Contador">
          <div className="flex items-center mb-4">
            <Input
              type="number"
              placeholder="Código de barras"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="mr-2 bg-violet-100"
              ref={barcodeInputRef}
              onKeyDown={handleKeyDown}
            />
            <Button
              onClick={handleAddProduct}
              variant="secondary"
              style={{ backgroundColor: "#008080", color: "white" }}
            >
              Agregar
            </Button>
          </div>

          <ScrollArea>
            <Table>
              <TableCaption>Inventario de productos escaneados.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Proveedor
                  </TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-center sm:table-cell hidden">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow
                    key={product.barcode}
                    className={
                      product.count === product.stock ? "bg-green-100" : ""
                    }
                  >
                    <TableCell>{product.description}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {product.provider}
                    </TableCell>
                      <TableCell>
                           
                                  <span
                                      className="cursor-pointer"
                                      onClick={() => handleStartEditingStock(product.barcode)}
                                  >
                                      {product.stock}
                                  </span>
                         
                      </TableCell>
                    <TableCell
                      className="text-right cursor-pointer"
                      onClick={() => handleOpenQuantityDialog(product.barcode)}
                    >
                      {product.count}
                    </TableCell>
                    <TableCell className="text-center sm:table-cell hidden">
                      <Button
                        onClick={() => handleDecrement(product.barcode)}
                        size="icon"
                        variant="outline"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => handleIncrement(product.barcode)}
                        size="icon"
                        variant="outline"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => handleDelete(product.barcode)}
                        size="icon"
                        variant="destructive"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {products.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center">
                      No hay productos agregados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          <div className="mt-4 flex justify-between items-center">
            <Button onClick={handleExport}>Exportar</Button>
          </div>
        </TabsContent>
        <TabsContent value="Base de Datos">
          <ProductDatabase
            databaseProducts={databaseProducts}
            setDatabaseProducts={setDatabaseProducts}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Ajustar Cantidad</DialogTitle>
            <DialogDescription>
              Ajuste la cantidad manualmente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex justify-between items-center">
              <Button
                size="lg"
                onClick={() => {
                  if (selectedProductBarcode) {
                    handleDecrement(selectedProductBarcode);
                  }
                }}
              >
                <Minus className="h-8 w-8" />
              </Button>

              {selectedProductBarcode && (
                <div className="text-4xl font-bold mx-4">
                  {getProductByBarcode(selectedProductBarcode)?.count}
                </div>
              )}

              <Button
                size="lg"
                onClick={() => {
                  if (selectedProductBarcode) {
                    handleIncrement(selectedProductBarcode);
                  }
                }}
              >
                <Plus className="h-8 w-8" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cerrar
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
       <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Ajustar Stock</DialogTitle>
              <DialogDescription>
                Ajuste el stock manualmente.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="flex justify-between items-center">
                  <Input
                      type="number"
                      value={newStockValue}
                      onChange={(e) => setNewStockValue(e.target.value)}
                      className="w-20 text-right"
                  />
                  <Button
                      onClick={() => handleSaveStock(selectedProductBarcode!)}
                      size="sm"
                      className="ml-2"
                  >
                      Guardar
                  </Button>
                </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cerrar
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}