"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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
import { Trash, Edit, Upload, FileDown } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";

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

const CHUNK_SIZE = 200; // Number of products to process per chunk
const DATABASE_NAME = "stockCounterDB";
const OBJECT_STORE_NAME = "products";
const DATABASE_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onerror = () => {
      console.error("Error opening IndexedDB", request.error);
      reject(request.error);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        db.createObjectStore(OBJECT_STORE_NAME, { keyPath: "barcode" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
};

const getAllProductsFromDB = async (): Promise<Product[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE_NAME, "readonly");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
    const request = objectStore.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error("Error getting all products from IndexedDB", request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
};

const addProductsToDB = async (products: Product[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);

    products.forEach(product => {
      objectStore.put(product);
    });

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      console.error("Error adding products to IndexedDB", transaction.error);
      reject(transaction.error);
    };
  });
};

const updateProductInDB = async (product: Product): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
    const request = objectStore.put(product);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      console.error("Error updating product in IndexedDB", request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
};

const deleteProductFromDB = async (barcode: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
    const request = objectStore.delete(barcode);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      console.error("Error deleting product from IndexedDB", request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
};

const clearDatabaseDB = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
    const request = objectStore.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      console.error("Error clearing IndexedDB", request.error);
      reject(request.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
};

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({
  databaseProducts,
  setDatabaseProducts,
}) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [openAlert, setOpenAlert] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const products = await getAllProductsFromDB();
        setDatabaseProducts(products);
      } catch (error) {
        console.error("Failed to load products from IndexedDB", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load products from database.",
        });
      }
    };
    loadInitialData();
  }, [setDatabaseProducts, toast]);


  const onSubmit = useCallback(
    async (data: ProductValues) => {
      const newProduct = { ...data, stock: Number(data.stock), count: 0 };
      try {
        if (selectedProduct) {
          await updateProductInDB(newProduct);
          const updatedProducts = databaseProducts.map((p) =>
            p.barcode === selectedProduct.barcode ? newProduct : p
          );
          setDatabaseProducts(updatedProducts);
          toast({
            title: "Producto actualizado",
            description: `${data.description} ha sido actualizado en la base de datos.`,
          });
        } else {
          await addProductsToDB([newProduct]);
          setDatabaseProducts([...databaseProducts, newProduct]);
          toast({
            title: "Producto agregado",
            description: `${data.description} ha sido agregado a la base de datos.`,
          });
        }
        setOpen(false);
        setSelectedProduct(null);
        productForm.reset();
      } catch (error) {
        console.error("Database operation failed", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to save product to database.",
        });
      }
    },
    [databaseProducts, productForm, selectedProduct, setDatabaseProducts, toast]
  );

  const handleEditProduct = useCallback(
    (product: Product) => {
      setSelectedProduct(product);
      productForm.setValue("barcode", product.barcode);
      productForm.setValue("description", product.description);
      productForm.setValue("provider", product.provider);
      productForm.setValue("stock", product.stock);
      setOpen(true);
    },
    [productForm]
  );

  const handleAddProductToDB = useCallback(() => {
    setSelectedProduct(null);
    productForm.reset();
    setOpen(true);
  }, [productForm]);

  const handleDeleteProductFromDB = useCallback(
    async (barcode: string) => {
      try {
        await deleteProductFromDB(barcode);
        const updatedProducts = databaseProducts.filter(
          (p) => p.barcode !== barcode
        );
        setDatabaseProducts(updatedProducts);
        toast({
          title: "Producto eliminado",
          description: `Producto con código de barras ${barcode} ha sido eliminado de la base de datos.`,
        });
      } catch (error) {
        console.error("Failed to delete product from database", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to delete product from database.",
        });
      }
    },
    [databaseProducts, setDatabaseProducts, toast]
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Por favor, selecciona un archivo.",
        });
        return;
      }

      setIsUploading(true);
      setUploadProgress(0);

      const reader = new FileReader();
      reader.onload = async (event) => {
        const csvData = event.target?.result as string;
        const lines = csvData.split("\n");
        const headers = lines[0].split(",");
        const totalProducts = lines.length - 1;
        let uploadedCount = 0;

        // Function to process a chunk of products
        const processChunk = async (start: number, end: number) => {
          const chunk = lines.slice(start, end);
          const parsedProducts = parseCSV(chunk.join("\n"));
          const totalProductsBeforeUpload = databaseProducts.length;
          const allowedProducts = 4000 - totalProductsBeforeUpload;
          const productsToAdd = parsedProducts.slice(0, allowedProducts); // Limit products to add
          try {
            await addProductsToDB(productsToAdd);

            setDatabaseProducts((prevProducts) => {
              const updatedProducts = [...prevProducts, ...productsToAdd];
              return updatedProducts.slice(0, 4000)
            });
            uploadedCount += productsToAdd.length;
            setUploadProgress(
              Math.min(
                100,
                Math.round((uploadedCount / totalProducts) * 100)
              )
            ); // Ensure progress doesn't exceed 100
          } catch (error) {
            console.error("Failed to add chunk to database", error);
            toast({
              variant: "destructive",
              title: "Error",
              description: "Failed to add chunk to database.",
            });
          }
        };

        // Process chunks sequentially
        for (let i = 1; i < lines.length; i += CHUNK_SIZE) {
          const start = i;
          const end = Math.min(i + CHUNK_SIZE, lines.length);
          await processChunk(start, end);
        }

        setIsUploading(false);
        setUploadProgress(100); // Ensure progress is 100 when finished
        toast({
          title: "Productos cargados",
          description: `${uploadedCount} productos han sido cargados desde el archivo.`,
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = ""; // Reset file input
        }
      };
      reader.readAsText(file);
    },
    [databaseProducts, setDatabaseProducts, toast]
  );

  const parseCSV = useCallback((csvData: string): Product[] => {
    const lines = csvData.split("\n");
    const headers = lines[0].split(",");
    const products: Product[] = [];

    for (let i = 1; i < lines.length; i++) {
      const data = lines[i].split(",");
      if (data.length === headers.length) {
        const barcode = data[0] || "";
        const description = data[1] || "";
        const provider = data[2] || "";
        const stockValue = parseInt(data[3]);
        const stock = isNaN(stockValue) ? 0 : stockValue;

        const product: Product = {
          barcode,
          description,
          provider,
          stock,
          count: 0,
        };
        products.push(product);
      }
    }

    return products;
  }, []);

  const handleExportDatabase = useCallback(() => {
    const csvData = convertToCSV(databaseProducts);
    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "product_database.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [databaseProducts]);

  const convertToCSV = useCallback((data: Product[]) => {
    const headers = ["Barcode", "Description", "Provider", "Stock"];
    const rows = data.map((product) => [
      product.barcode,
      product.description,
      product.provider,
      product.stock,
    ]);

    const csv =
      headers.join(",") +
      "\n" +
      rows.map((row) => row.join(",")).join("\n");
    return csv;
  }, []);

  const handleClearDatabase = useCallback(async () => {
    try {
      await clearDatabaseDB();
      setDatabaseProducts([]);
      toast({
        title: "Base de datos borrada",
        description:
          "Todos los productos han sido eliminados de la base de datos.",
      });
      setOpenAlert(false);
    } catch (error) {
      console.error("Failed to clear database", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to clear database.",
      });
    }
  }, [setDatabaseProducts, toast]);

  return (
    <div>
      <div className="flex justify-between mb-4">
        <Button onClick={handleAddProductToDB}>Agregar Producto</Button>
        <div>
          <Button onClick={handleExportDatabase}>
            Exportar Base de Datos <FileDown className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

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
          ref={fileInputRef}
          disabled={isUploading}
        />
        <Button asChild variant="secondary" disabled={isUploading}>
          <label htmlFor="file-upload" className="flex items-center">
            <Upload className="mr-2 h-4 w-4" />
            Subir Archivo
          </label>
        </Button>
      </div>
      {isUploading && (
        <Progress value={uploadProgress} className="mb-4" />
      )}
      <AlertDialog open={openAlert} onOpenChange={setOpenAlert}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Borrar Base de Datos</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará todos los productos de la base de datos.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={handleClearDatabase}>
              Borrar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
