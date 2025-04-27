"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Trash, Edit, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Product {
  barcode: string;
  description: string;
  provider: string;
  stock: number;
  count: number;
}

const productSchema = z.object({
  barcode: z.string().min(1, {
    message: "El código de barras es requerido.",
  }),
  description: z.string().min(1, {
    message: "La descripción es requerida.",
  }),
  provider: z.string().min(1, {
    message: "El proveedor es requerido.",
  }),
  stock: z.number().min(0, {
    message: "El stock debe ser mayor o igual a 0.",
  }),
});

type ProductValues = z.infer<typeof productSchema>;

interface ProductDatabaseProps {
  databaseProducts: Product[];
  setDatabaseProducts: (products: Product[]) => void;
}

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({
  databaseProducts,
  setDatabaseProducts,
}) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const productForm = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      barcode: "",
      description: "",
      provider: "",
      stock: 0,
    },
  });

  const { handleSubmit } = productForm;

  const onSubmit = (data: ProductValues) => {
    // Handle adding/editing product in the database
    if (selectedProduct) {
      // Edit existing product
      const updatedProducts = databaseProducts.map((p) =>
        p.barcode === selectedProduct.barcode
          ? { ...data, stock: Number(data.stock), count: 0 }
          : p
      );
      setDatabaseProducts(updatedProducts);
      toast({
        title: "Producto actualizado",
        description: `${data.description} ha sido actualizado en la base de datos.`,
      });
    } else {
      // Add new product
      setDatabaseProducts([
        ...databaseProducts,
        { ...data, stock: Number(data.stock), count: 0 },
      ]);
      toast({
        title: "Producto agregado",
        description: `${data.description} ha sido agregado a la base de datos.`,
      });
    }

    setOpen(false);
    setSelectedProduct(null);
    productForm.reset();
  };

  const handleEditProduct = (product: Product) => {
    setSelectedProduct(product);
    productForm.setValue("barcode", product.barcode);
    productForm.setValue("description", product.description);
    productForm.setValue("provider", product.provider);
    productForm.setValue("stock", product.stock);
    setOpen(true);
  };

  const handleAddProductToDB = () => {
    setSelectedProduct(null);
    productForm.reset();
    setOpen(true);
  };

  const handleDeleteProductFromDB = (barcode: string) => {
    const updatedProducts = databaseProducts.filter(
      (p) => p.barcode !== barcode
    );
    setDatabaseProducts(updatedProducts);
    toast({
      title: "Producto eliminado",
      description: `Producto con código de barras ${barcode} ha sido eliminado de la base de datos.`,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, selecciona un archivo.",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const csvData = event.target?.result as string;
      const parsedProducts = parseCSV(csvData);
      setDatabaseProducts([...databaseProducts, ...parsedProducts]);
      toast({
        title: "Productos cargados",
        description: `${parsedProducts.length} productos han sido cargados desde el archivo.`,
      });
    };
    reader.readAsText(file);
  };

  const parseCSV = (csvData: string): Product[] => {
    const lines = csvData.split("\n");
    const headers = lines[0].split(",");
    const products: Product[] = [];

    for (let i = 1; i < lines.length; i++) {
      const data = lines[i].split(",");
      if (data.length === headers.length) {
        const product: Product = {
          barcode: data[0],
          description: data[1],
          provider: data[2],
          stock: parseInt(data[3]),
          count: 0,
        };
        products.push(product);
      }
    }

    return products;
  };

  return (
    <div>
      {/* Add Product Button */}
      <div className="flex justify-end mb-4">
        <Button onClick={handleAddProductToDB}>Agregar Producto</Button>
      </div>

      {/* File Upload */}
      <div className="flex items-center mb-4">
        <Label htmlFor="file-upload" className="mr-2">
          Cargar desde CSV:
        </Label>
        <Input
          id="file-upload"
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="hidden"
        />
        <Button asChild variant="secondary">
          <label htmlFor="file-upload" className="flex items-center">
            <Upload className="mr-2 h-4 w-4" />
            Subir Archivo
          </label>
        </Button>
      </div>

      {/* Product Database Table */}
      <ScrollArea>
        <Table>
          <TableCaption>Lista de productos en la base de datos.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Código de Barras</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-center">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {databaseProducts.map((product) => (
              <TableRow key={product.barcode}>
                <TableCell>{product.barcode}</TableCell>
                <TableCell>{product.description}</TableCell>
                <TableCell>{product.provider}</TableCell>
                <TableCell className="text-right">{product.stock}</TableCell>
                <TableCell className="text-center">
                  <Button
                    onClick={() => handleEditProduct(product)}
                    size="icon"
                    variant="outline"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => handleDeleteProductFromDB(product.barcode)}
                    size="icon"
                    variant="destructive"
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {databaseProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  No hay productos en la base de datos.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Edit/Add Product Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {selectedProduct ? "Editar Producto" : "Agregar Producto"}
            </DialogTitle>
            <DialogDescription>
              {selectedProduct
                ? "Edita la información del producto."
                : "Agrega un nuevo producto a la base de datos."}
            </DialogDescription>
          </DialogHeader>
          <Form {...productForm}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={productForm.control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código de Barras</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Código de barras"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Descripción del producto"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Proveedor</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Proveedor"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={productForm.control}
                name="stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Stock"
                        {...field}
                        onChange={(e) => {
                          field.onChange(Number(e.target.value));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit">
                  {selectedProduct ? "Actualizar" : "Guardar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
