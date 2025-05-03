// Ensure this file starts with "use client" if it uses client-side hooks like useState, useEffect, etc.
"use client";

import type { Product } from '@/types/product'; // Import Product type
import { zodResolver } from "@hookform/resolvers/zod";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
    addProductsToDB,
    clearDatabaseDB,
    deleteProductFromDB,
    getAllProductsFromDB,
    updateProductInDB
} from "@/lib/indexeddb-helpers"; // Import helpers
import {
    Edit,
    FileDown,
    Filter,
    Save,
    SheetIcon,
    Trash,
    Upload
} from "lucide-react";
import Papa from 'papaparse'; // Using PapaParse for robust CSV parsing
import * as React from "react"; // Import React
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";


const productSchema = z.object({
  barcode: z.string().min(1, {
    message: "El código de barras es requerido.",
  }),
  description: z.string().min(1, {
    message: "La descripción es requerida.",
  }),
  provider: z.string().optional(), // Provider is optional
  stock: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? 0 : Number(val)), // Preprocess empty/null to 0
    z.number().min(0, { message: "El stock debe ser mayor o igual a 0." })
  ),
});

type ProductValues = z.infer<typeof productSchema>;

interface ProductDatabaseProps {
  databaseProducts: Product[];
  setDatabaseProducts: (products: Product[] | ((prevProducts: Product[]) => Product[])) => void; // Allow functional updates
}


// --- Google Sheet Parsing Logic ---

const parseGoogleSheetUrl = (sheetUrl: string): { spreadsheetId: string | null; gid: string } => {
    try {
        new URL(sheetUrl); // Basic URL validation
    } catch (error) {
        console.error("Invalid Google Sheet URL provided:", sheetUrl, error);
        throw new Error("URL de Hoja de Google inválida.");
    }
    // More robust regex to handle various URL formats
    const spreadsheetIdMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);

    const spreadsheetId = spreadsheetIdMatch ? spreadsheetIdMatch[1] : null;
    const gid = gidMatch ? gidMatch[1] : '0'; // Default to first sheet (gid=0)

    console.log(`Parsed URL: spreadsheetId=${spreadsheetId}, gid=${gid}`);
    if (!spreadsheetId) {
         console.warn("Could not extract spreadsheet ID from URL:", sheetUrl);
    }
    return { spreadsheetId, gid };
};


async function fetchGoogleSheetData(sheetUrl: string): Promise<Product[]> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrl);
    if (!spreadsheetId) {
        throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL. Verifique el formato de la URL.");
    }

    // Construct the public CSV export URL
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log("Fetching Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        response = await fetch(csvExportUrl);
    } catch (error: any) {
        console.error("Network error fetching Google Sheet:", error);
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión a internet y la URL.";
         if (error.message?.includes('Failed to fetch')) {
             // This often indicates a CORS issue if the sheet isn't public,
             // or a network connectivity problem.
             userMessage += " Posible problema de CORS o conectividad.";
         } else {
             userMessage += ` Detalle: ${error.message}`;
         }
        throw new Error(userMessage);
    }

    if (!response.ok) {
        const status = response.status;
        const statusText = response.statusText;
        const errorBody = await response.text().catch(() => "Could not read error response body.");
        console.error(`Failed to fetch Google Sheet data: ${status} ${statusText}`, { url: csvExportUrl, body: errorBody });

        let userMessage = `Error ${status} al obtener datos. `;
        if (status === 400) userMessage += "Verifique la URL y asegúrese de que el ID de la hoja (gid=${gid}) sea correcto.";
        else if (status === 403) userMessage += "Acceso denegado. Asegúrese de que la hoja sea pública ('Cualquier persona con el enlace puede ver').";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL y el ID de la hoja.";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja.`;

        // Specific check for common "Sign in" page response when not public
        if (errorBody.toLowerCase().includes("google accounts sign in")) {
             userMessage = "Error de Acceso: La hoja no es pública. Cambie la configuración de compartir a 'Cualquier persona con el enlace puede ver'.";
        }

        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log(`Successfully fetched CSV data (length: ${csvText.length}). Parsing...`);

    // --- Robust CSV Parsing Logic - Rely on Column Position ---
    const lines = csvText.split(/\r?\n/); // Handle different line endings
    if (lines.length < 1) { // Allow empty sheets or sheets with only header
        console.warn("CSV data is empty.");
        return [];
    }

    const products: Product[] = [];
    // Skip header row (assuming first row is header, start from i=1)
    const startRow = lines[0].trim() ? 1 : 0; // Start from 0 if first line is empty

    for (let i = startRow; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines

        // Use PapaParse for more reliable CSV parsing
        const result = Papa.parse<string[]>(line, { delimiter: ',', skipEmptyLines: true });
        if (result.errors.length > 0) {
             console.warn(`Skipping row ${i + 1} due to parsing errors: ${result.errors[0].message}. Line: "${line}"`);
             continue;
        }
        if (!result.data || result.data.length === 0 || !result.data[0] || result.data[0].length === 0) {
             console.warn(`Skipping row ${i + 1}: No data parsed. Line: "${line}"`);
            continue;
        }

        const values = result.data[0]; // PapaParse returns data as an array of arrays

        // Expected columns by position (0-based index):
        // 0: Barcode
        // 1: Description
        // 2: Provider (optional)
        // 3: Stock (optional)

        if (values.length === 0 || !values[0]) {
            console.warn(`Skipping row ${i + 1}: Missing or empty barcode (Column 1). Line: "${line}"`);
            continue;
        }

        const barcode = values[0].trim();
        const description = values.length > 1 && values[1] ? values[1].trim() : `Producto ${barcode}`; // Default if missing
        const provider = values.length > 2 && values[2] ? values[2].trim() : "Desconocido"; // Default if missing
        const stockStr = values.length > 3 ? values[3].trim() : '0'; // Default stock to '0'
        const stock = parseInt(stockStr, 10);

        products.push({
            barcode: barcode,
            description: description,
            provider: provider,
            stock: isNaN(stock) || stock < 0 ? 0 : stock, // Handle parsing errors, default to 0, ensure non-negative
            count: 0, // Default count when loading from sheet
            lastUpdated: new Date().toISOString(), // Add lastUpdated timestamp
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
  const [totalProductsToLoad, setTotalProductsToLoad] = useState(0);
  const [productsLoaded, setProductsLoaded] = useState(0);
  const isMobile = useIsMobile();
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const [showSheetInfoAlert, setShowSheetInfoAlert] = useState(false);

  const productForm = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { barcode: "", description: "", provider: "Desconocido", stock: 0 },
  });
  const { handleSubmit, reset, control, setValue, formState: { errors } } = productForm; // Destructure control

   // Debug form errors
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.warn("Form validation errors:", errors);
    }
  }, [errors]);

  // Load initial data from IndexedDB on mount
  const loadInitialData = useCallback(async () => {
    console.log("Attempting to load initial data from IndexedDB...");
    setIsUploading(true); // Indicate loading state
    try {
      const products = await getAllProductsFromDB();
      setDatabaseProducts(products);
      console.log("Loaded initial data from DB:", products.length, "items");
    } catch (error: any) {
      console.error("Failed to load products from IndexedDB", error);
      toast({
        variant: "destructive",
        title: "Error de Carga DB",
        description: `No se pudieron cargar los productos: ${error.message}`,
        duration: 9000
      });
      setDatabaseProducts([]); // Set to empty array on error
    } finally {
        setIsUploading(false); // Turn off loading indicator
    }
  }, [setDatabaseProducts, toast]); // Dependencies for useCallback

  useEffect(() => {
    if (typeof window !== 'undefined' && window.indexedDB) { // Ensure IndexedDB is available
        loadInitialData();
    } else {
        console.warn("IndexedDB not available, skipping initial load.");
         toast({
            variant: "destructive",
            title: "Base de Datos No Disponible",
            description: "IndexedDB no es compatible con este navegador. La base de datos local no funcionará.",
            duration: null // Persist until dismissed
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount


  // --- CRUD Handlers ---

  const handleAddOrUpdateProduct = useCallback(async (data: ProductValues) => {
    const isUpdating = !!selectedProduct; // Check if we are updating
    const productData: Product = {
        barcode: isUpdating ? selectedProduct.barcode : data.barcode.trim(), // Trim barcode only on add
        description: data.description.trim() || `Producto ${data.barcode.trim()}`, // Trim description or default
        provider: data.provider?.trim() || "Desconocido", // Trim provider or default
        stock: Number(data.stock) || 0, // Ensure stock is a number, default 0
        // Preserve count if updating, otherwise it should be 0 for DB state
        count: selectedProduct?.count ?? 0,
        lastUpdated: new Date().toISOString() // Add or update timestamp
    };

    console.log(`${isUpdating ? 'Updating' : 'Adding'} product:`, productData);

    if (!productData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }

    setIsUploading(true); // Show loading indicator during DB operation
    try {
        if (isUpdating) {
             await updateProductInDB(productData); // Use specific update function
        } else {
             // Check if barcode already exists before adding
             const existingProduct = await getAllProductsFromDB().then(products => products.find(p => p.barcode === productData.barcode));
             if (existingProduct) {
                 throw new Error(`El producto con código de barras ${productData.barcode} ya existe.`);
             }
            await addProductsToDB([productData]);
        }


        // Update React state reliably using functional update
        setDatabaseProducts(prevProducts => {
            const existingIndex = prevProducts.findIndex(p => p.barcode === productData.barcode);
            let newProducts;
            if (existingIndex > -1) {
                // Update existing product
                newProducts = [...prevProducts];
                newProducts[existingIndex] = { ...prevProducts[existingIndex], ...productData }; // Merge to preserve other fields if necessary
            } else {
                // Add new product
                newProducts = [...prevProducts, productData];
            }
            // Sort or reorder if needed, e.g., alphabetically by description
            // newProducts.sort((a, b) => a.description.localeCompare(b.description));
            return newProducts;
        });

        toast({
            title: isUpdating ? "Producto Actualizado" : "Producto Agregado",
            description: `${productData.description} (${productData.barcode}) ha sido ${isUpdating ? 'actualizado' : 'agregado'}.`,
        });
        reset({ barcode: "", description: "", provider: "Desconocido", stock: 0 }); // Reset form
        setOpen(false); // Close dialog
        setSelectedProduct(null); // Clear selected product state
    } catch (error: any) {
        console.error("Database operation failed", error);
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
         // Check for specific IndexedDB errors or custom errors
        if (error.message?.includes('ya existe')) {
             errorMessage = error.message;
        } else if (error.name === 'ConstraintError' && !isUpdating) {
            errorMessage = `El producto con código de barras ${productData.barcode} ya existe.`;
        } else if (error.message?.includes('TransactionInactiveError')) {
             errorMessage = "Error de transacción. Intente de nuevo.";
        } else if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        toast({ variant: "destructive", title: "Error de Base de Datos", description: errorMessage, duration: 9000 });
    } finally {
        setIsUploading(false); // Hide loading indicator
    }
}, [selectedProduct, setDatabaseProducts, toast, reset]);


  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
      if (!barcode) {
          console.error("Delete cancelled: No barcode provided.");
          toast({ variant: "destructive", title: "Error Interno", description: "No se puede eliminar el producto sin código de barras." });
          setOpenAlert(false);
          setProductToDelete(null);
          setAlertAction(null);
          return;
      }
      console.log(`Attempting to delete product with barcode: ${barcode}`);
      setIsUploading(true); // Show loading state
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
        toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}`, duration: 9000 });
      } finally {
          setIsUploading(false); // Hide loading state
          setOpenAlert(false); // Close confirmation dialog
          setProductToDelete(null); // Clear the product slated for deletion
          setAlertAction(null);
          // If the edit dialog was open for the deleted product, close it and reset
          if (selectedProduct?.barcode === barcode) {
             setOpen(false);
             setSelectedProduct(null);
             reset();
          }
      }
  }, [setDatabaseProducts, toast, reset, selectedProduct]); // Added dependencies


  const handleClearDatabase = useCallback(async () => {
    console.log("Attempting to clear the entire database.");
    setIsUploading(true);
    try {
      await clearDatabaseDB();
      setDatabaseProducts([]); // Clear component state immediately
      toast({ title: "Base de Datos Borrada", description: "Todos los productos han sido eliminados." });
    } catch (error: any) {
      console.error("Failed to clear database", error);
      toast({ variant: "destructive", title: "Error al Borrar DB", description: `No se pudo borrar la base de datos: ${error.message}`, duration: 9000 });
    } finally {
        setIsUploading(false);
        setOpenAlert(false); // Close confirmation
        setAlertAction(null);
    }
  }, [setDatabaseProducts, toast]); // Dependencies


  // --- Dialog and Alert Triggers ---

  const handleOpenEditDialog = useCallback((product: Product) => {
    console.log("Opening edit dialog for:", product);
    setSelectedProduct(product);
    // Ensure form values are set correctly, handling potential undefined/null
    reset({
        barcode: product.barcode || "",
        description: product.description || "",
        provider: product.provider || "Desconocido",
        stock: product.stock ?? 0, // Default to 0 if stock is null/undefined
    });
    setOpen(true);
  }, [reset]);

  const triggerDeleteProductAlert = useCallback((product: Product | null) => {
      if (!product) {
         console.error("Cannot trigger delete: product data is missing.");
         toast({ variant: "destructive", title: "Error Interno", description: "Datos del producto no disponibles para eliminar." });
         return;
      }
      console.log("Triggering delete confirmation for:", product);
      setProductToDelete(product); // Set the product to be deleted
      setAlertAction('deleteProduct');
      setOpenAlert(true); // Open confirmation dialog
  }, [toast]);

  const triggerClearDatabaseAlert = useCallback(() => {
      console.log("Triggering clear database confirmation.");
      setAlertAction('clearDatabase');
      setOpenAlert(true);
  }, []);

 const handleDeleteConfirmation = useCallback(() => {
    console.log(`Confirming action: ${alertAction}`);
    if (alertAction === 'deleteProduct' && productToDelete) {
      handleDeleteProduct(productToDelete.barcode); // Pass barcode
    } else if (alertAction === 'clearDatabase') {
      handleClearDatabase();
    } else {
         console.warn("Delete confirmation called with invalid state:", { alertAction, productToDelete });
         setOpenAlert(false); // Close dialog if state is invalid
         setProductToDelete(null);
         setAlertAction(null);
    }
    // Reset states are handled within individual handlers now
  }, [alertAction, productToDelete, handleDeleteProduct, handleClearDatabase]);


  // --- Google Sheet Loading ---

    const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrl) {
            toast({ variant: "destructive", title: "URL Requerida", description: "Introduce la URL de la hoja de Google." });
            return;
        }

        console.log("Starting Google Sheet load process...");
        setIsUploading(true);
        setUploadProgress(0);
        setUploadComplete(false);
        setProductsLoaded(0);
        setTotalProductsToLoad(0);
        setShowSheetInfoAlert(true); // Show info alert

        let productsFromSheet: Product[] = [];

        try {
            productsFromSheet = await fetchGoogleSheetData(googleSheetUrl);
            setTotalProductsToLoad(productsFromSheet.length);
            console.log(`Fetched ${productsFromSheet.length} products from sheet.`);

            if (productsFromSheet.length === 0) {
                 toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja. Verifique el formato y el acceso.", variant: "default", duration: 6000 });
                 // No need to set uploadComplete=true here
            } else {
                // --- Incremental Loading Logic ---
                const BATCH_SIZE = 100; // Process 100 products at a time
                let loadedCount = 0;

                for (let i = 0; i < productsFromSheet.length; i += BATCH_SIZE) {
                    const batch = productsFromSheet.slice(i, i + BATCH_SIZE);
                    await addProductsToDB(batch); // Add batch to IndexedDB

                    loadedCount += batch.length;
                    setProductsLoaded(loadedCount);
                    setUploadProgress(Math.round((loadedCount / productsFromSheet.length) * 100));

                    // Optional: Small delay to allow UI updates and prevent blocking
                    // await new Promise(resolve => setTimeout(resolve, 50));
                }
                // --- End Incremental Loading ---

                setUploadComplete(true); // Mark as complete
                console.log("Bulk add/update to IndexedDB completed incrementally.");

                // Reload data from DB to ensure UI consistency
                await loadInitialData();

                toast({ title: "Carga Completa", description: `Se procesaron ${productsFromSheet.length} productos desde la Hoja de Google.` });
            }

        } catch (error: any) {
            console.error("Error during Google Sheet load process:", error);
            setUploadComplete(false); // Ensure complete is false on error
            toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet. Verifique URL, permisos y formato.", duration: 9000 });

        } finally {
            setIsUploading(false); // Hide loading indicator
            // Do not hide the info alert immediately on error, maybe keep it or provide different feedback
            // setShowSheetInfoAlert(false); // Consider removing or delaying this
            console.log("Google Sheet load process finished.");
        }
    }, [googleSheetUrl, toast, loadInitialData, setDatabaseProducts]); // Dependencies


  // --- Export and Filtering ---

  const handleExportDatabase = useCallback(() => {
    if (databaseProducts.length === 0) {
      toast({ title: "Base de Datos Vacía", description: "No hay productos para exportar." });
      return;
    }
    try {
        const csvData = convertToCSV(databaseProducts);
        const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" }); // Add BOM for Excel compatibility
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.setAttribute("download", `product_database_${timestamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({ title: "Exportación Iniciada", description: "Se ha iniciado la descarga del archivo CSV." });
    } catch (error) {
         console.error("Error exporting database:", error);
         toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
    }
  }, [databaseProducts, toast]); // Added toast dependency

  const convertToCSV = useCallback((data: Product[]) => {
    if (!data || data.length === 0) return "";
    // Define headers consistently
    const headers = ["barcode", "description", "provider", "stock"];
     // Function to safely quote CSV fields
    const safeQuote = (field: any): string => {
        const str = String(field ?? ''); // Ensure it's a string, default to empty string if null/undefined
        // Escape double quotes within the field by doubling them, then enclose the whole field in double quotes.
        const escapedStr = str.replace(/"/g, '""');
        return `"${escapedStr}"`;
    };
    // Map data to rows, ensuring order matches headers
    const rows = data.map((product) => [
        safeQuote(product.barcode),
        safeQuote(product.description),
        safeQuote(product.provider),
        product.stock ?? 0, // Ensure stock is a number, default 0
    ]);

    // Join headers and rows
    return [
        headers.join(","), // Header row
        ...rows.map((row) => row.join(",")) // Data rows
    ].join("\n");
  }, []);


  const filteredProducts = databaseProducts.filter(product => {
      const searchTermLower = searchTerm.toLowerCase();
      const matchesSearch = searchTerm === "" ||
                            (product.barcode || '').toLowerCase().includes(searchTermLower) ||
                            (product.description || '').toLowerCase().includes(searchTermLower) ||
                             (product.provider || '').toLowerCase().includes(searchTermLower); // Include provider in search
      const matchesProvider = selectedProviderFilter === 'all' || product.provider === selectedProviderFilter;
      return matchesSearch && matchesProvider;
  });

  // Generate provider options dynamically, ensuring 'all' is first and handling empty/null providers
  const providerOptions = ["all", ...Array.from(new Set(databaseProducts.map(p => p.provider || "Desconocido").filter(p => p)))];


  // --- Render ---

  return (
    <div className="p-4 md:p-6 space-y-4"> {/* Added spacing */}
      {/* --- Toolbar --- */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        {/* Action Buttons */}
         <div className="flex flex-wrap gap-2">
            <Button onClick={() => { setSelectedProduct(null); reset({barcode: "", description: "", provider: "Desconocido", stock: 0}); setOpen(true); }}>
                Agregar Producto
            </Button>
            <Button onClick={handleExportDatabase} variant="outline">
                Exportar CSV <FileDown className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="destructive" onClick={triggerClearDatabaseAlert}>
               <Trash className="mr-2 h-4 w-4" /> Borrar Todo
            </Button>
        </div>

        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"> {/* Allow wrapping */}
           <Label htmlFor="search-product" className="sr-only">Buscar Producto</Label>
            <Input
                id="search-product"
                type="text"
                placeholder="Buscar por código, descripción, proveedor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10" // Consistent height
            />
            <Select value={selectedProviderFilter} onValueChange={setSelectedProviderFilter}>
                <SelectTrigger className="w-full sm:w-auto md:w-[200px] h-10"> {/* Responsive width */}
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Filtrar proveedor" />
                </SelectTrigger>
                <SelectContent>
                    {providerOptions.map(provider => (
                        <SelectItem key={provider} value={provider}>
                            {provider === 'all' ? 'Todos los Proveedores' : provider}
                        </SelectItem>
                    ))}
                    {providerOptions.length <= 1 && ( // Only 'all' option
                         <SelectItem value="no-providers" disabled>No hay proveedores</SelectItem>
                    )}
                </SelectContent>
            </Select>
        </div>
      </div>

      {/* --- Google Sheet Loader --- */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-4 border rounded-lg bg-card">
        <Label htmlFor="google-sheet-url" className="shrink-0 font-medium">
          Cargar desde Google Sheet:
        </Label>
        <Input
          id="google-sheet-url"
          type="url"
          placeholder="URL de Hoja de Google (pública y compartida)"
          value={googleSheetUrl}
          onChange={(e) => setGoogleSheetUrl(e.target.value)}
          className="flex-grow h-10" // Adjusted size
          disabled={isUploading}
          aria-describedby="google-sheet-info"
        />
        <Button variant="secondary" disabled={isUploading || !googleSheetUrl} onClick={handleLoadFromGoogleSheet}>
            <Upload className="mr-2 h-4 w-4" />
            {isUploading ? 'Cargando...' : 'Cargar Datos'}
        </Button>
      </div>
       {/* --- Loading Indicators and Alerts --- */}
      <div id="google-sheet-info">
        {showSheetInfoAlert && (
            <Alert className="mb-4 bg-blue-50 border-blue-300 text-blue-800 text-sm">
                <SheetIcon className="h-5 w-5 text-blue-600" />
                <AlertTitle className="font-semibold">Cargando desde Google Sheet</AlertTitle>
                <AlertDescription>
                    Asegúrese de que la hoja sea <span className="font-medium">pública y accesible ('Cualquier persona con el enlace')</span>.
                    Se leerán las columnas por posición: <span className="font-medium">1: Cód. Barras, 2: Descripción, 3: Proveedor, 4: Stock</span>.
                    Los encabezados son ignorados.
                </AlertDescription>
            </Alert>
        )}
        {isUploading && (
            <div className="my-4 space-y-2">
            <Progress value={uploadProgress} className="h-2 w-full" />
            <p className="text-sm text-muted-foreground text-center">
                {uploadComplete ? `Procesados ${productsLoaded} productos.` : `Cargando ${productsLoaded} de ${totalProductsToLoad || 'muchos'} (${uploadProgress}%)`}
            </p>
            </div>
        )}
         {/* Show success message separately after upload completes */}
        {uploadComplete && !isUploading && totalProductsToLoad > 0 && (
             <Alert variant="default" className="my-4 bg-green-50 border-green-300 text-green-800">
               <AlertTitle className="font-semibold">Carga Completa</AlertTitle>
               <AlertDescription>
                   Se procesaron {productsLoaded} productos desde la Hoja de Google y se actualizaron en la base de datos local.
                </AlertDescription>
            </Alert>
        )}
         {/* Persistent error if IndexedDB is not supported */}
         {typeof window !== 'undefined' && !window.indexedDB && (
             <Alert variant="destructive" className="my-4">
                <AlertTitle>Error Crítico</AlertTitle>
                <AlertDescription>
                    Este navegador no soporta IndexedDB. La funcionalidad de base de datos local no está disponible.
                </AlertDescription>
             </Alert>
         )}
      </div>

      {/* --- Confirmation Dialog (for Delete/Clear) --- */}
      <AlertDialog open={openAlert} onOpenChange={setOpenAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás realmente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              {alertAction === 'deleteProduct' && productToDelete ?
                `Estás a punto de eliminar permanentemente el producto "${productToDelete.description}" (Código: ${productToDelete.barcode}). Esta acción no se puede deshacer.`
                 : alertAction === 'clearDatabase' ?
                 "Estás a punto de eliminar TODOS los productos de la base de datos local permanentemente. Esta acción no se puede deshacer."
                 : "Esta acción no se puede deshacer."
                }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpenAlert(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
                onClick={handleDeleteConfirmation}
                className={cn(
                    alertAction === 'clearDatabase' || alertAction === 'deleteProduct'
                        ? "bg-red-600 hover:bg-red-700 text-white"
                        : "bg-destructive hover:bg-destructive/90" // Default destructive style if action type is unexpected
                )}
             >
              {alertAction === 'deleteProduct' ? "Sí, Eliminar Producto" : alertAction === 'clearDatabase' ? "Sí, Borrar Todo" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* --- Products Table --- */}
      <ScrollArea className="h-[calc(100vh-500px)] border rounded-lg shadow-sm"> {/* Adjusted height */}
        <Table>
           <TableCaption>
              {filteredProducts.length === 0
                ? (searchTerm || selectedProviderFilter !== 'all' ? 'No hay productos que coincidan con la búsqueda/filtro.' : 'La base de datos está vacía o cargando.')
                : `Mostrando ${filteredProducts.length} de ${databaseProducts.length} productos.`
              }
          </TableCaption>
           <TableHeader className="sticky top-0 bg-background z-10 shadow-sm"> {/* Added shadow */}
            <TableRow>
              {/* Adjusted widths and hidden classes */}
              <TableHead className="w-[20%] px-3 py-3">Código Barras</TableHead>
              <TableHead className="w-[45%] px-3 py-3">Descripción (Click para editar)</TableHead>
              {/* Provider column shown on desktop */}
              {/* <TableHead className="w-[20%] px-3 py-3 hidden md:table-cell">Proveedor</TableHead> */}
              <TableHead className="w-[15%] px-3 py-3 text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map((product) => (
              <TableRow key={product.barcode} className="hover:bg-muted/50 text-sm transition-colors duration-150">
                <TableCell className="px-3 py-2 font-medium" aria-label={`Código ${product.barcode}`}>
                  {product.barcode}
                </TableCell>
                 {/* Click on description to edit */}
                <TableCell
                    className="px-3 py-2 cursor-pointer hover:text-primary hover:underline"
                    onClick={() => handleOpenEditDialog(product)}
                     aria-label={`Editar producto ${product.description}`}
                    >
                  {product.description}
                </TableCell>
                 {/* Provider column shown on desktop */}
                 {/* <TableCell className="px-3 py-2 hidden md:table-cell text-muted-foreground" aria-label={`Proveedor ${product.provider}`}>
                  {product.provider || 'N/A'}
                </TableCell> */}
                <TableCell className="px-3 py-2 text-right font-medium tabular-nums text-muted-foreground" aria-label={`Stock ${product.stock}`}>
                  {product.stock}
                </TableCell>
              </TableRow>
            ))}
             {/* Loading State Placeholder */}
            {isUploading && databaseProducts.length === 0 && (
                <TableRow>
                    <TableCell colSpan={isMobile ? 3 : 3} className="text-center py-10 text-muted-foreground">
                        Cargando datos iniciales...
                    </TableCell>
                </TableRow>
            )}
             {/* Empty State */}
            {!isUploading && filteredProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={isMobile ? 3 : 3} className="text-center py-10 text-muted-foreground">
                  {databaseProducts.length > 0 ? "No hay productos que coincidan con los filtros." : "La base de datos está vacía. Agregue productos o cargue desde Google Sheet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* --- Add/Edit Product Dialog --- */}
      <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { setOpen(false); setSelectedProduct(null); reset(); } else { setOpen(true); } }}>
        <DialogContent className="sm:max-w-lg"> {/* Slightly wider */}
          <DialogHeader>
            <DialogTitle>{selectedProduct ? "Editar Producto" : "Agregar Nuevo Producto"}</DialogTitle>
            <DialogDescription>
              {selectedProduct ? "Modifica los detalles del producto existente." : "Añade un nuevo producto a la base de datos."}
            </DialogDescription>
          </DialogHeader>
          <Form {...productForm}>
            {/* Pass the handler function directly to onSubmit */}
            <form onSubmit={handleSubmit(handleAddOrUpdateProduct)} className="space-y-4 p-2">
              <FormField
                control={control}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código de Barras *</FormLabel>
                    <FormControl>
                      {/* Make barcode read-only when editing */}
                      <Input type="text" {...field} readOnly={!!selectedProduct} aria-required="true" />
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
                    <FormLabel>Descripción *</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} aria-required="true" />
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
                      <Input type="text" {...field} placeholder="Opcional"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="stock"
                 render={({ field: { onChange, onBlur, value, name, ref } }) => (
                  <FormItem>
                    <FormLabel>Stock *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        ref={ref}
                        name={name}
                        value={value ?? ''} // Handle undefined/null for controlled input
                        onChange={(e) => {
                           // Allow empty string temporarily, convert to number on change
                           const rawValue = e.target.value;
                           onChange(rawValue === '' ? '' : Number(rawValue)); // Pass empty string or number
                        }}
                        onBlur={(e) => {
                            // On blur, ensure it's a valid number or default to 0
                            const finalValue = Number(e.target.value);
                            onChange(isNaN(finalValue) || finalValue < 0 ? 0 : finalValue);
                        }}
                        min="0"
                        step="1" // Ensure whole numbers if needed
                        aria-required="true"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between w-full pt-6 gap-2">
                   {/* Delete Button only shows when editing */}
                   {selectedProduct && (
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={() => triggerDeleteProductAlert(selectedProduct)}
                        className="sm:mr-auto" // Push to left on larger screens
                    >
                        <Trash className="mr-2 h-4 w-4" /> Eliminar Producto
                    </Button>
                   )}
                   {/* Spacer to push buttons to right when delete is not visible */}
                  {!selectedProduct && <div className="sm:mr-auto"></div>}

                   <div className="flex gap-2 justify-end">
                        <DialogClose asChild>
                            <Button type="button" variant="outline">Cancelar</Button>
                        </DialogClose>
                         <Button type="submit" disabled={isUploading}>
                            {isUploading ? "Guardando..." : (selectedProduct ? <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</> : "Agregar Producto")}
                        </Button>
                   </div>
               </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
