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
const DATABASE_VERSION = 1; // Increment if schema changes

// --- IndexedDB Helper Functions ---

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error("IndexedDB not supported by this browser."));
      return;
    }
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onerror = (event) => {
      console.error("Error opening IndexedDB", (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        const store = db.createObjectStore(OBJECT_STORE_NAME, { keyPath: "barcode" });
        store.createIndex("description", "description", { unique: false });
        store.createIndex("provider", "provider", { unique: false });
        console.log("IndexedDB object store created.");
      } else {
        // Handle potential index updates in future versions if needed
        // Example: if (!store.indexNames.contains('newIndex')) store.createIndex('newIndex', 'field');
        console.log("IndexedDB object store already exists.");
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });
};

export const getAllProductsFromDB = async (): Promise<Product[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        console.warn("Object store not found during getAllProductsFromDB");
        resolve([]); // Return empty if store doesn't exist yet
        return;
    }
    const transaction = db.transaction(OBJECT_STORE_NAME, "readonly");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
    const request = objectStore.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = (event) => {
      console.error("Error getting all products from IndexedDB", (event.target as IDBRequest).error);
      reject((event.target as IDBRequest).error);
    };
    // No need to close DB in transaction events, let it auto-close or handle elsewhere
  });
};

export const addProductsToDB = async (products: Product[]): Promise<void> => {
    if (!products || products.length === 0) {
        return Promise.resolve();
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
        const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
        let completedRequests = 0;
        const totalRequests = products.length;

        transaction.oncomplete = () => {
            console.log(`Transaction completed for adding/updating ${totalRequests} products.`);
            resolve();
        };

        transaction.onerror = (event) => {
            console.error("Transaction error adding/updating products", (event.target as IDBTransaction).error);
            reject((event.target as IDBTransaction).error);
        };

        products.forEach(product => {
            if (!product || typeof product.barcode !== 'string' || product.barcode.trim() === '') {
                console.warn('Skipping invalid product data:', product);
                completedRequests++; // Count as processed
                if (completedRequests === totalRequests) {
                    // This case should ideally not happen if transaction completes/errors
                }
                return;
            }
            const productToAdd = {
                ...product,
                stock: Number(product.stock) || 0,
                count: Number(product.count) || 0
            };
            // Use put for both add and update
            const request = objectStore.put(productToAdd);
            request.onsuccess = () => {
                completedRequests++;
            };
            request.onerror = (event) => {
                console.error("Error putting product to IndexedDB", (event.target as IDBRequest).error, productToAdd);
                completedRequests++; // Still count as processed
            };
        });
    });
};


export const updateProductInDB = async (product: Product): Promise<void> => {
  // Uses addProductsToDB which uses 'put' - handles updates implicitly
  return addProductsToDB([product]);
};

export const deleteProductFromDB = async (barcode: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
    const request = objectStore.delete(barcode);

    request.onsuccess = () => {
      console.log(`Product with barcode ${barcode} deleted successfully.`);
      resolve();
    };

    request.onerror = (event) => {
      console.error("Error deleting product from IndexedDB", (event.target as IDBRequest).error);
      reject((event.target as IDBRequest).error);
    };
  });
};

export const clearDatabaseDB = async (): Promise<void> => {
    const db = await openDB();
    return new Promise(async (resolve, reject) => {
         if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
            console.warn("Object store not found during clearDatabaseDB");
            resolve(); // Nothing to clear
            return;
         }
        const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
        const objectStore = transaction.objectStore(OBJECT_STORE_NAME);
        const request = objectStore.clear();

        request.onsuccess = () => {
            console.log("IndexedDB database cleared successfully.");
            resolve();
        };

        request.onerror = (event) => {
            console.error("Error clearing IndexedDB", (event.target as IDBRequest).error);
            reject((event.target as IDBRequest).error);
        };
    });
};

// --- Google Sheet Parsing Logic ---

const parseGoogleSheetUrl = (sheetUrl: string): { spreadsheetId: string | null; gid: string } => {
    try {
        new URL(sheetUrl);
    } catch (error) {
        console.error("Invalid Google Sheet URL provided", error);
        throw new Error("URL de Hoja de Google inválida.");
    }
    const spreadsheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)\//);
    const sheetGidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);
    const spreadsheetId = spreadsheetIdMatch ? spreadsheetIdMatch[1] : null;
    const gid = sheetGidMatch ? sheetGidMatch[1] : '0'; // Default to first sheet (gid=0) if not specified
    return { spreadsheetId, gid };
};

async function fetchGoogleSheetData(sheetUrl: string): Promise<Product[]> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrl);
    if (!spreadsheetId) {
        throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL.");
    }

    // Construct the public CSV export URL
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log("Fetching Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        // Fetch the data. No CORS mode needed if the sheet is public.
        response = await fetch(csvExportUrl);
    } catch (error: any) {
        console.error("Network error fetching Google Sheet:", error);
        // Provide more specific error guidance
        let userMessage = "Error de red al obtener la hoja. ";
        if (error.message?.includes('Failed to fetch')) {
            userMessage += "Verifique su conexión a internet y la URL.";
        } else {
            userMessage += `Detalle: ${error.message}`;
        }
        throw new Error(userMessage);
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => "Could not read error response body.");
        console.error(`Failed to fetch Google Sheet data: ${response.status} ${response.statusText}`, errorText);
        let userMessage = `Error ${response.status} al obtener datos. `;
        if (response.status === 400) userMessage += "Verifique la URL y asegúrese de que el ID de la hoja (gid) sea correcto.";
        else if (response.status === 403) userMessage += "Asegúrese de que la hoja sea pública ('Cualquier persona con el enlace puede ver').";
        else if (response.status === 404) userMessage += "Hoja no encontrada. Verifique la URL.";
        else userMessage += ` ${response.statusText}.`;
        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log("Successfully fetched CSV data.");

    // --- Robust CSV Parsing Logic - Rely on Column Position ---
    // Handle different line endings (\n or \r\n)
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) { // Need at least header + one data row
        console.warn("CSV data is empty or has only headers.");
        return [];
    }

    const products: Product[] = [];
    // Start from 1 to skip the header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines

        // Basic CSV split - assumes comma separator and handles simple quotes
        // This parser is basic. For complex CSVs (e.g., commas within quoted fields), a library is better.
        const values = line.split(',').map(value => value.replace(/^"|"$/g, '').trim());

        // Expected columns by position:
        // 0: Barcode
        // 1: Description
        // 2: Provider (optional)
        // 3: Stock (optional)

        if (values.length < 1) { // Need at least barcode
            console.warn(`Skipping row ${i + 1}: Insufficient columns. Found ${values.length}, expected at least 1. Line: "${line}"`);
            continue;
        }

        const barcode = values[0];
        const description = values.length > 1 ? values[1] : `Producto ${barcode}`; // Default if missing
        const provider = values.length > 2 && values[2] ? values[2] : "Desconocido"; // Default if missing
        const stockStr = values.length > 3 ? values[3] : '0'; // Default stock to '0' if missing
        const stock = parseInt(stockStr, 10);

        if (!barcode) {
            console.warn(`Skipping row ${i + 1}: Missing barcode.`);
            continue;
        }

        products.push({
            barcode: barcode,
            description: description,
            provider: provider,
            stock: isNaN(stock) ? 0 : stock, // Handle if stock parsing fails, default to 0
            count: 0, // Default count when loading from sheet
            // lastUpdated: not set here, will be set on interaction
        });
    }
    console.log(`Parsed ${products.length} products from CSV based on column position.`);
    return products;
}



// --- React Component ---

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({
  databaseProducts,
  setDatabaseProducts,
}) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false); // State for Add/Edit Dialog
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null); // Product being edited
  const [openAlert, setOpenAlert] = useState(false); // State for Confirmation Dialogs
  const [alertAction, setAlertAction] = useState<'deleteProduct' | 'clearDatabase' | null>(null); // Type of confirmation
  const [productToDelete, setProductToDelete] = useState<Product | null>(null); // Product for delete confirmation
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [totalProductsToLoad, setTotalProductsToLoad] = useState(0); // Renamed for clarity
  const [productsLoaded, setProductsLoaded] = useState(0);
  const isMobile = useIsMobile();
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const [showSheetInfoAlert, setShowSheetInfoAlert] = useState(false);

  const productForm = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { barcode: "", description: "", provider: "", stock: 0 },
  });
  const { handleSubmit, reset, control } = productForm; // Destructure control

  // Load initial data from IndexedDB on mount
  const loadInitialData = useCallback(async () => {
    console.log("Attempting to load initial data from IndexedDB...");
    try {
      const products = await getAllProductsFromDB();
      setDatabaseProducts(products);
      console.log("Loaded initial data from DB:", products.length, "items");
    } catch (error) {
      console.error("Failed to load products from IndexedDB", error);
      toast({
        variant: "destructive",
        title: "Error de Carga",
        description: "No se pudieron cargar los productos de la base de datos local.",
      });
    }
  }, [setDatabaseProducts, toast]); // Dependencies for useCallback

  useEffect(() => {
    if (typeof window !== 'undefined') {
        loadInitialData();
    }
  }, [loadInitialData]); // Run loadInitialData once on mount


  // --- CRUD Handlers ---

  const handleAddOrUpdateProduct = useCallback(async (data: ProductValues) => {
    const isUpdating = !!selectedProduct; // Check if we are updating
    const productData: Product = {
        ...data,
        barcode: isUpdating ? selectedProduct.barcode : data.barcode.trim(), // Trim barcode on add
        description: data.description.trim(), // Trim description
        provider: data.provider.trim(), // Trim provider
        stock: Number(data.stock) || 0, // Ensure stock is a number
        count: isUpdating ? selectedProduct.count : 0, // Preserve count if updating, else 0
        lastUpdated: new Date().toISOString() // Add or update timestamp
    };

    if (!productData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }
     if (!productData.description) {
        toast({ variant: "destructive", title: "Error", description: "La descripción no puede estar vacía." });
        return;
    }
    // Provider can be empty, default is handled if needed elsewhere

    try {
        await addProductsToDB([productData]); // Use addProductsToDB (uses 'put') for both add/update
        // Use functional update for reliability
        setDatabaseProducts(prevProducts => {
            const existingIndex = prevProducts.findIndex(p => p.barcode === productData.barcode);
            if (existingIndex > -1) {
                // Update existing product
                const updatedProducts = [...prevProducts];
                updatedProducts[existingIndex] = productData;
                return updatedProducts;
            } else {
                // Add new product
                return [...prevProducts, productData];
            }
        });

        toast({
            title: isUpdating ? "Producto Actualizado" : "Producto Agregado",
            description: `${productData.description} ha sido ${isUpdating ? 'actualizado' : 'agregado'}.`,
        });
        reset({ barcode: "", description: "", provider: "", stock: 0 }); // Reset form fully
        setOpen(false); // Close dialog
        setSelectedProduct(null); // Clear selected product after update/add
    } catch (error: any) {
        console.error("Database operation failed", error);
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.name === 'ConstraintError' && !isUpdating) {
            errorMessage = `El producto con código de barras ${productData.barcode} ya existe.`;
        } else if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        toast({ variant: "destructive", title: "Error", description: errorMessage, duration: 9000 });
    }
}, [selectedProduct, setDatabaseProducts, toast, reset]);


  const handleDeleteProduct = useCallback(async (barcode: string) => {
      if (!barcode) {
          console.error("Delete cancelled: No barcode provided.");
          return; // Should not happen if triggered correctly
      }
      try {
        await deleteProductFromDB(barcode);
        // Use functional update for setDatabaseProducts
        setDatabaseProducts(prevProducts => prevProducts.filter(p => p.barcode !== barcode));
        toast({
          title: "Producto Eliminado",
          description: `El producto con código ${barcode} ha sido eliminado.`,
        });
      } catch (error: any) {
        console.error("Failed to delete product from database", error);
        toast({ variant: "destructive", title: "Error", description: `Error al eliminar el producto: ${error.message}` });
      } finally {
          setOpenAlert(false); // Close confirmation dialog
          setAlertAction(null);
          setProductToDelete(null); // Clear the product slated for deletion
          setOpen(false); // Close the edit dialog if it was open
          setSelectedProduct(null); // Clear selection
      }
  }, [setDatabaseProducts, toast]); // Dependencies for useCallback


  const handleClearDatabase = useCallback(async () => {
    try {
      await clearDatabaseDB();
      setDatabaseProducts([]); // Clear component state immediately
      toast({ title: "Base de Datos Borrada", description: "Todos los productos han sido eliminados." });
    } catch (error: any) {
      console.error("Failed to clear database", error);
      toast({ variant: "destructive", title: "Error", description: `Error al borrar la base de datos: ${error.message}` });
    } finally {
        setOpenAlert(false);
        setAlertAction(null);
    }
  }, [setDatabaseProducts, toast]); // Dependencies


  // --- Dialog and Alert Triggers ---

  const handleOpenEditDialog = (product: Product) => {
    setSelectedProduct(product);
    reset({ ...product, stock: Number(product.stock) }); // Populate form for editing
    setOpen(true);
  };

  const triggerDeleteProductAlert = (product: Product) => {
      if (!product) {
         console.error("Cannot delete: product data is missing.");
         toast({ variant: "destructive", title: "Error Interno", description: "No se pueden obtener los datos del producto para eliminar." });
         return;
      }
      setProductToDelete(product); // Set the product to be deleted
      setAlertAction('deleteProduct');
      setOpenAlert(true); // Open confirmation dialog
  };

  const triggerClearDatabaseAlert = () => {
      setAlertAction('clearDatabase');
      setOpenAlert(true);
  };

 const handleDeleteConfirmation = () => {
    if (alertAction === 'deleteProduct' && productToDelete) {
      handleDeleteProduct(productToDelete.barcode); // Pass barcode to delete handler
    } else if (alertAction === 'clearDatabase') {
      handleClearDatabase();
    }
    // Reset states handled within individual handlers now
  };


  // --- Google Sheet Loading ---

    const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrl) {
            toast({ variant: "destructive", title: "URL Requerida", description: "Introduce la URL de la hoja de Google." });
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);
        setUploadComplete(false);
        setProductsLoaded(0);
        setTotalProductsToLoad(0);
        setShowSheetInfoAlert(true); // Show info alert immediately

        let db: IDBDatabase | null = null;
        let transaction: IDBTransaction | null = null;
        let objectStore: IDBObjectStore | null = null;
        const CHUNK_SIZE = 200; // Process products in chunks
        let productsFromSheet: Product[] = [];

        try {
            console.log("Starting Google Sheet data fetch...");
            productsFromSheet = await fetchGoogleSheetData(googleSheetUrl);
            console.log(`Fetched ${productsFromSheet.length} products from sheet.`);
            setTotalProductsToLoad(productsFromSheet.length);

            if (productsFromSheet.length === 0) {
                 toast({ title: "Hoja Vacía o Inválida", description: "No se encontraron productos válidos en la hoja. Verifique el formato y el acceso.", variant: "destructive" });
                 setIsUploading(false);
                 setShowSheetInfoAlert(false);
                 return;
            }

            db = await openDB();
            transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
            objectStore = transaction.objectStore(OBJECT_STORE_NAME);
            let processedCount = 0;

            transaction.oncomplete = () => {
                console.log("IndexedDB Transaction completed successfully.");
                setIsUploading(false);
                setUploadComplete(true);
                loadInitialData(); // Refresh UI state from DB
                toast({ title: "Carga Completa", description: `Se cargaron/actualizaron ${processedCount} productos.` });
                // No need to close db here, transaction handles it implicitly
            };

            transaction.onerror = (event) => {
                console.error("IndexedDB Transaction error:", (event.target as IDBTransaction).error);
                setIsUploading(false);
                setShowSheetInfoAlert(false);
                toast({ variant: "destructive", title: "Error de Base de Datos", description: "Ocurrió un error durante la transacción al guardar.", duration: 9000 });
                // No need to close db here
            };

             transaction.onabort = (event) => {
                 console.error("IndexedDB Transaction aborted:", (event.target as IDBTransaction).error);
                 setIsUploading(false);
                 setShowSheetInfoAlert(false);
                 toast({ variant: "destructive", title: "Carga Abortada", description: "La carga de datos fue abortada debido a un error.", duration: 9000 });
             };


            // Process products sequentially using the transaction
            for (const product of productsFromSheet) {
                 if (!objectStore || !transaction) { // Should not happen if transaction active
                     throw new Error("Transaction or ObjectStore became invalid during processing.");
                 }
                 // Basic validation before putting
                 const productToAdd = {
                    ...product,
                    stock: Number(product.stock) || 0,
                    count: Number(product.count) || 0,
                 };
                 if (typeof productToAdd.barcode !== 'string' || !productToAdd.barcode.trim()) {
                     console.warn("Skipping product with invalid barcode:", productToAdd);
                     continue; // Skip this product
                 }

                 const request = objectStore.put(productToAdd);
                 request.onerror = (event) => {
                     // Log specific error, but don't necessarily stop the whole process unless transaction aborts
                     console.error("Error putting product to IndexedDB:", (event.target as IDBRequest).error, productToAdd);
                 };
                 request.onsuccess = () => {
                     processedCount++;
                     setProductsLoaded(processedCount);
                     const progress = totalProductsToLoad > 0 ? Math.round((processedCount / totalProductsToLoad) * 100) : 0;
                     setUploadProgress(progress);
                 };

                 // Yield slightly if processing many items to keep UI responsive, but within the transaction
                 if (processedCount % CHUNK_SIZE === 0) {
                      console.log(`Processed ${processedCount}/${totalProductsToLoad}...`);
                      // Brief yield, but careful not to let transaction time out
                      // await new Promise(resolve => setTimeout(resolve, 5)); // Use cautiously
                 }
            }

             // If loop completes, the transaction.oncomplete will fire.

        } catch (error: any) {
            console.error("Error during Google Sheet load process:", error);
            setIsUploading(false); // Ensure UI state is reset
            setShowSheetInfoAlert(false);
            toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar. Verifique URL, permisos y consola.", duration: 9000 });
            // Abort transaction if it's still active and an external error occurred
             if (transaction && transaction.readyState === "active") {
                 try {
                     transaction.abort();
                 } catch (abortError) {
                     console.error("Error aborting transaction:", abortError);
                 }
             }
        } finally {
            // Ensure UI state is consistent regardless of success/failure
            setIsUploading(false);
             // Don't hide info alert immediately on error, let user see it
             // setShowSheetInfoAlert(false); // Removed from here
             // DB closing is handled by transaction completion/error/abort
        }
    }, [googleSheetUrl, toast, loadInitialData, setDatabaseProducts]); // Dependencies


  // --- Export and Filtering ---

  const handleExportDatabase = useCallback(() => {
    if (databaseProducts.length === 0) {
      toast({ title: "Base de Datos Vacía", description: "No hay productos para exportar." });
      return;
    }
    const csvData = convertToCSV(databaseProducts);
    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "product_database.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [databaseProducts, toast]); // Added toast dependency

  const convertToCSV = useCallback((data: Product[]) => {
    const headers = ["Barcode", "Description", "Provider", "Stock"];
    const rows = data.map((product) => [
      `"${(product.barcode || '').replace(/"/g, '""')}"`, // Quote barcode
      `"${(product.description || '').replace(/"/g, '""')}"`, // Quote description
      `"${(product.provider || '').replace(/"/g, '""')}"`, // Quote provider
      product.stock ?? 0, // Ensure stock is a number, default 0
    ]);
    return headers.join(",") + "\n" + rows.map((row) => row.join(",")).join("\n");
  }, []);


  const filteredProducts = databaseProducts.filter(product => {
      const searchTermLower = searchTerm.toLowerCase();
      const matchesSearch = searchTerm === "" ||
                            (product.barcode || '').toLowerCase().includes(searchTermLower) ||
                            (product.description || '').toLowerCase().includes(searchTermLower);
      const matchesProvider = selectedProviderFilter === 'all' || product.provider === selectedProviderFilter;
      return matchesSearch && matchesProvider;
  });

  // Generate provider options dynamically, ensuring 'all' is first and no duplicates
  const providerOptions = ["all", ...Array.from(new Set(databaseProducts.map(p => p.provider).filter(p => p)))]; // Filter out empty/null providers


  // --- Render ---

  return (
    <div className="p-4 md:p-6"> {/* Added padding */}
      {/* --- Toolbar --- */}
      <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
        {/* Add Product Button */}
        <Button onClick={() => { setSelectedProduct(null); reset({barcode: "", description: "", provider: "", stock: 0}); setOpen(true); }}>
          Agregar Producto
        </Button>

        {/* Search and Filter Controls */}
        <div className="flex items-center gap-2 flex-wrap"> {/* Allow wrapping */}
           <Label htmlFor="search-product" className="sr-only">Buscar Producto</Label>
            <Input
                id="search-product"
                type="text"
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-xs h-9" // Adjusted size
            />
            <Select value={selectedProviderFilter} onValueChange={setSelectedProviderFilter}>
                <SelectTrigger className="w-auto md:w-[180px] h-9"> {/* Responsive width */}
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Filtrar proveedor" />
                </SelectTrigger>
                <SelectContent>
                    {providerOptions.map(provider => (
                        <SelectItem key={provider} value={provider}>
                            {provider === 'all' ? 'Todos' : provider}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {/* Export and Clear Buttons */}
            <Button onClick={handleExportDatabase} variant="outline" size="sm"> {/* Smaller size */}
                Exportar <FileDown className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="destructive" size="sm" onClick={triggerClearDatabaseAlert}> {/* Smaller size */}
               <Trash className="mr-2 h-4 w-4" /> Borrar Todo
            </Button>
        </div>
      </div>

      {/* --- Google Sheet Loader --- */}
      <div className="flex flex-wrap items-center mb-4 gap-2">
        <Label htmlFor="google-sheet-url" className="shrink-0 text-sm"> {/* Smaller label */}
          Cargar desde Google Sheet:
        </Label>
        <Input
          id="google-sheet-url"
          type="url"
          placeholder="URL de Hoja de Google (pública)"
          value={googleSheetUrl}
          onChange={(e) => setGoogleSheetUrl(e.target.value)}
          className="flex-grow min-w-[200px] h-9" // Adjusted size
          disabled={isUploading}
        />
        <Button variant="secondary" size="sm" disabled={isUploading} onClick={handleLoadFromGoogleSheet}>
            <Upload className="mr-2 h-4 w-4" />
            {isUploading ? 'Cargando...' : 'Cargar'}
        </Button>
      </div>

      {/* --- Loading Indicators and Alerts --- */}
       {showSheetInfoAlert && (
         <Alert className="mb-4 bg-blue-50 border-blue-300 text-blue-800 text-xs"> {/* Smaller text */}
             <SheetIcon className="h-4 w-4 text-blue-600" />
             <AlertTitle className="font-semibold text-sm">Cargando desde Google Sheet</AlertTitle>
             <AlertDescription>
                 Asegúrese de que la hoja sea <span className="font-medium">pública</span> y accesible.
                 Se leerá por posición: <span className="font-medium">Col 1: Cód. Barras, Col 2: Descripción, Col 3: Proveedor, Col 4: Stock</span>.
             </AlertDescription>
         </Alert>
      )}
      {isUploading && (
        <div className="mb-4">
          <Progress value={uploadProgress} className="h-2" />
          <p className="text-sm text-blue-600 mt-1 text-center">
            Cargando {productsLoaded} de {totalProductsToLoad} ({uploadProgress}%)
          </p>
        </div>
      )}
      {uploadComplete && !isUploading && totalProductsToLoad > 0 && (
        <Alert variant="default" className="mb-4 bg-green-50 border-green-300 text-green-800 text-xs">
           <AlertTitle className="font-semibold text-sm">Carga Completa</AlertTitle>
           <AlertDescription>
               Se procesaron {productsLoaded} productos desde la Hoja de Google.
            </AlertDescription>
        </Alert>
      )}

      {/* --- Confirmation Dialog (for Delete/Clear) --- */}
      <AlertDialog open={openAlert} onOpenChange={setOpenAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              {alertAction === 'deleteProduct' && productToDelete ?
                `Eliminarás el producto "${productToDelete.description}" (Código: ${productToDelete.barcode}). Esta acción no se puede deshacer.`
                 : alertAction === 'clearDatabase' ?
                 "Eliminarás TODOS los productos de la base de datos. Esta acción no se puede deshacer."
                 : "Esta acción no se puede deshacer."
                }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpenAlert(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
                onClick={handleDeleteConfirmation}
                className={alertAction === 'clearDatabase' ? "bg-red-600 hover:bg-red-700" : "bg-destructive hover:bg-destructive/90"} // Consistent destructive style
             >
              {alertAction === 'deleteProduct' ? "Eliminar Producto" : "Borrar Base de Datos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* --- Products Table --- */}
      <ScrollArea className="h-[calc(100vh-450px)] mt-4 border rounded-lg shadow-sm"> {/* Adjusted height */}
        <Table>
          <TableCaption>Lista de productos en la base de datos.</TableCaption>
           <TableHeader className="sticky top-0 bg-background z-10 shadow-sm"> {/* Added shadow */}
            <TableRow>
              {/* Adjusted widths and hidden classes */}
              <TableHead className="w-[20%] px-2 py-2">Código</TableHead>
              <TableHead className="w-[40%] px-2 py-2">Descripción</TableHead>
              <TableHead className="w-[25%] px-2 py-2 hidden md:table-cell">Proveedor</TableHead>
              <TableHead className="w-[15%] px-2 py-2 text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map((product) => (
              <TableRow key={product.barcode} className="hover:bg-gray-50 text-sm"> {/* Smaller text */}
                {/* Removed onClick from barcode - using description now */}
                <TableCell className="w-[20%] px-2 py-2 font-medium" aria-label="Código de Barras">
                  {product.barcode}
                </TableCell>
                 {/* Added onClick to description for editing */}
                <TableCell
                    className="w-[40%] px-2 py-2 cursor-pointer hover:text-teal-700 hover:underline"
                    onClick={() => handleOpenEditDialog(product)}
                     aria-label={`Editar producto ${product.description}`}
                    >
                  {product.description}
                </TableCell>
                 <TableCell className="w-[25%] px-2 py-2 hidden md:table-cell text-gray-600" aria-label="Proveedor">
                  {product.provider}
                </TableCell>
                <TableCell className="w-[15%] px-2 py-2 text-right text-gray-600" aria-label="Stock">
                  {product.stock}
                </TableCell>
              </TableRow>
            ))}
            {filteredProducts.length === 0 && (
              <TableRow>
                 {/* Adjusted colSpan based on hidden columns */}
                <TableCell colSpan={isMobile ? 3 : 4} className="text-center py-10 text-gray-500">
                  {databaseProducts.length > 0 ? "No hay productos que coincidan." : "Base de datos vacía."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* --- Add/Edit Product Dialog --- */}
      <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setSelectedProduct(null); }}> {/* Clear selection on close */}
        <DialogContent className="sm:max-w-md"> {/* Adjusted width */}
          <DialogHeader>
            <DialogTitle>{selectedProduct ? "Editar Producto" : "Agregar Producto"}</DialogTitle>
            <DialogDescription>
              {selectedProduct ? "Modifica los detalles del producto." : "Añade un nuevo producto."}
            </DialogDescription>
          </DialogHeader>
          <Form {...productForm}>
            <form onSubmit={handleSubmit(handleAddOrUpdateProduct)} className="space-y-3"> {/* Reduced spacing */}
              <FormField
                control={control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código de Barras</FormLabel>
                    <FormControl>
                      <Input type="text" {...field} readOnly={!!selectedProduct} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} /> {/* Fewer rows */}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Proveedor</FormLabel>
                    <FormControl>
                      <Input type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                         value={field.value ?? ''}
                         onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
                         onBlur={(e) => { if (e.target.value === '') field.onChange(0); }}
                         min="0" // Ensure non-negative
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <DialogFooter className="flex justify-between w-full pt-4">
                  <Button type="submit">
                      {selectedProduct ? <><Save className="mr-2 h-4 w-4" /> Guardar</> : "Agregar"}
                  </Button>
                  {selectedProduct && (
                    // Pass the selectedProduct to the trigger function
                    <Button type="button" variant="destructive" onClick={() => triggerDeleteProductAlert(selectedProduct)}>
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