"use client";

import { useState, useRef, useEffect } from "react";
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
  const [databaseProducts, setDatabaseProducts] =
    useState<Product[]>(initialProducts); // Simulate database
  const { toast } = useToast();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedProductBarcode, setSelectedProductBarcode] = useState<
    string | null
  >(null);

  useEffect(() => {
    // Focus the input on initial load
    barcodeInputRef.current?.focus();
  }, []);

  const handleAddProduct = async () => {
    if (!barcode) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un código de barras.",
      });
      return;
    }

    // Fetch product info from the database based on barcode
    let productInfo = databaseProducts.find((p) => p.barcode === barcode);

    if (!productInfo) {
      // If product doesn't exist, create a new product with the barcode as the description
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

    // Check if product already exists in the list
    const existingProductIndex = products.findIndex(
      (p) => p.barcode === productInfo!.barcode
    );

    if (existingProductIndex !== -1) {
      // If product exists, update the count
      const updatedProducts = [...products];
      updatedProducts[existingProductIndex] = {
        ...updatedProducts[existingProductIndex],
        count: updatedProducts[existingProductIndex].count + 1,
      };
      setProducts(updatedProducts);
    } else {
      // If product doesn't exist, add it to the beginning of the list
      setProducts([{ ...productInfo!, count: 1 }, ...products]);
    }

    setBarcode("");
    // Refocus on the input after adding the product
    if (barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
    toast({
      title: "Producto agregado",
      description: `${productInfo!.description} agregado al inventario.`,
    });
  };

  const handleIncrement = (barcode: string) => {
    setProducts(
      products.map((product) =>
        product.barcode === barcode
          ? { ...product, count: product.count + 1 }
          : product
      )
    );
  };

  const handleDecrement = (barcode: string) => {
    setProducts(
      products.map((product) =>
        product.barcode === barcode && product.count > 0
          ? { ...product, count: product.count - 1 }
          : product
      )
    );
  };

  const handleDelete = (barcode: string) => {
    setProducts(products.filter((product) => product.barcode !== barcode));
  };

  const handleExport = () => {
    // Implement export functionality here (e.g., to CSV or Excel)
    alert("Exportar a Excel/CSV");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddProduct();
    }
  };

  const totalCount = products.reduce((acc, product) => acc + product.count, 0);

  const handleOpenQuantityDialog = (barcode: string) => {
    setSelectedProductBarcode(barcode);
    setOpen(true);
  };

  const handleQuantityChange = (barcode: string, newCount: number) => {
    setProducts(
      products.map((product) =>
        product.barcode === barcode ? { ...product, count: newCount } : product
      )
    );
  };

  const getProductByBarcode = (barcode: string) => {
    return products.find((product) => product.barcode === barcode);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4 text-center">StockCounter Pro</h1>

      <Tabs defaultValue="Contador" className="w-full md:w-[600px] mx-auto">
        <TabsList>
          <TabsTrigger value="Contador">Contador de Existencias</TabsTrigger>
          <TabsTrigger value="Base de Datos">Base de Datos</TabsTrigger>
        </TabsList>
        <TabsContent value="Contador">
          {/* Barcode Input */}
          <div className="flex items-center mb-4">
            <Input
              type="number"
              placeholder="Código de barras"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="mr-2 bg-violet-100"
              ref={barcodeInputRef} // Attach the ref to the input
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

          {/* Inventory Table */}
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
                  <TableHead className="text-center">Acciones</TableHead>
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
                    <TableCell>{product.stock}</TableCell>
                    <TableCell
                      className="text-right cursor-pointer"
                      onClick={() => handleOpenQuantityDialog(product.barcode)}
                    >
                      {product.count}
                    </TableCell>
                    <TableCell className="text-center">
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

          {/* Count Export */}
          <div className="mt-4 flex justify-between items-center">
            <Button onClick={handleExport}>Exportar</Button>
            <div>Total de productos: {totalCount}</div>
          </div>
        </TabsContent>
        <TabsContent value="Base de Datos">
          <ProductDatabase
            databaseProducts={databaseProducts}
            setDatabaseProducts={setDatabaseProducts}
          />
        </TabsContent>
      </Tabs>
      {/* Quantity adjustment dialog */}
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
    </div>
  );
}

