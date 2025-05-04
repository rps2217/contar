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
    Upload,
    AlertCircle // For error indication
} from "lucide-react";
import Papa from 'papaparse'; // Using PapaParse for robust CSV parsing
import * as React from "react"; // Import React
import { useCallback, useEffect, useState, useRef } from "react"; // Added useRef
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
    z.number().min(0, { message: "El stock debe ser mayor o igual a 0." }).optional().default(0) // Make stock optional and default to 0
  ),
});

type ProductValues = z.infer<typeof productSchema>;

interface ProductDatabaseProps {
  // Keep these props for communication with parent (page.tsx)
  databaseProducts: Product[];
  setDatabaseProducts: (products: Product[] | ((prevProducts: Product[]) => Product[])) => void;
}


// --- Google Sheet Parsing Logic (Position-Based) ---
const parseGoogleSheetUrl = (sheetUrl: string): { spreadsheetId: string | null; gid: string } => {
    try {
        new URL(sheetUrl); // Basic URL validation
    } catch (error) {
        console.error("Invalid Google Sheet URL provided:", sheetUrl, error);
        throw new Error("URL de Hoja de Google inválida.");
    }
    const spreadsheetIdMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);

    const spreadsheetId = spreadsheetIdMatch ? spreadsheetIdMatch[1] : null;
    const gid = gidMatch ? gidMatch[1] : '0'; // Default to first sheet

    if (!spreadsheetId) {
         console.warn("Could not extract spreadsheet ID from URL:", sheetUrl);
         throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL.");
    }
    return { spreadsheetId, gid };
};

async function fetchGoogleSheetData(sheetUrl: string): Promise<Product[]> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrl);
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log("Fetching Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        // Add cache-busting parameter
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" }); // Try fetching without cache
    } catch (error: any) {
        console.error("Network error fetching Google Sheet:", error);
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL.";
        if (error.message?.includes('Failed to fetch')) {
            userMessage += " Posible problema de CORS o conectividad, o la URL es incorrecta.";
        } else {
             userMessage += ` Detalle: ${error.message}`;
         }
        throw new Error(userMessage);
    }

    if (!response.ok) {
        const status = response.status;
        const statusText = response.statusText;
        const errorBody = await response.text().catch(() => "Could not read error response body.");
        console.error(`Failed to fetch Google Sheet data: ${status} ${statusText}`, { url: csvExportUrl, body: errorBody.substring(0, 500) }); // Log truncated body

        let userMessage = `Error ${status} al obtener datos. `;
        if (status === 400) userMessage += "Verifique la URL y asegúrese de que el ID de la hoja (gid=${gid}) sea correcto.";
        else if (status === 403 || errorBody.toLowerCase().includes("google accounts sign in")) userMessage = "Error de Acceso: La hoja no es pública. Cambie la configuración de compartir a 'Cualquier persona con el enlace puede ver'.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL y el ID de la hoja.";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL.`;

        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log(`Successfully fetched CSV data (length: ${csvText.length}). Parsing...`);

    // --- Robust CSV Parsing Logic - Rely on Column Position ---
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 1) {
        console.warn("CSV data is empty or contains only empty lines.");
        return [];
    }

    const products: Product[] = [];
    // Skip header row: Assume first non-empty row is the header. Find the first non-empty row.
    let headerRowIndex = 0;
    while (headerRowIndex < lines.length && !lines[headerRowIndex].trim()) {
        headerRowIndex++;
    }
     // Start processing data from the row after the header
    const startDataRow = headerRowIndex + 1;

    if (startDataRow >= lines.length) {
        console.warn("CSV contains only a header row or is empty.");
        return [];
    }

    console.log(`Processing data starting from row ${startDataRow + 1} (1-based index). Header found at row ${headerRowIndex + 1}.`);


    for (let i = startDataRow; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines

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

        if (values.length === 0 || !values[0]?.trim()) {
            console.warn(`Skipping row ${i + 1}: Missing or empty barcode (Column 1). Line: "${line}"`);
            continue;
        }

        const barcode = values[0].trim();
        const description = values.length > 1 && values[1]?.trim() ? values[1].trim() : `Producto ${barcode}`;
        const provider = values.length > 2 && values[2]?.trim() ? values[2].trim() : "Desconocido";
        const stockStr = values.length > 3 ? values[3]?.trim() : '0';
        const stock = parseInt(stockStr, 10);

        // Basic validation: ensure barcode is not excessively long (e.g., > 100 chars)
        if (barcode.length > 100) {
             console.warn(`Skipping row ${i + 1}: Barcode too long (${barcode.length} chars). Line: "${line}"`);
            continue;
        }

        products.push({
            barcode: barcode,
            description: description,
            provider: provider,
            stock: isNaN(stock) || stock < 0 ? 0 : stock,
            count: 0, // Initialize count to 0 for DB
            lastUpdated: new Date().toISOString(),
        });
    }
    console.log(`Parsed ${products.length} products from CSV based on column position.`);
    return products;
}


// --- React Component ---

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({
  databaseProducts, // State from parent (page.tsx)
  setDatabaseProducts, // Setter from parent
}) => {
  const { toast } = useToast();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false); // State for Add/Edit Dialog
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null); // Product being edited
  const [isAlertOpen, setIsAlertOpen] = useState(false); // State for Confirmation Dialogs
  const [alertAction, setAlertAction] = useState<'deleteProduct' | 'clearDatabase' | null>(null); // Type of confirmation
  const [productToDelete, setProductToDelete] = useState<Product | null>(null); // Product for delete confirmation
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false); // Combined loading state
  const [processingStatus, setProcessingStatus] = useState<string>(""); // Detailed status message
  const [totalProductsToLoad, setTotalProductsToLoad] = useState(0);
  const [productsLoaded, setProductsLoaded] = useState(0);
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const isMobile = useIsMobile(); // Hook to detect mobile view

  // Reference for the file input to reset it
  const fileInputRef = useRef<HTMLInputElement>(null);

  const productForm = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    // Default values for the form
    defaultValues: { barcode: "", description: "", provider: "Desconocido", stock: 0 },
  });
  const { handleSubmit, reset, control, setValue, formState: { errors } } = productForm;

   // Debug form errors
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.warn("Form validation errors:", errors);
    }
  }, [errors]);

  // --- Initial Data Loading ---
  // This component now relies on the parent `page.tsx` to load initial data
  // and pass it via the `databaseProducts` prop.
  // We keep a local loading state for operations within this component.

  // --- CRUD Handlers (Interacting with IndexedDB and Parent State) ---

  const handleAddOrUpdateProduct = useCallback(async (data: ProductValues) => {
    const isUpdating = !!selectedProduct;
    const productData: Product = {
        barcode: isUpdating ? selectedProduct.barcode : data.barcode.trim(),
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
        stock: Number(data.stock) || 0,
        count: selectedProduct?.count ?? 0, // Preserve count if updating
        lastUpdated: new Date().toISOString()
    };

    console.log(`${isUpdating ? 'Updating' : 'Adding'} product:`, productData);

    if (!productData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }

    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        if (isUpdating) {
             await updateProductInDB(productData);
        } else {
            // Check if barcode already exists before adding
            const existing = databaseProducts.find(p => p.barcode === productData.barcode);
            if (existing) {
                 throw new Error(`El producto con código de barras ${productData.barcode} ya existe.`);
            }
            await addProductsToDB([productData]);
        }

        // Update parent state (page.tsx)
        setDatabaseProducts(prevProducts => {
            const existingIndex = prevProducts.findIndex(p => p.barcode === productData.barcode);
            let newProducts;
            if (existingIndex > -1) {
                newProducts = [...prevProducts];
                newProducts[existingIndex] = { ...prevProducts[existingIndex], ...productData };
            } else {
                newProducts = [productData, ...prevProducts]; // Add new product to the top
            }
            return newProducts;
        });

        toast({
            title: isUpdating ? "Producto Actualizado" : "Producto Agregado",
            description: `${productData.description} (${productData.barcode}) ha sido ${isUpdating ? 'actualizado' : 'agregado'}.`,
        });
        reset({ barcode: "", description: "", provider: "Desconocido", stock: 0 });
        setIsEditModalOpen(false);
        setSelectedProduct(null);
    } catch (error: any) {
        console.error("Database operation failed", error);
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.message?.includes('ya existe') || error.name === 'ConstraintError') {
             errorMessage = `El producto con código de barras ${productData.barcode} ya existe.`;
        } else if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        toast({ variant: "destructive", title: "Error de Base de Datos", description: errorMessage, duration: 9000 });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
    }
}, [selectedProduct, setDatabaseProducts, databaseProducts, toast, reset]);


  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
      if (!barcode) {
          toast({ variant: "destructive", title: "Error Interno", description: "No se puede eliminar el producto sin código de barras." });
          return; // Exit early
      }
      console.log(`Attempting to delete product with barcode: ${barcode}`);
      setIsProcessing(true);
      setProcessingStatus("Eliminando producto...");
      try {
        await deleteProductFromDB(barcode);
        // Update parent state (page.tsx)
        setDatabaseProducts(prevProducts => prevProducts.filter(p => p.barcode !== barcode));
        toast({
          title: "Producto Eliminado",
          description: `El producto con código ${barcode} ha sido eliminado.`,
        });
      } catch (error: any) {
        console.error("Failed to delete product from database", error);
        toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}`, duration: 9000 });
      } finally {
          setIsProcessing(false);
          setProcessingStatus("");
          setIsAlertOpen(false); // Close confirmation dialog
          setProductToDelete(null); // Clear the product slated for deletion
          setAlertAction(null);
          // If the edit dialog was open for the deleted product, close it and reset
          if (selectedProduct?.barcode === barcode) {
             setIsEditModalOpen(false);
             setSelectedProduct(null);
             reset();
          }
      }
  }, [setDatabaseProducts, toast, reset, selectedProduct]); // Added dependencies


  const handleClearDatabase = useCallback(async () => {
    console.log("Attempting to clear the entire database.");
    setIsProcessing(true);
    setProcessingStatus("Borrando base de datos...");
    try {
      await clearDatabaseDB();
      setDatabaseProducts([]); // Clear parent component state immediately
      toast({ title: "Base de Datos Borrada", description: "Todos los productos han sido eliminados." });
    } catch (error: any) {
      console.error("Failed to clear database", error);
      toast({ variant: "destructive", title: "Error al Borrar DB", description: `No se pudo borrar la base de datos: ${error.message}`, duration: 9000 });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
        setIsAlertOpen(false); // Close confirmation
        setAlertAction(null);
    }
  }, [setDatabaseProducts, toast]); // Dependencies


  // --- Dialog and Alert Triggers ---

  const handleOpenEditDialog = useCallback((product: Product | null) => {
    // If product is null, it's an "Add New" operation
    setSelectedProduct(product);
    if (product) {
        console.log("Opening edit dialog for:", product);
        // Pre-fill form with existing product data
        reset({
            barcode: product.barcode || "",
            description: product.description || "",
            provider: product.provider || "Desconocido",
            stock: product.stock ?? 0,
        });
    } else {
         console.log("Opening add new product dialog.");
        // Reset form for adding a new product
        reset({ barcode: "", description: "", provider: "Desconocido", stock: 0 });
    }
    setIsEditModalOpen(true);
  }, [reset]);

  const triggerDeleteProductAlert = useCallback((product: Product | null) => {
      if (!product) {
         toast({ variant: "destructive", title: "Error Interno", description: "Datos del producto no disponibles para eliminar." });
         return;
      }
      console.log("Triggering delete confirmation for:", product);
      setProductToDelete(product);
      setAlertAction('deleteProduct');
      setIsAlertOpen(true);
  }, [toast]);

  const triggerClearDatabaseAlert = useCallback(() => {
      console.log("Triggering clear database confirmation.");
      if (databaseProducts.length === 0) {
           toast({ title: "Base de Datos Vacía", description: "La base de datos ya está vacía." });
           return;
      }
      setAlertAction('clearDatabase');
      setIsAlertOpen(true);
  }, [databaseProducts, toast]);

  const handleDeleteConfirmation = useCallback(() => {
    console.log(`Confirming action: ${alertAction}`);
    if (alertAction === 'deleteProduct' && productToDelete) {
      handleDeleteProduct(productToDelete.barcode); // Pass barcode
    } else if (alertAction === 'clearDatabase') {
      handleClearDatabase();
    } else {
         console.warn("Delete confirmation called with invalid state:", { alertAction, productToDelete });
         setIsAlertOpen(false); // Close dialog if state is invalid
         setProductToDelete(null);
         setAlertAction(null);
    }
    // Reset states are handled within individual handlers now
  }, [alertAction, productToDelete, handleDeleteProduct, handleClearDatabase]);


  // --- Google Sheet Loading (using fetchGoogleSheetData) ---

    const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrl) {
            toast({ variant: "destructive", title: "URL Requerida", description: "Introduce la URL de la hoja de Google." });
            return;
        }

        console.log("Starting Google Sheet load process...");
        setIsProcessing(true);
        setUploadProgress(0);
        setProductsLoaded(0);
        setTotalProductsToLoad(0);
        setProcessingStatus("Obteniendo datos de Google Sheet...");

        let productsFromSheet: Product[] = [];

        try {
            productsFromSheet = await fetchGoogleSheetData(googleSheetUrl);
            setTotalProductsToLoad(productsFromSheet.length);
            console.log(`Fetched ${productsFromSheet.length} products from sheet.`);

            if (productsFromSheet.length === 0) {
                 toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja. Verifique el formato, acceso y contenido.", variant: "default", duration: 6000 });
            } else {
                // --- Incremental Database Update ---
                setProcessingStatus(`Actualizando base de datos con ${productsFromSheet.length} productos...`);
                const BATCH_SIZE = 100; // Process in batches
                let loadedCount = 0;

                for (let i = 0; i < productsFromSheet.length; i += BATCH_SIZE) {
                    const batch = productsFromSheet.slice(i, i + BATCH_SIZE);
                     // Use addProductsToDB which handles bulk 'put' operations (add or update)
                    await addProductsToDB(batch);

                    loadedCount += batch.length;
                    setProductsLoaded(loadedCount);
                    setUploadProgress(Math.round((loadedCount / productsFromSheet.length) * 100));
                    setProcessingStatus(`Actualizando base de datos... ${loadedCount}/${productsFromSheet.length}`);

                    // Optional delay for UI update responsiveness
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                // --- End Incremental Update ---

                console.log("Bulk add/update to IndexedDB completed.");

                // After DB update, refresh the state in the parent component
                const updatedDbProducts = await getAllProductsFromDB();
                setDatabaseProducts(updatedDbProducts); // Update parent state

                toast({ title: "Carga Completa", description: `Se procesaron ${productsFromSheet.length} productos desde la Hoja de Google.` });
            }

        } catch (error: any) {
            console.error("Error during Google Sheet load process:", error);
            setProcessingStatus("Error durante la carga.");
            toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet. Verifique URL, permisos y formato.", duration: 9000 });

        } finally {
            setIsProcessing(false);
            setProcessingStatus(""); // Clear status
            setUploadProgress(0); // Reset progress
             // Optionally clear the URL input after processing
            // setGoogleSheetUrl("");
            console.log("Google Sheet load process finished.");
        }
    }, [googleSheetUrl, toast, setDatabaseProducts]); // Dependencies


  // --- Export and Filtering ---

  const handleExportDatabase = useCallback(() => {
    if (databaseProducts.length === 0) {
      toast({ title: "Base de Datos Vacía", description: "No hay productos para exportar." });
      return;
    }
    try {
        const csvData = convertToCSV(databaseProducts);
        const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" }); // Add BOM for Excel
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

  // Converts product data to CSV format string
  const convertToCSV = useCallback((data: Product[]) => {
    if (!data || data.length === 0) return "";
    // Define headers consistently
    const headers = ["barcode", "description", "provider", "stock"];
     // Function to safely quote CSV fields
    const safeQuote = (field: any): string => {
        const str = String(field ?? ''); // Ensure it's a string, default to empty string if null/undefined
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


  // Filter products based on search term and provider selection
  const filteredProducts = React.useMemo(() => {
        return databaseProducts.filter(product => {
            const searchTermLower = searchTerm.toLowerCase();
            const matchesSearch = searchTerm === "" ||
                                (product.barcode || '').toLowerCase().includes(searchTermLower) ||
                                (product.description || '').toLowerCase().includes(searchTermLower) ||
                                (product.provider || '').toLowerCase().includes(searchTermLower);
            const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;
            return matchesSearch && matchesProvider;
        });
   }, [databaseProducts, searchTerm, selectedProviderFilter]); // Recalculate only when dependencies change

  // Generate unique provider options for the filter dropdown
  const providerOptions = React.useMemo(() => {
       const providers = new Set(databaseProducts.map(p => p.provider || "Desconocido").filter(Boolean)); // Filter out empty/null providers
       return ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1; // Keep 'all' first
            if (b === 'all') return 1;
            return (a as string).localeCompare(b as string); // Sort alphabetically
        });
   }, [databaseProducts]);


  // --- Render ---

  return (
    <div className="p-4 md:p-6 space-y-6"> {/* Increased spacing */}
      {/* --- Toolbar --- */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
        {/* Action Buttons */}
         <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleOpenEditDialog(null)} disabled={isProcessing}>
                Agregar Producto
            </Button>
            <Button onClick={handleExportDatabase} variant="outline" disabled={databaseProducts.length === 0 || isProcessing}>
                Exportar CSV <FileDown className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="destructive" onClick={triggerClearDatabaseAlert} disabled={databaseProducts.length === 0 || isProcessing}>
               <Trash className="mr-2 h-4 w-4" /> Borrar Todo
            </Button>
        </div>

        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto"> {/* Allow wrapping */}
           <Label htmlFor="search-product" className="sr-only">Buscar Producto</Label>
            <Input
                id="search-product"
                type="text"
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 flex-grow min-w-[150px]" // Consistent height, allow grow
                disabled={isProcessing}
            />
            <Select
                value={selectedProviderFilter}
                onValueChange={setSelectedProviderFilter}
                disabled={providerOptions.length <= 1 || isProcessing}
            >
                <SelectTrigger className="w-full sm:w-auto md:w-[200px] h-10"> {/* Responsive width */}
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
        </div>
      </div>

      {/* --- Google Sheet Loader --- */}
      <div className="space-y-2 p-4 border rounded-lg bg-card shadow-sm">
          <Label htmlFor="google-sheet-url" className="block font-medium mb-1">
             Cargar/Actualizar desde Google Sheet:
          </Label>
         <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <Input
            id="google-sheet-url"
            type="url"
            placeholder="URL de Hoja de Google (pública y compartida)"
            value={googleSheetUrl}
            onChange={(e) => setGoogleSheetUrl(e.target.value)}
            className="flex-grow h-10" // Adjusted size
            disabled={isProcessing}
            aria-describedby="google-sheet-info"
            />
            <Button variant="secondary" disabled={isProcessing || !googleSheetUrl} onClick={handleLoadFromGoogleSheet}>
                <Upload className="mr-2 h-4 w-4" />
                {isProcessing && processingStatus.includes("Google") ? 'Cargando...' : 'Cargar Datos'}
            </Button>
        </div>
        <p id="google-sheet-info" className="text-xs text-muted-foreground mt-1">
              Asegúrese de que la hoja sea pública ('Cualquier persona con el enlace'). Se leerán columnas por posición: 1:Cód. Barras, 2:Descripción, 3:Proveedor, 4:Stock.
        </p>
         {/* --- Loading Indicators --- */}
        {isProcessing && (
            <div className="mt-4 space-y-1">
                <Progress value={uploadProgress} className="h-2 w-full" />
                <p className="text-sm text-muted-foreground text-center">
                    {processingStatus || `Cargando ${productsLoaded} de ${totalProductsToLoad || 'muchos'} (${uploadProgress}%)`}
                </p>
            </div>
        )}
        {/* --- Persistent error if IndexedDB is not supported --- */}
         {typeof window !== 'undefined' && !window.indexedDB && (
             <Alert variant="destructive" className="my-4">
                 <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Crítico</AlertTitle>
                <AlertDescription>
                    Este navegador no soporta IndexedDB. La funcionalidad de base de datos local no está disponible.
                </AlertDescription>
             </Alert>
         )}
      </div>


      {/* --- Confirmation Dialog (for Delete/Clear) --- */}
      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
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
            <AlertDialogCancel onClick={() => setIsAlertOpen(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
                onClick={handleDeleteConfirmation}
                className={cn(
                    (alertAction === 'clearDatabase' || alertAction === 'deleteProduct') && "bg-red-600 hover:bg-red-700"
                )}
             >
              {alertAction === 'deleteProduct' ? "Sí, Eliminar Producto" : alertAction === 'clearDatabase' ? "Sí, Borrar Todo" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* --- Products Table --- */}
      {/* Responsive ScrollArea height */}
      <ScrollArea className="border rounded-lg shadow-sm h-[calc(100vh-420px)] md:h-[calc(100vh-380px)]">
        <Table>
           <TableCaption>
              {filteredProducts.length === 0
                ? (databaseProducts.length > 0 ? 'No hay productos que coincidan con la búsqueda/filtro.' : 'La base de datos está vacía. Agregue productos o cargue desde Google Sheet.')
                : `Mostrando ${filteredProducts.length} de ${databaseProducts.length} productos.`
              }
          </TableCaption>
           {/* Sticky header */}
           <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
            <TableRow>
              {/* Adjusted widths and visible columns */}
              <TableHead className="w-[20%] px-3 py-3">Código Barras</TableHead>
              <TableHead className="w-[45%] px-3 py-3">Descripción (Click para editar)</TableHead>
              {/* Provider column shown on desktop only */}
              <TableHead className="w-[20%] px-3 py-3 hidden md:table-cell">Proveedor</TableHead>
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
                    title={`Editar ${product.description}`} // Tooltip for clarity
                    >
                  {product.description}
                </TableCell>
                 {/* Provider column shown on desktop */}
                 <TableCell className="px-3 py-2 hidden md:table-cell text-muted-foreground" aria-label={`Proveedor ${product.provider}`}>
                  {product.provider || 'N/A'}
                </TableCell>
                <TableCell className="px-3 py-2 text-right font-medium tabular-nums text-muted-foreground" aria-label={`Stock ${product.stock}`}>
                  {product.stock ?? 0}
                </TableCell>
              </TableRow>
            ))}
             {/* Loading State Placeholder */}
            {isProcessing && databaseProducts.length === 0 && !processingStatus.includes("Google") && (
                <TableRow>
                    <TableCell colSpan={isMobile ? 3 : 4} className="text-center py-10 text-muted-foreground">
                       {processingStatus || "Procesando..."}
                    </TableCell>
                </TableRow>
            )}
             {/* Empty State */}
            {!isProcessing && filteredProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={isMobile ? 3 : 4} className="text-center py-10 text-muted-foreground">
                  {databaseProducts.length > 0 ? "No hay productos que coincidan con los filtros." : "La base de datos está vacía. Agregue productos o cargue desde una fuente externa."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* --- Add/Edit Product Dialog --- */}
      <Dialog open={isEditModalOpen} onOpenChange={(isOpen) => { if (!isOpen) { setIsEditModalOpen(false); setSelectedProduct(null); reset(); } else { setIsEditModalOpen(true); } }}>
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
                      <Input type="text" {...field} readOnly={!!selectedProduct} aria-required="true" disabled={isProcessing} />
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
                       {/* Using Input instead of Textarea for consistency, adjust if needed */}
                      <Input type="text" {...field} aria-required="true" disabled={isProcessing} />
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
                      <Input type="text" {...field} placeholder="Opcional" disabled={isProcessing}/>
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
                           const rawValue = e.target.value;
                           // Allow empty string temporarily for typing, convert to number otherwise
                           onChange(rawValue === '' ? '' : Number(rawValue));
                        }}
                        onBlur={(e) => {
                            // On blur, ensure it's a valid non-negative number or default to 0
                            const finalValue = Number(e.target.value);
                            onChange(isNaN(finalValue) || finalValue < 0 ? 0 : finalValue);
                        }}
                        min="0"
                        step="1" // Ensure whole numbers
                        aria-required="true"
                        disabled={isProcessing}
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
                        disabled={isProcessing}
                    >
                        <Trash className="mr-2 h-4 w-4" /> Eliminar Producto
                    </Button>
                   )}
                   {/* Spacer to push buttons to right when delete is not visible */}
                  {!selectedProduct && <div className="sm:mr-auto"></div>}

                   <div className="flex gap-2 justify-end">
                        <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={isProcessing}>Cancelar</Button>
                        </DialogClose>
                         <Button type="submit" disabled={isProcessing}>
                            {isProcessing ? "Guardando..." : (selectedProduct ? <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</> : "Agregar Producto")}
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
