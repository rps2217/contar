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
import { Trash, Upload, FileDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
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
import { useIsMobile } from "@/hooks/use-mobile";

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
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
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
    } catch (error) {
      reject(error);
    }
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
      console.error("Error updating product in IndexedDB", transaction.error);
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
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openDB();
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
        } catch (error) {
            reject(error);
        }
    });
};

async function fetchGoogleSheetData(sheetUrl: string): Promise<Product[]> {
    // Check if the URL is valid
    try {
        new URL(sheetUrl);
    } catch (error) {
        console.error("Invalid Google Sheet URL", error);
        throw new Error("Invalid Google Sheet URL");
    }

    // Extract the spreadsheet ID and sheet name from the URL
    const urlParts = sheetUrl.split('/');
    const spreadsheetId = urlParts[5];
    const sheetName = urlParts[urlParts.length - 1].split('=')[1];

    // Build the Google Sheets API URL
    const apiUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${sheetName}`;

    try {
        const response = await fetch(apiUrl, {
            mode: 'cors', // Enable CORS
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch data from Google Sheets: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();

        // Extract the JSON data from the response
        const jsonString = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
        const data = JSON.parse(jsonString);

        // Process the data to convert it into the desired format
        const products: Product[] = data.table.rows.map((row: any) => {
            const [barcode, description, provider, stock] = row.c.map((cell: any) => cell?.v);
            return {
                barcode: barcode?.toString() || '',
                description: description?.toString() || '',
                provider: provider?.toString() || '',
                stock: parseInt(stock?.toString() || '0', 10) || 0,
                count: 0,
            };
        });

        return products;
    } catch (error: any) {
        console.error("Error fetching Google Sheet data", error);
        throw new Error(`Failed to fetch data from Google Sheets: ${error.message}`);
    }
}

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
  const isMobile = useIsMobile();
    const [googleSheetUrl, setGoogleSheetUrl] = useState("");


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
      setOpen(false);
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

    const handleLoadFromGoogleSheet = useCallback(async () => {
        setIsUploading(true);
        setUploadProgress(0);
        setUploadComplete(false);
        setProductsLoaded(0);

        try {
            const products = await fetchGoogleSheetData(googleSheetUrl);
            setTotalProducts(products.length);

            for (let i = 0; i < products.length; i++) {
                try {
                    await addProductsToDB([products[i]]);
                    setProductsLoaded((prev) => prev + 1);
                    setUploadProgress(Math.round(((i + 1) / products.length) * 100));
                    await new Promise(resolve => setTimeout(resolve, 0)); // Yield to the event loop
                } catch (error: any) {
                    console.error("Error adding product to IndexedDB", error);
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: `Failed to add product to database: ${products[i].barcode}`,
                    });
                    break; // Stop processing on error
                }
            }

            setIsUploading(false);
            setUploadProgress(100);
            setUploadComplete(true);
            loadInitialData(); // Refresh data after upload
            toast({
                title: "Productos cargados",
                description: `Se han cargado ${products.length} productos desde la hoja de cálculo.`,
            });
        } catch (error: any) {
            setIsUploading(false);
            toast({
                variant: "destructive",
                title: "Error",
                description: `Error loading data from Google Sheets: ${error.message}`,
            });
        }
    }, [setDatabaseProducts, toast, googleSheetUrl]);


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

  const handleOpenEditDialog = (product: Product) => {
    setSelectedProduct(product);
    productForm.reset(product); // populate form with product data
    setOpen(true);
  };

  const handleEditProduct = async (values: ProductValues) => {
    if (!selectedProduct) return;

    const updatedProduct = {
      ...selectedProduct,
      ...values,
      stock: Number(values.stock),
    };

    try {
      await updateProductInDB(updatedProduct);
      setDatabaseProducts((prevProducts) =>
        prevProducts.map((p) =>
          p.barcode === selectedProduct.barcode ? updatedProduct : p
        )
      );
      toast({
        title: "Producto actualizado",
        description: `Producto con código de barras ${selectedProduct.barcode} ha sido actualizado.`,
      });
      setOpen(false); // close dialog
    } catch (error) {
      console.error("Failed to update product", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update product in database.",
      });
    }
  };

  const handleDeleteConfirmation = (product: Product) => {
    setSelectedProduct(product);
    setOpenAlert(true);
  };

  const handleDeleteProduct = async () => {
    if (!selectedProduct) return;

    await handleDeleteProductFromDB(selectedProduct.barcode);
    setOpenAlert(false);
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
        <Label htmlFor="google-sheet-url" className="mr-2">
          Cargar desde Google Sheet:
        </Label>
        <Input
          id="google-sheet-url"
          type="text"
          placeholder="URL de la hoja de Google"
          value={googleSheetUrl}
          onChange={(e) => setGoogleSheetUrl(e.target.value)}
          className="mr-2"
          disabled={isUploading}
        />
        <Button variant="secondary" disabled={isUploading} onClick={handleLoadFromGoogleSheet}>
            <Upload className="mr-2 h-4 w-4" />
            Cargar
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
          <Button variant="destructive" onClick={handleClearDatabase}>Borrar Base de Datos</Button>
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
            <AlertDialogCancel>Cancelar</AlertDialogCancel></AlertDialogFooter>
           <Button variant="destructive" onClick={handleClearDatabase}>
              Borrar
            </Button>
         </AlertDialogContent>
      </AlertDialog>
      <ScrollArea>
        <Table>
          <TableCaption>Lista de productos en la base de datos.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: '33%' }}>Código de Barras</TableHead>
              <TableHead style={{ width: '33%' }}>Descripción</TableHead>
              
              <TableHead style={{ width: '33%' }} className="text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {databaseProducts.map((product) => (
              <TableRow key={product.barcode}>
                <TableCell
                 style={{ width: '33%', cursor: 'pointer' }}
                 onClick={() => handleOpenEditDialog(product)}
                >
                  {product.barcode}
                </TableCell>
                <TableCell style={{ width: '33%' }}>
                  {product.description}
                </TableCell>
                
                <TableCell style={{ width: '33%' }} className="text-right">
                  {product.stock}
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
            <DialogTitle>{selectedProduct ? "Editar Producto" : "Agregar Producto"}</DialogTitle>
            <DialogDescription>
              {selectedProduct ? "Edita los detalles del producto." : "Agrega un nuevo producto a la base de datos."}
            </DialogDescription>
          </DialogHeader>
          <Form {...productForm}>
            <form onSubmit={handleSubmit(selectedProduct ? handleEditProduct : handleAddProductToDB)} className="space-y-4">
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
                  {selectedProduct ? "Guardar cambios" : "Guardar"}
                </Button>
                 {selectedProduct && (
                  
                  <Button variant="destructive" onClick={handleDeleteProduct}>
                    Eliminar
                  </Button>
                 )}
                </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
       <AlertDialog open={openAlert} onOpenChange={setOpenAlert}>
         <AlertDialogContent>
           <AlertDialogHeader>
             <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
             <AlertDialogDescription>
               Esta acción eliminará el producto de la base de datos.
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
    </div>
  );
};

