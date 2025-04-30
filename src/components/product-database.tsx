
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
import { Trash, Upload, FileDown, Filter } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        const store = db.createObjectStore(OBJECT_STORE_NAME, { keyPath: "barcode" });
        // Add index for provider for potential filtering optimizations
        store.createIndex("provider", "provider", { unique: false });
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

      let completedRequests = 0;
      const totalRequests = products.length;

      const checkCompletion = () => {
        completedRequests++;
        if (completedRequests === totalRequests) {
          resolve(); // Resolve the main promise when all put requests are done
        }
      };

      products.forEach(product => {
        const request = objectStore.put(product);
        request.onsuccess = checkCompletion;
        request.onerror = () => {
            console.error("Error adding product to IndexedDB", request.error);
            // Optionally reject or continue, depending on desired behavior
            checkCompletion(); // Ensure completion check even on error
        };
      });

      transaction.oncomplete = () => {
        console.log("Transaction completed for adding products.");
        db.close();
      };

      transaction.onerror = () => {
        console.error("Error adding products to IndexedDB", transaction.error);
        db.close();
        reject(transaction.error);
      };
    } catch (error) {
       console.error("Failed to open DB for adding products", error);
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
                 console.log("Database cleared successfully.");
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
             console.error("Failed to open DB for clearing", error);
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
        throw new Error("URL de Hoja de Google inválida");
    }

    const spreadsheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)\//);
    const sheetGidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);

    if (!spreadsheetIdMatch || !spreadsheetIdMatch[1]) {
        throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL.");
    }
    const spreadsheetId = spreadsheetIdMatch[1];
    const gid = sheetGidMatch ? sheetGidMatch[1] : '0'; // Default to first sheet if gid is missing

    // Build the Google Sheets API URL for CSV export
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;

    console.log("Attempting to fetch Google Sheet CSV from:", csvUrl);

    try {
        const response = await fetch(csvUrl);

        if (!response.ok) {
             console.error(`Failed to fetch data: ${response.status} ${response.statusText}`);
             const errorText = await response.text(); // Attempt to get more error details
             console.error("Error response body:", errorText);
            // Try to provide a more user-friendly error based on status
             if (response.status === 404) {
                 throw new Error(`Error al obtener datos: Hoja no encontrada o no publicada como CSV (Verifique la URL y la configuración de uso compartido).`);
             } else if (response.status === 403) {
                  throw new Error(`Error al obtener datos: Permiso denegado. Asegúrese de que la hoja esté publicada en la web como CSV.`);
             }
            throw new Error(`Error al obtener datos de Google Sheets: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();
        console.log("Successfully fetched CSV data.");

        // Parse the CSV data
        const lines = csvText.split(/\r?\n/); // Split by newline, handling Windows/Unix endings
        if (lines.length < 1) {
            console.warn("CSV data is empty or invalid.");
            return [];
        }

        // Remove quotes from header and trim spaces, convert to lowercase for consistency
        const headers = lines[0].split(',').map(header => header.replace(/^"|"$/g, '').trim().toLowerCase());
        console.log("CSV Headers:", headers);
        const products: Product[] = [];

        // Ensure required headers are present
        const requiredHeaders = ['barcode', 'description', 'stock']; // Provider is optional
        for (const reqHeader of requiredHeaders) {
            if (!headers.includes(reqHeader)) {
                 console.error(`Required header "${reqHeader}" not found in CSV.`);
                throw new Error(`Encabezado requerido "${reqHeader}" no encontrado en el archivo CSV.`);
            }
        }

        const barcodeIndex = headers.indexOf('barcode');
        const descriptionIndex = headers.indexOf('description');
        const providerIndex = headers.indexOf('provider'); // Can be -1 if not present
        const stockIndex = headers.indexOf('stock');


        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue; // Skip empty lines

            // Basic CSV parsing, might need a more robust library for complex CSVs
             // This simple split won't handle commas within quoted fields correctly
             // Consider using a library like Papaparse for robust CSV parsing if needed
            const values = line.split(',').map(value => value.replace(/^"|"$/g, '').trim());

            if (values.length < requiredHeaders.length) {
                console.warn(`Skipping row ${i + 1} due to insufficient columns.`);
                continue;
            }

            const barcode = values[barcodeIndex];
            const description = values[descriptionIndex];
            const provider = providerIndex !== -1 ? (values[providerIndex] || "Desconocido") : "Desconocido"; // Default provider
            const stockStr = values[stockIndex];
            const stock = parseInt(stockStr, 10);

            // Basic validation
            if (!barcode) {
                console.warn(`Skipping row ${i + 1} due to missing barcode.`);
                continue;
            }
            if (!description) {
                 console.warn(`Skipping row ${i + 1} due to missing description.`);
                continue;
            }
             if (isNaN(stock)) {
                 console.warn(`Skipping row ${i + 1} due to invalid stock value: "${stockStr}". Setting stock to 0.`);
             }

             products.push({
                barcode: barcode,
                description: description,
                provider: provider,
                stock: isNaN(stock) ? 0 : stock, // Default to 0 if stock is NaN
                count: 0, // Default count
            });
        }
        console.log(`Parsed ${products.length} products from CSV.`);
        return products;
    } catch (error: any) {
        console.error("Error fetching or parsing Google Sheet data", error);
         // Check for CORS errors explicitly (though less likely with direct CSV export URL)
        if (error instanceof TypeError && error.message.includes('fetch')) {
             // This might indicate a network issue or CORS if the URL was incorrect/redirected unexpectedly
             throw new Error("Error de red al intentar obtener la hoja. Verifique la URL y su conexión a Internet.");
        }
        // Re-throw original or specific error message
        throw new Error(error.message || `Error al obtener datos de Google Sheets.`);
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
  const [alertAction, setAlertAction] = useState<'deleteProduct' | 'clearDatabase' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const [productsLoaded, setProductsLoaded] = useState(0);
  const isMobile = useIsMobile();
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all"); // 'all' means no filter


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
        description: "Error al cargar productos de la base de datos.",
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
        description: "Error al guardar el producto en la base de datos.",
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
        description: "Error al actualizar el producto en la base de datos.",
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
          description: "Error al eliminar el producto de la base de datos.",
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


            // Clear existing database before loading new data? - Decided against auto-clear
            // Consider adding a confirmation dialog if you want to clear first.
            // await clearDatabaseDB();

            await addProductsToDB(products); // Use the bulk add function

            // Update progress - since addProductsToDB handles bulk, we show 100% on success
            setProductsLoaded(products.length);
            setUploadProgress(100);
            setIsUploading(false);
            setUploadComplete(true);
            loadInitialData(); // Refresh data after upload
            toast({
                title: "Productos cargados",
                description: `Se han cargado ${products.length} productos desde la hoja de cálculo.`,
            });

        } catch (error: any) {
            setIsUploading(false);
            console.error("Error during Google Sheet load process:", error);
            toast({
                variant: "destructive",
                title: "Error de carga",
                description: error.message || `Error al cargar datos desde Google Sheets.`,
                duration: 9000, // Show longer for potentially complex errors
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
      `"${product.description.replace(/"/g, '""')}"`, // Handle quotes in description
      `"${product.provider.replace(/"/g, '""')}"`, // Handle quotes in provider
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
      setOpenAlert(false); // Close the confirmation dialog
      setAlertAction(null); // Reset alert action
    } catch (error) {
      console.error("Failed to clear database", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al borrar la base de datos.",
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
        description: "Error al actualizar el producto en la base de datos.",
      });
    }
  };

  const handleDeleteConfirmation = () => {
    if (alertAction === 'deleteProduct' && selectedProduct) {
      handleDeleteProductFromDB(selectedProduct.barcode);
      setOpen(false); // Close the edit dialog if open
    } else if (alertAction === 'clearDatabase') {
      handleClearDatabase();
    }
    setOpenAlert(false); // Close the confirmation dialog
    setAlertAction(null); // Reset alert action
  };

  const triggerDeleteProductAlert = () => {
      if (!selectedProduct) return;
      setAlertAction('deleteProduct');
      setOpenAlert(true);
  };

  const triggerClearDatabaseAlert = () => {
      setAlertAction('clearDatabase');
      setOpenAlert(true);
  };

  const filteredProducts = databaseProducts.filter(product => {
      const matchesSearch = searchTerm === "" ||
                            product.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            product.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesProvider = selectedProviderFilter === 'all' || product.provider === selectedProviderFilter;

      return matchesSearch && matchesProvider;
  });

  const providerOptions = ["all", ...Array.from(new Set(databaseProducts.map(p => p.provider)))];


  return (
    <div>
      <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
        <Button onClick={() => { setSelectedProduct(null); reset(); setOpen(true); }}>Agregar Producto</Button>
        <div className="flex items-center gap-2">
           <Label htmlFor="search-product" className="sr-only">Buscar Producto</Label>
            <Input
                id="search-product"
                type="text"
                placeholder="Buscar por código o descripción..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-xs"
            />
            <Select value={selectedProviderFilter} onValueChange={setSelectedProviderFilter}>
                <SelectTrigger className="w-[180px]">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Filtrar proveedor" />
                </SelectTrigger>
                <SelectContent>
                    {providerOptions.map(provider => (
                        <SelectItem key={provider} value={provider}>
                            {provider === 'all' ? 'Todos los proveedores' : provider}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
          <Button onClick={handleExportDatabase} variant="outline">
            Exportar <FileDown className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center mb-4 gap-2">
        <Label htmlFor="google-sheet-url" className="shrink-0">
          Cargar desde Google Sheet:
        </Label>
        <Input
          id="google-sheet-url"
          type="text"
          placeholder="URL de la hoja de Google publicada como CSV"
          value={googleSheetUrl}
          onChange={(e) => setGoogleSheetUrl(e.target.value)}
          className="flex-grow min-w-[200px]"
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
        {/* Trigger is handled programmatically */}
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              {alertAction === 'deleteProduct' && selectedProduct ?
                `Esta acción eliminará el producto "${selectedProduct.description}" de la base de datos. Esta acción no se puede deshacer.`
                 : alertAction === 'clearDatabase' ?
                 "Esta acción eliminará todos los productos de la base de datos. Esta acción no se puede deshacer."
                 : "Esta acción no se puede deshacer." // Default message
                }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpenAlert(false)}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDeleteConfirmation}>
              {alertAction === 'deleteProduct' ? "Eliminar Producto" : "Borrar Base de Datos"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        {/* Button to trigger clearing the entire database */}
      <Button variant="destructive" onClick={triggerClearDatabaseAlert}>Borrar Base de Datos</Button>

      <ScrollArea className="h-[calc(100vh-400px)] mt-4 border rounded-lg">
        <Table>
          <TableCaption>Lista de productos en la base de datos.</TableCaption>
           <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[25%]">Código de Barras</TableHead>
              <TableHead className="w-[35%]">Descripción</TableHead>
              <TableHead className="hidden sm:table-cell w-[25%]">Proveedor</TableHead>
              <TableHead className="w-[15%] text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map((product) => (
              <TableRow key={product.barcode} className="hover:bg-gray-50">
                <TableCell
                 className="w-[25%] font-medium"

                >
                  {product.barcode}
                </TableCell>
                <TableCell
                    className="w-[35%] cursor-pointer hover:text-teal-700 hover:underline"
                    onClick={() => handleOpenEditDialog(product)}
                    >
                  {product.description}
                </TableCell>
                 <TableCell className="hidden sm:table-cell w-[25%] text-gray-600">
                  {product.provider}
                </TableCell>
                <TableCell className="w-[15%] text-right text-gray-600">
                  {product.stock}
                </TableCell>
              </TableRow>
            ))}
            {filteredProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={isMobile ? 3 : 4} className="text-center py-10 text-gray-500">
                  {databaseProducts.length > 0 ? "No hay productos que coincidan con la búsqueda/filtro." : "No hay productos en la base de datos."}
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
               <DialogFooter className="flex justify-between w-full pt-4">
                    <Button type="submit">
                      {selectedProduct ? "Guardar cambios" : "Guardar"}
                    </Button>
                    {selectedProduct && (
                      <Button type="button" variant="destructive" onClick={triggerDeleteProductAlert}>
                        <Trash className="mr-2 h-4 w-4" /> Eliminar
                      </Button>
                    )}
                     <DialogClose asChild>
                         <Button type="button" variant="outline">Cancelar</Button>
                    </DialogClose>
                </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

    