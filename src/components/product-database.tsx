
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
import { Trash, Upload, FileDown, Filter, SheetIcon, Edit, Save } from "lucide-react"; // Added Edit, Save
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
  AlertDialogAction,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Product } from '@/types/product'; // Import Product type


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
  setDatabaseProducts: (products: Product[] | ((prevProducts: Product[]) => Product[])) => void; // Allow functional updates
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
    if (!products || products.length === 0) {
        return Promise.resolve();
    }

    return new Promise(async (resolve, reject) => {
        let db: IDBDatabase | null = null;
        try {
            db = await openDB();
            const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
            const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
            let completedRequests = 0;
            const totalRequests = products.length;

            const checkCompletion = () => {
                completedRequests++;
                if (completedRequests === totalRequests) {
                    // Resolve *after* transaction completes for full certainty
                }
            };

            products.forEach(product => {
                 // Basic validation before adding
                 if (!product || typeof product.barcode !== 'string' || product.barcode.trim() === '') {
                    console.warn('Skipping invalid product:', product);
                    checkCompletion(); // Still count it as processed
                    return;
                 }
                 // Ensure stock is a number before putting into DB
                 const productToAdd = {
                     ...product,
                     stock: Number(product.stock) || 0, // Default to 0 if NaN or invalid
                     count: Number(product.count) || 0 // Also ensure count is a number
                 };
                const request = objectStore.put(productToAdd);
                request.onsuccess = checkCompletion;
                request.onerror = (event) => {
                    console.error("Error adding product to IndexedDB", (event.target as IDBRequest).error, productToAdd);
                    checkCompletion(); // Still count it as processed
                };
            });

            transaction.oncomplete = () => {
                console.log(`Transaction completed for adding ${totalRequests} products.`);
                db?.close(); // Use optional chaining
                resolve(); // Resolve here ensures all writes are done
            };

            transaction.onerror = () => {
                console.error("Transaction error adding products to IndexedDB", transaction.error);
                db?.close(); // Use optional chaining
                reject(transaction.error);
            };
        } catch (error) {
            console.error("Failed to open DB for adding products", error);
             db?.close(); // Use optional chaining in case of error during open
            reject(error);
        }
    });
};


export const updateProductInDB = async (product: Product): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
    // Ensure stock is a number before updating DB
    const productToUpdate = {
        ...product,
        stock: Number(product.stock) || 0, // Default to 0 if NaN or invalid
        count: Number(product.count) || 0 // Also ensure count is a number
    };
    const request = objectStore.put(productToUpdate);

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
        let db: IDBDatabase | null = null;
        try {
            db = await openDB();
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
                db?.close();
            };
        } catch (error) {
             console.error("Failed to open DB for clearing", error);
             db?.close();
            reject(error);
        }
    });
};

// Helper function to parse Google Sheet URL
const parseGoogleSheetUrl = (sheetUrl: string): { spreadsheetId: string | null; gid: string } => {
    try {
        new URL(sheetUrl); // Basic URL validation
    } catch (error) {
        console.error("Invalid Google Sheet URL provided", error);
        throw new Error("URL de Hoja de Google inválida.");
    }

    const spreadsheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)\//);
    const sheetGidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);

    const spreadsheetId = spreadsheetIdMatch ? spreadsheetIdMatch[1] : null;
    const gid = sheetGidMatch ? sheetGidMatch[1] : '0'; // Default to first sheet (gid=0)

    return { spreadsheetId, gid };
};

// Fetches and parses data from a publicly accessible Google Sheet CSV export URL
async function fetchGoogleSheetData(sheetUrl: string): Promise<Product[]> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrl);

    if (!spreadsheetId) {
        throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL. Asegúrese de que la URL sea correcta.");
    }

    // Construct the CSV export URL
    // This requires the sheet to be publicly accessible ("Anyone with the link can view")
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;

    console.log("Attempting to fetch Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        response = await fetch(csvExportUrl, {
            mode: 'cors', // Ensure CORS is handled correctly if necessary
            headers: {
                'Accept': 'text/csv',
            },
        });
    } catch (error: any) {
        // Network errors (e.g., CORS if redirected unexpectedly, DNS issues)
        console.error("Network error fetching Google Sheet:", error);
        throw new Error("Error de red al intentar obtener la hoja. Verifique la URL, su conexión a Internet y la configuración de uso compartido de la hoja (debe ser accesible públicamente con el enlace).");
    }

    if (!response.ok) {
        console.error(`Failed to fetch Google Sheet data: ${response.status} ${response.statusText}`);
        const errorText = await response.text().catch(() => "Could not read error response body."); // Attempt to get more details
        console.error("Error response body:", errorText);

        let userMessage = `Error ${response.status} al obtener datos de Google Sheets.`;
        if (response.status === 400) {
             userMessage += " Verifique que la URL y el GID sean correctos.";
        } else if (response.status === 403) {
             userMessage += " Acceso denegado. Asegúrese de que la hoja sea pública ('Cualquier persona con el enlace puede ver').";
        } else if (response.status === 404) {
             userMessage += " Hoja no encontrada. Verifique que la URL sea correcta.";
        } else {
            userMessage += ` ${response.statusText}. Verifique la URL y la configuración de uso compartido.`
        }
        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log("Successfully fetched CSV data.");

    // --- CSV Parsing Logic - Rely on Column Position ---
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 1) {
        console.warn("CSV data is empty or invalid.");
        return [];
    }

    // Skip header row (lines[0]) as we are using position
    const products: Product[] = [];
    const expectedColumnCount = 4; // Barcode, Description, Provider, Stock

    for (let i = 1; i < lines.length; i++) { // Start from 1 to skip header
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines

        // Basic CSV split - might fail with commas inside quotes, handle carefully
        const values = line.split(',').map(value => value.replace(/^"|"$/g, '').trim());

        if (values.length < 2) { // Need at least barcode, description
            console.warn(`Skipping row ${i + 1}: Insufficient columns. Expected at least 2, got ${values.length}. Line: "${line}"`);
            continue;
        }

        const barcode = values[0]; // Column 1 (index 0)
        const description = values[1]; // Column 2 (index 1)
        // Provider is optional or might be empty
        const provider = values.length > 2 && values[2] ? values[2] : "Desconocido"; // Column 3 (index 2) or default
        const stockStr = values.length > 3 ? values[3] : '0'; // Column 4 (index 3) or default to '0'
        const stock = parseInt(stockStr, 10);

        if (!barcode) {
            console.warn(`Skipping row ${i + 1}: Missing barcode in column 1.`);
            continue;
        }
         if (!description) {
            console.warn(`Skipping row ${i + 1} (Barcode: ${barcode}): Missing description in column 2.`);
            continue; // Or assign default description?
        }

        products.push({
            barcode: barcode,
            description: description,
            provider: provider,
            stock: isNaN(stock) ? 0 : stock, // Default to 0 if stock is not a number or missing
            count: 0, // Default count
            // lastUpdated will be set when added/modified in the counter
        });
    }
    console.log(`Parsed ${products.length} products from CSV based on column position.`);
    return products;
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
  const [showSheetInfoAlert, setShowSheetInfoAlert] = useState(false); // State for sheet info alert

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
      console.log("Loaded initial data from DB:", products.length, "items"); // Debug log
    } catch (error) {
      console.error("Failed to load products from IndexedDB", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al cargar productos de la base de datos.",
      });
    }
  }, [setDatabaseProducts, toast]);

  // Load initial data when the component mounts
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]); // Dependency array includes loadInitialData


  const handleAddProductToDB = useCallback(async (data: ProductValues) => {
    const newProduct = { ...data, stock: Number(data.stock), count: 0 };
    try {
      await addProductsToDB([newProduct]);
      // Use functional update for setDatabaseProducts for reliability
      setDatabaseProducts(prevProducts => [...prevProducts, newProduct]);
      toast({
        title: "Producto agregado",
        description: `${data.description} ha sido agregado a la base de datos.`,
      });
      reset(); // Reset form after successful submission
      setOpen(false); // Close dialog after successful submission
    } catch (error: any) {
      console.error("Database operation failed", error);
       let errorMessage = "Error al guardar el producto en la base de datos.";
      if (error.name === 'ConstraintError') {
        errorMessage = `El producto con código de barras ${newProduct.barcode} ya existe.`;
      }
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
    }
  }, [setDatabaseProducts, toast, reset]);


  const handleSaveProduct = useCallback(async (product: Product) => {
    try {
      await updateProductInDB(product);
       // Use functional update
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
         // Use functional update
        setDatabaseProducts(prevProducts =>
          prevProducts.filter((p) => p.barcode !== barcode)
        );
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
    [setDatabaseProducts, toast] // Removed databaseProducts from dependency array
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
        setShowSheetInfoAlert(true); // Show info alert when starting load


        try {
            const productsFromSheet = await fetchGoogleSheetData(googleSheetUrl);
            setTotalProducts(productsFromSheet.length);

            if (productsFromSheet.length === 0) {
                 toast({
                    variant: "destructive", // Use destructive variant for potential issues
                    title: "No se encontraron productos",
                    description: "La hoja de cálculo está vacía, no tiene el formato correcto o no es accesible.",
                 });
                 setIsUploading(false);
                 return;
            }


            // Define chunk size for adding to DB
            const CHUNK_SIZE = 200;
            let currentChunkIndex = 0;
            let processedCount = 0;

            const processChunk = async () => {
                const start = currentChunkIndex * CHUNK_SIZE;
                const end = start + CHUNK_SIZE;
                const chunk = productsFromSheet.slice(start, end);

                if (chunk.length > 0) {
                     try {
                        await addProductsToDB(chunk);
                        processedCount += chunk.length;
                        setProductsLoaded(processedCount); // Update UI state
                        setUploadProgress(Math.round((processedCount / totalProducts) * 100));
                        currentChunkIndex++;
                        // Use setTimeout to yield to the main thread and allow UI updates
                        // Adjust timeout if needed, 0 might be sufficient
                        setTimeout(processChunk, 10); // Short timeout for UI responsiveness
                     } catch (dbError) {
                        console.error("Error adding chunk to DB:", dbError);
                        setIsUploading(false);
                        toast({
                            variant: "destructive",
                            title: "Error de base de datos",
                            description: "Ocurrió un error al guardar los productos. Verifique la consola para más detalles.",
                            duration: 9000,
                        });
                        // Optionally stop processing further chunks on DB error
                        return;
                     }
                } else {
                    // All chunks processed
                    setIsUploading(false);
                    setUploadComplete(true);
                    setShowSheetInfoAlert(false); // Hide info alert on completion
                    // --- Crucial: Update the component's state after DB operations ---
                    await loadInitialData(); // Refresh state from IndexedDB
                    toast({
                        title: "Carga completa",
                        description: `Se han cargado ${totalProducts} productos desde la hoja de cálculo.`,
                    });
                }
            };

            // Start processing the first chunk
            processChunk();


        } catch (error: any) {
            setIsUploading(false);
            setShowSheetInfoAlert(false); // Hide info alert on error
            console.error("Error during Google Sheet load process:", error);
            toast({
                variant: "destructive",
                title: "Error de carga",
                description: error.message || `Error desconocido al cargar datos desde Google Sheets. Verifique la URL, la configuración de uso compartido y la consola del navegador para más detalles.`,
                duration: 9000, // Show longer for potentially complex errors
            });
        }
    }, [googleSheetUrl, toast, loadInitialData]); // Removed unnecessary dependencies


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
      setDatabaseProducts([]); // Clear the component state immediately
      toast({
        title: "Base de datos borrada",
        description:
          "Todos los productos han sido eliminados de la base de datos.",
      });
    } catch (error) {
      console.error("Failed to clear database", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al borrar la base de datos.",
      });
    } finally {
         setOpenAlert(false); // Close the confirmation dialog
         setAlertAction(null); // Reset alert action
    }
  }, [setDatabaseProducts, toast]);

  const handleOpenEditDialog = (product: Product) => {
    setSelectedProduct(product);
    // Ensure stock is treated as a number for the form
    productForm.reset({ ...product, stock: Number(product.stock) });
    setOpen(true);
  };

  const handleEditProduct = async (values: ProductValues) => {
    if (!selectedProduct) return;

    const updatedProduct = {
      ...selectedProduct,
      ...values,
      stock: Number(values.stock), // Ensure stock is saved as a number
    };

    try {
      await updateProductInDB(updatedProduct);
      // Use functional update
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
      setSelectedProduct(null); // Clear selected product
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
      setSelectedProduct(null); // Clear selected product
    } else if (alertAction === 'clearDatabase') {
      handleClearDatabase(); // Call the clear function
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
        <Button onClick={() => { setSelectedProduct(null); reset({barcode: "", description: "", provider: "", stock: 0}); setOpen(true); }}>Agregar Producto</Button>
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
          type="url" // Use type="url" for better semantics/validation
          placeholder="URL de la Hoja de Google (pública con enlace)"
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

      {/* Informational Alert for Google Sheet Loading */}
      {showSheetInfoAlert && (
         <Alert className="mb-4 bg-blue-50 border-blue-300 text-blue-800">
             <SheetIcon className="h-5 w-5 text-blue-600" /> {/* Added SheetIcon */}
             <AlertTitle className="font-semibold">Cargando desde Google Sheet</AlertTitle>
             <AlertDescription>
                 Asegúrese de que la hoja de cálculo de Google esté compartida como{" "}
                 <span className="font-medium">"Cualquier persona con el enlace puede ver"</span>{" "}
                 para que la carga funcione correctamente. Los datos se leerán por posición de columna:{" "}
                 <span className="font-medium">Col 1: Código de Barras, Col 2: Descripción, Col 3: Proveedor (opcional), Col 4: Stock (opcional, 0 por defecto)</span>.
             </AlertDescription>
         </Alert>
      )}

      {isUploading && (
        <>
          <Progress value={uploadProgress} className="mb-1 h-2" /> {/* Reduced height */}
          <p className="text-sm text-blue-600 mb-4 text-center">
            Cargando {productsLoaded} de {totalProducts} productos... ({uploadProgress}%)
          </p>
        </>
      )}
      {uploadComplete && !isUploading && (
        <p className="text-sm text-green-600 mb-4 text-center">
          ¡Carga completa! Se cargaron {productsLoaded} productos.
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
             {/* Changed to AlertDialogAction */}
            <AlertDialogAction
                variant="destructive"
                onClick={handleDeleteConfirmation}
                className={alertAction === 'clearDatabase' ? "bg-red-600 hover:bg-red-700" : ""}
             >
              {alertAction === 'deleteProduct' ? "Eliminar Producto" : "Borrar Base de Datos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        {/* Button to trigger clearing the entire database */}
      <Button variant="destructive" onClick={triggerClearDatabaseAlert}>Borrar Base de Datos</Button>

      <ScrollArea className="h-[calc(100vh-450px)] mt-4 border rounded-lg"> {/* Adjusted height */}
        <Table>
          <TableCaption>Lista de productos en la base de datos.</TableCaption>
           <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[20%]">Código de Barras</TableHead>
              <TableHead className="w-[30%]">Descripción</TableHead>
              <TableHead className="w-[25%] hidden sm:table-cell">Proveedor</TableHead> {/* Hide Provider on small screens */}
              <TableHead className="w-[15%] text-right">Stock</TableHead>
              {/* Removed Actions column header */}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map((product) => (
              <TableRow key={product.barcode} className="hover:bg-gray-50">
                <TableCell className="w-[20%] font-medium" aria-label="Código de Barras">
                  {product.barcode}
                </TableCell>
                <TableCell
                    className="w-[30%] cursor-pointer hover:text-teal-700 hover:underline"
                    onClick={() => handleOpenEditDialog(product)}
                     aria-label={`Editar producto ${product.description}`}
                    >
                  {product.description}
                </TableCell>
                 <TableCell className="w-[25%] hidden sm:table-cell text-gray-600" aria-label="Proveedor">
                  {product.provider}
                </TableCell>
                <TableCell className="w-[15%] text-right text-gray-600" aria-label="Stock">
                  {product.stock}
                </TableCell>
                 {/* Removed Actions cell */}
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
            {/* Pass the correct handler based on whether we are editing or adding */}
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
                        value={field.value ?? ''} // Handle potential null/undefined for input
                        onChange={(e) => {
                          // Ensure the value passed to the form state is a number or undefined
                           const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                           // Allow resetting to empty string which translates to undefined
                           field.onChange(e.target.value === '' ? '' : (isNaN(value as any) ? field.value : value));
                        }}
                         onBlur={(e) => { // Ensure value is 0 if left empty
                            if (e.target.value === '') {
                                field.onChange(0);
                            }
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
                         <Button type="button" variant="outline" onClick={() => { setOpen(false); setSelectedProduct(null); reset(); }}>Cancelar</Button>
                    </DialogClose>
                </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
