"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Minus, Trash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Product {
  barcode: string;
  description: string;
  provider: string;
  stock: number;
  count: number;
}

export default function Home() {
  const [barcode, setBarcode] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const { toast } = useToast();

  const handleAddProduct = async () => {
    if (!barcode) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un código de barras.",
      });
      return;
    }

    // Simulate fetching product info from the database based on barcode
    const productInfo = await getProductInfo(barcode);

    if (productInfo) {
      // Check if product already exists in the list
      const existingProductIndex = products.findIndex((p) => p.barcode === productInfo.barcode);

      if (existingProductIndex !== -1) {
        // If product exists, update the count
        const updatedProducts = [...products];
        updatedProducts[existingProductIndex] = {
          ...updatedProducts[existingProductIndex],
          count: updatedProducts[existingProductIndex].count + 1,
        };
        setProducts(updatedProducts);
      } else {
        // If product doesn't exist, add it to the list
        setProducts([...products, { ...productInfo, count: 1 }]);
      }

      setBarcode("");
      toast({
        title: "Producto agregado",
        description: `${productInfo.description} agregado al inventario.`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Producto no encontrado.",
      });
    }
  };


  const getProductInfo = async (barcode: string) => {
    // Mock data - replace with actual database lookup
    // Simulate an asynchronous operation (e.g., fetching from a database)
    return new Promise<Product | null>((resolve) => {
      setTimeout(() => {
        switch (barcode) {
          case "12345":
            resolve({ barcode: "12345", description: "Paracetamol 500mg", provider: "Genfar", stock: 100 });
            break;
          case "67890":
            resolve({ barcode: "67890", description: "Amoxicilina 250mg", provider: "MK", stock: 50 });
            break;
          default:
            resolve(null);
        }
      }, 500); // Simulate a 500ms delay
    });
  };

  const handleIncrement = (barcode: string) => {
    setProducts(
      products.map((product) =>
        product.barcode === barcode ? { ...product, count: product.count + 1 } : product
      )
    );
  };

  const handleDecrement = (barcode: string) => {
    setProducts(
      products.map((product) =>
        product.barcode === barcode && product.count > 0 ? { ...product, count: product.count - 1 } : product
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

  const totalCount = products.reduce((sum, product) => sum + product.count, 0);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4 text-center">StockCounter Pro</h1>

      {/* Barcode Input */}
      <div className="flex items-center mb-4">
        <Input
          type="text"
          placeholder="Código de barras"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          className="mr-2"
        />
        <Button onClick={handleAddProduct} variant="secondary">Agregar</Button>
      </div>

      {/* Inventory Table */}
      <Table>
        <TableCaption>Inventario de productos escaneados.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Descripción</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-center">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.barcode}>
              <TableCell>{product.description}</TableCell>
              <TableCell>{product.provider}</TableCell>
              <TableCell className="text-right">{product.count}</TableCell>
              <TableCell className="text-center">
                <Button onClick={() => handleDecrement(product.barcode)} size="icon" variant="outline">
                  <Minus className="h-4 w-4" />
                </Button>
                <Button onClick={() => handleIncrement(product.barcode)} size="icon" variant="outline">
                  <Plus className="h-4 w-4" />
                </Button>
                <Button onClick={() => handleDelete(product.barcode)} size="icon" variant="destructive">
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

      {/* Count Export */}
      <div className="mt-4 flex justify-between items-center">
        <p className="font-bold">Total de productos: {totalCount}</p>
        <Button onClick={handleExport}>Exportar</Button>
      </div>
    </div>
  );
}
