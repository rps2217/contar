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
      reject(transaction.error);
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
      console.error("Error deleting product from IndexedDB", transaction.error);
      reject(transaction.error);
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
      reject(transaction.error);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
};

const parseCSV = (csvData: string): Product[] => {
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
  const [uploadComplete, setUploadComplete] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
    const [productsLoaded, setProductsLoaded] = useState(0);
    const [editingBarcode, setEditingBarcode] = useState<string | null>(null);
    const [editedProduct, setEditedProduct] = useState<Product | null>(null);

  const productForm = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      barcode: "",
      description: "",
      provider: "",
      stock: 0,
    },
  });

  const { handleSubmit, reset } = productForm;

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

  useEffect(() => {
    loadInitialData();
  }, [setDatabaseProducts, toast]);

  const handleAddProductToDB = useCallback(async (data: ProductValues) => {
    const newProduct = { ...data, stock: Number(data.stock), count: 0 };
    try {
      await addProductsToDB([newProduct]);
      setDatabaseProducts((prevProducts) => [...prevProducts, newProduct]);
      toast({
        title: "Producto agregado",
        description: `${data.description} ha sido agregado a la base de datos.`,
      });
    } catch (error) {
      console.error("Database operation failed", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save product to database.",
      });
    }
  }, [setDatabaseProducts, toast]);

    const handleSaveProduct = useCallback(async (product: Product) => {
        try {
            await updateProductInDB(product);
            setDatabaseProducts(prevProducts =>
                prevProducts.map(p =>
                    p.barcode === product.barcode ? product : p
                )
            );
            toast({
                title: "Producto actualizado",
                description: `Producto con código de barras ${product.barcode} ha sido actualizado.`,
            });
        } catch (error) {
            console.error("Failed to update product", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to update product in database.",
            });
        }
    }, [setDatabaseProducts, toast]);

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
      setUploadComplete(false);
            setProductsLoaded(0);

      const reader = new FileReader();
      reader.onload = async (event) => {
        const csvData = event.target?.result as string;
        const lines = csvData.split('\n');
                setTotalProducts(lines.length - 1); // Exclude headers

        let processedCount = 0;
        let productsToLoad: Product[] = [];
        for (let i = 1; i < lines.length; i++) {
          const data = lines[i].split(',');
          if (data.length === 4) {
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
            productsToLoad.push(product);
            processedCount++;

            if (processedCount % CHUNK_SIZE === 0 || i === lines.length - 1) {
              try {
                await addProductsToDB(productsToLoad);
                                setProductsLoaded((prev) => prev + productsToLoad.length);
                setUploadProgress(Math.round((i / (lines.length - 1)) * 100));
                productsToLoad = [];
                await new Promise(resolve => setTimeout(resolve, 0)); // Yield to the event loop
              } catch (error: any) {
                console.error("Error adding product to IndexedDB", error);
                toast({
                  variant: "destructive",
                  title: "Error",
                  description: `Failed to add product to database: ${barcode}`,
                });
                break; // Stop processing on error
              }
            }
          }
        }
        setIsUploading(false);
        setUploadProgress(100);
        setUploadComplete(true);
        loadInitialData(); // Refresh data after upload
        toast({
          title: "Productos cargados",
          description: `Se han cargado ${processedCount} productos desde el archivo.`,
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = ""; // Reset file input
        }
      };
      reader.onerror = () => {
        setIsUploading(false);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Error reading the file.",
        });
      };
      reader.readAsText(file);
    },
    [setDatabaseProducts, toast]
  );


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

      const startEditing = useCallback((product: Product) => {
          setEditingBarcode(product.barcode);
          setEditedProduct({ ...product });
      }, []);

      const cancelEditing = useCallback(() => {
          setEditingBarcode(null);
          setEditedProduct(null);
      }, []);

      const saveProduct = useCallback(async (barcode: string) => {
          if (!editedProduct) return;

          try {
              await updateProductInDB(editedProduct);
              const updatedProducts = databaseProducts.map(p =>
                  p.barcode === barcode ? editedProduct : p
              );
              setDatabaseProducts(updatedProducts);
              toast({
                  title: "Producto actualizado",
                  description: `Producto con código de barras ${barcode} ha sido actualizado.`,
              });
              setEditingBarcode(null);
              setEditedProduct(null);
          } catch (error) {
              console.error("Failed to update product", error);
              toast({
                  variant: "destructive",
                  title: "Error",
                  description: "Failed to update product in database.",
              });
          }
      }, [databaseProducts, setDatabaseProducts, toast, editedProduct]);

  const handleAddProduct = async (values: ProductValues) => {
    await handleAddProductToDB(values);
    reset();
  };

  return (
    <div>
      <div className="flex justify-between mb-4">
        <Button onClick={() => setOpen(true)}>Agregar Producto</Button>
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
        <>
          <Progress value={uploadProgress} className="mb-4" />
                    <p className="text-sm text-blue-500">
                        Cargando {productsLoaded} de {totalProducts} productos...
                    </p>
        </>
      )}
      {uploadComplete && (
        <p className="text-sm text-green-500">
          Carga completa!
        </p>
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
                <TableCell>
                                        {editingBarcode === product.barcode ? (
                                            <Input
                                                type="text"
                                                value={editedProduct?.barcode || ""}
                                                onChange={(e) => setEditedProduct({ ...editedProduct, barcode: e.target.value } as Product)}
                                            />
                                        ) : (
                                            product.barcode
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingBarcode === product.barcode ? (
                                            <Textarea
                                                value={editedProduct?.description || ""}
                                                onChange={(e) => setEditedProduct({ ...editedProduct, description: e.target.value } as Product)}
                                            />
                                        ) : (
                                            product.description
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingBarcode === product.barcode ? (
                                            <Input
                                                type="text"
                                                value={editedProduct?.provider || ""}
                                                onChange={(e) => setEditedProduct({ ...editedProduct, provider: e.target.value } as Product)}
                                            />
                                        ) : (
                                            product.provider
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingBarcode === product.barcode ? (
                                            <Input
                                                type="number"
                                                value={editedProduct?.stock?.toString() || ""}
                                                onChange={(e) => setEditedProduct({ ...editedProduct, stock: Number(e.target.value) } as Product)}
                                            />
                                        ) : (
                                            product.stock
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {editingBarcode === product.barcode ? (
                                            <>
                                                <Button
                                                    onClick={() => saveProduct(editedProduct as Product)}
                                                    size="icon"
                                                    variant="outline"
                                                >
                                                    Guardar
                                                </Button>
                                                <Button
                                                    onClick={cancelEditing}
                                                    size="icon"
                                                    variant="ghost"
                                                >
                                                    Cancelar
                                                </Button>
                                            </>
                                        ) : (
                                            <>
                                                <Button
                                                    onClick={() => startEditing(product)}
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
                                            </>
                                        )}
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
            <DialogTitle>Agregar Producto</DialogTitle>
            <DialogDescription>
              Agrega un nuevo producto a la base de datos.
            </DialogDescription>
          </DialogHeader>
          <Form {...productForm}>
            <form onSubmit={handleSubmit(handleAddProduct)} className="space-y-4">
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
                    Guardar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
