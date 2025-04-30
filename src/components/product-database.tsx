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
  lastUpdated?: string; // Add lastUpdated property
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

export const openDB = (): Promise<IDBDatabase> => {
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

export const getAllProductsFromDB = async (): Promise<Product[]> => {
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

export const addProductsToDB = async (products: Product[]): Promise<void> => {
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

export const updateProductInDB = async (product: Product): Promise<void> => {
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

export const deleteProductFromDB = async (barcode: string): Promise<void> => {
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

export const clearDatabaseDB = async (): Promise<void> => {
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
    // Ensure the sheet is published to the web as CSV
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;

    try {
        const response = await fetch(csvUrl);

        if (!response.ok) {
            throw new Error(`Failed to fetch data from Google Sheets: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

        // Parse the CSV data
        const lines = csvText.split('\n');
        // Remove quotes from header and trim spaces
        const headers = lines[0].split(',').map(header => header.replace(/"/g, '').trim().toLowerCase());
        const products: Product[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(value => value.replace(/"/g, '').trim());
            const productData: any = {};
            for (let j = 0; j < headers.length; j++) {
                productData[headers[j]] = values[j];
            }

            const barcode = productData.barcode || '';
            const description = productData.description || '';
            const provider = productData.provider || 'Desconocido'; // Default provider if missing
            const stock = parseInt(productData.stock, 10);

            // Basic validation: ensure barcode and description are not empty
            if (barcode && description) {
                 products.push({
                    barcode: barcode,
                    description: description,
                    provider: provider,
                    stock: isNaN(stock) ? 0 : stock, // Default to 0 if stock is NaN
                    count: 0, // Default count
                });
            } else {
                console.warn(`Skipping row ${i + 1} due to missing barcode or description.`);
            }
        }

        return products;
    } catch (error: any) {
        console.error("Error fetching Google Sheet data", error);
         // Check for CORS errors explicitly
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
             throw new Error("CORS policy might be blocking the request. Ensure the Google Sheet is published to the web.");
        }
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

  const loadInitialData = useCallback(async () => {
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
  }, [setDatabaseProducts, toast]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleAddProductToDB = useCallback(async (data: ProductValues) => {
    const newProduct = { ...data, stock: Number(data.stock), count: 0 };
    try {
      await addProductsToDB([newProduct]);
      setDatabaseProducts((prevProducts) => [...prevProducts, newProduct]);
      toast({
        title: "Producto agregado",
        description: `${data.description} ha sido agregado a la base de datos.`,
      });
      reset(); // Reset form after successful submission
      setOpen(false); // Close dialog after successful submission
    } catch (error) {
      console.error("Database operation failed", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save product to database.",
      });
    }
  }, [setDatabaseProducts, toast, reset]);


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
        if (!googleSheetUrl) {
            toast({
                variant: "destructive",
                title: "Error",
                description: "Por favor, introduce la URL de la hoja de Google.",
            });
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);
        setUploadComplete(false);
        setProductsLoaded(0);
        setTotalProducts(0); // Reset total products count

        try {
            const products = await fetchGoogleSheetData(googleSheetUrl);
            setTotalProducts(products.length);

            if (products.length === 0) {
                 toast({
                    title: "No hay productos",
                    description: "La hoja de cálculo está vacía o no tiene el formato correcto.",
                });
                setIsUploading(false);
                return;
            }


            // Clear existing database before loading new data
            // await clearDatabaseDB(); // Consider if this is the desired behavior

            const db = await openDB();
            const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
            const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
            let loadedCount = 0;

            for (const product of products) {
                 const request = objectStore.put(product);
                 request.onsuccess = () => {
                    loadedCount++;
                    setProductsLoaded(loadedCount);
                    setUploadProgress(Math.round((loadedCount / products.length) * 100));
                };
                 request.onerror = () => {
                    console.error("Error adding product to IndexedDB", request.error);
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: `Failed to add product to database: ${product.barcode}`,
                    });
                    // Optionally stop the process on error
                    // transaction.abort();
                    // return;
                };
            }

            transaction.oncomplete = () => {
                db.close();
                setIsUploading(false);
                setUploadProgress(100);
                setUploadComplete(true);
                loadInitialData(); // Refresh data after upload
                toast({
                    title: "Productos cargados",
                    description: `Se han cargado ${loadedCount} productos desde la hoja de cálculo.`,
                });
            };

            transaction.onerror = () => {
                 db.close();
                setIsUploading(false);
                console.error("Transaction error", transaction.error);
                toast({
                    variant: "destructive",
                    title: "Error de transacción",
                    description: "No se pudieron guardar todos los productos.",
                });
            };

        } catch (error: any) {
            setIsUploading(false);
            toast({
                variant: "destructive",
                title: "Error",
                description: `Error loading data from Google Sheets: ${error.message}`,
            });
        }
    }, [setDatabaseProducts, toast, googleSheetUrl, loadInitialData]);


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
      reset(); // Reset form after successful submission
    } catch (error) {
      console.error("Failed to update product", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update product in database.",
      });
    }
  };

  const handleDeleteConfirmation = () => {
    if (!selectedProduct) return;
     handleDeleteProductFromDB(selectedProduct.barcode);
     setOpen(false); // Close the edit dialog
     setOpenAlert(false); // Close the confirmation dialog
  };



  return (
    <div>
      <div className="flex justify-between mb-4">
        <Button onClick={() => { setSelectedProduct(null); reset(); setOpen(true); }}>Agregar Producto</Button>
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
          placeholder="URL de la hoja de Google publicada como CSV"
          value={googleSheetUrl}
          onChange={(e) => setGoogleSheetUrl(e.target.value)}
          className="mr-2"
          disabled={isUploading}
        />
        <Button variant="secondary" disabled={isUploading} onClick={handleLoadFromGoogleSheet}>
            <Upload className="mr-2 h-4 w-4" />
            {isUploading ? 'Cargando...' : 'Cargar'}
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
      {uploadComplete && !isUploading && (
        <p className="text-sm text-green-500">
          Carga completa! Se cargaron {productsLoaded} productos.
        </p>
      )}
      <AlertDialog open={openAlert} onOpenChange={setOpenAlert}>
        <AlertDialogTrigger asChild>
          {/* The trigger is now inside the edit dialog */}
          <span />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
             {selectedProduct && ( // Conditional rendering based on action type
              <AlertDialogDescription>
                {selectedProduct ?
                `Esta acción eliminará el producto "${selectedProduct.description}" de la base de datos. Esta acción no se puede deshacer.`
                 : "Esta acción eliminará todos los productos de la base de datos. Esta acción no se puede deshacer."
                }
              </AlertDialogDescription>
             )}
             {!selectedProduct && ( // Conditional rendering for clearing database
                <AlertDialogDescription>
                    Esta acción eliminará todos los productos de la base de datos. Esta acción no se puede deshacer.
                </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpenAlert(false)}>Cancelar</AlertDialogCancel>
             <Button variant="destructive" onClick={selectedProduct ? handleDeleteConfirmation : handleClearDatabase}>
              {selectedProduct ? "Eliminar Producto" : "Borrar Base de Datos"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        {/* Button to trigger clearing the entire database */}
      <Button variant="destructive" onClick={() => {setSelectedProduct(null); setOpenAlert(true)}}>Borrar Base de Datos</Button>

      <ScrollArea className="h-[500px]">
        <Table>
          <TableCaption>Lista de productos en la base de datos.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: '33%' }}>Código de Barras</TableHead>
              <TableHead style={{ width: '33%' }}>Descripción</TableHead>
              {/* <TableHead className="hidden sm:table-cell">Proveedor</TableHead> */}
              <TableHead style={{ width: '33%' }} className="text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {databaseProducts.map((product) => (
              <TableRow key={product.barcode}>
                <TableCell
                 style={{ width: '33%'}}

                >
                  {product.barcode}
                </TableCell>
                <TableCell
                    style={{ width: '33%', cursor: 'pointer' }}
                    onClick={() => handleOpenEditDialog(product)}
                    >
                  {product.description}
                </TableCell>
                {/* <TableCell className="hidden sm:table-cell">
                  {product.provider}
                </TableCell> */}
                <TableCell style={{ width: '33%' }} className="text-right">
                  {product.stock}
                </TableCell>
              </TableRow>
            ))}
            {databaseProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center"> {/* Adjusted colSpan */}
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
                        readOnly={!!selectedProduct} // Make barcode read-only when editing
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
                          const value = parseInt(e.target.value, 10);
                          field.onChange(isNaN(value) ? "" : value); // Handle NaN, allow empty string for clearing
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <DialogFooter className="flex justify-between w-full">
                    <Button type="submit">
                      {selectedProduct ? "Guardar cambios" : "Guardar"}
                    </Button>
                    {selectedProduct && (
                      <Button type="button" variant="destructive" onClick={() => setOpenAlert(true)}>
                        <Trash className="mr-2 h-4 w-4" /> Eliminar
                      </Button>
                    )}
                     <DialogClose asChild>
                         <Button type="button" variant="secondary">Cancelar</Button>
                    </DialogClose>
                </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

    