// Ensure this file starts with "use client" if it uses client-side hooks like useState, useEffect, etc.
"use client";

// Import updated types
import type { ProductDetail, InventoryItem } from '@/types/product'; // Keep DisplayProduct if used elsewhere, but focus on Detail and Inventory
import { zodResolver } from "@hookform/resolvers/zod";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
// Import updated DB helpers
import {
    addOrUpdateProductDetail,
    getAllProductDetails,
    deleteProductCompletely, // Use this for full deletion
    clearDatabaseCompletely, // Use this for full clear
    addOrUpdateInventoryItem,
    // getInventoryItemsForProduct, // Might not be needed directly here
    getAllInventoryItems,
    addInventoryItemsInBulk,
    addProductDetailsInBulk,
    // openDB // Keep openDB if needed for direct access, but prefer helpers
} from '@/lib/indexeddb-helpers';
import {
    Edit, FileDown, Filter, Save, Trash, Upload, AlertCircle, Warehouse as WarehouseIcon
} from "lucide-react";
import Papa from 'papaparse'; // Using PapaParse for robust CSV parsing
import * as React from "react"; // Import React
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
    Form, FormControl, FormDescription as FormDescUi, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form"; // Renamed FormDescription import
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
// import { Textarea } from "@/components/ui/textarea"; // Not used?
import { format } from 'date-fns'; // Keep format if needed for display

// Schema for editing Product Detail - ADD STOCK for creation
const productDetailSchema = z.object({
  barcode: z.string().min(1, { message: "El código de barras es requerido." }),
  description: z.string().min(1, { message: "La descripción es requerida." }),
  provider: z.string().optional(),
  stock: z.preprocess( // Add stock field for initial creation
    (val) => (val === "" || val === undefined || val === null ? 0 : Number(val)),
    z.number().min(0, { message: "El stock debe ser mayor o igual a 0." }).optional().default(0)
  ),
});
type ProductDetailValues = z.infer<typeof productDetailSchema>;


// Removed props for databaseProducts/setDatabaseProducts as state is managed locally now
interface ProductDatabaseProps {
    // Add props if needed for interaction, e.g., onDatabaseUpdate callback
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

// Updated function to parse both details and inventory (assuming specific sheet format)
async function fetchAndParseGoogleSheetData(sheetUrl: string): Promise<{ details: ProductDetail[], inventory: InventoryItem[] }> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrl);
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log("Fetching Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        // Bypass cache for fresh data
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" });
    } catch (error: any) {
        console.error("Network error fetching Google Sheet:", error);
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL.";
        // Add more specific error details if possible
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
        // Attempt to read the error body for more context
        const errorBody = await response.text().catch(() => "Could not read error response body.");
        console.error(`Failed to fetch Google Sheet data: ${status} ${statusText}`, { url: csvExportUrl, body: errorBody.substring(0, 500) }); // Log first 500 chars of body

        let userMessage = `Error ${status} al obtener datos. `;
        if (status === 400) userMessage += "Verifique la URL y asegúrese de que el ID de la hoja (gid=...) sea correcto.";
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
         return { details: [], inventory: [] };
     }

     const productDetails: ProductDetail[] = [];
     const inventoryItems: InventoryItem[] = [];
     // Assuming the 'main' warehouse ID. Adjust if needed.
     const defaultWarehouseId = 'main';

      // Find header row index (skip potential empty leading lines)
      let headerRowIndex = 0;
      while (headerRowIndex < lines.length && !lines[headerRowIndex].trim()) {
          headerRowIndex++;
      }
      const startDataRow = headerRowIndex + 1; // Data starts after the header

      if (startDataRow >= lines.length) {
          console.warn("CSV contains only a header row or is empty.");
          return { details: [], inventory: [] };
      }

     console.log(`Processing data starting from row ${startDataRow + 1} (1-based index). Header found at row ${headerRowIndex + 1}.`);


     for (let i = startDataRow; i < lines.length; i++) {
         const line = lines[i].trim();
         if (!line) continue; // Skip empty lines

         // Parse using PapaParse for robustness with quotes and commas
         const result = Papa.parse<string[]>(line, { delimiter: ',', skipEmptyLines: true });

         if (result.errors.length > 0) {
             console.warn(`Skipping row ${i + 1} due to parsing errors: ${result.errors[0].message}. Line: "${line}"`);
             continue;
         }
         if (!result.data || result.data.length === 0 || !result.data[0] || result.data[0].length === 0) {
             console.warn(`Skipping row ${i + 1}: No data parsed. Line: "${line}"`);
             continue;
         }

         const values = result.data[0];

         // --- Column Position Mapping (0-based index) ---
         // Column 0: Barcode (Required)
         // Column 1: Description
         // Column 2: Provider
         // Column 3: Stock (for 'main' warehouse)

         const barcode = values[0]?.trim();
         if (!barcode) {
             console.warn(`Skipping row ${i + 1}: Missing or empty barcode (Column 1). Line: "${line}"`);
             continue;
         }
          if (barcode.length > 100) { // Example validation
             console.warn(`Skipping row ${i + 1}: Barcode too long (${barcode.length} chars). Line: "${line}"`);
             continue;
          }

         const description = values[1]?.trim() || `Producto ${barcode}`;
         const provider = values[2]?.trim() || "Desconocido";
         const stockStr = values[3]?.trim() || '0';
         let stockMain = parseInt(stockStr, 10);
         if (isNaN(stockMain) || stockMain < 0) {
            console.warn(`Invalid stock value "${stockStr}" for barcode ${barcode} in row ${i + 1}. Defaulting to 0.`);
            stockMain = 0;
         }


         // Add Product Detail
         productDetails.push({
             barcode: barcode,
             description: description,
             provider: provider,
         });

         // Add Inventory Item for 'main' warehouse
         inventoryItems.push({
             barcode: barcode,
             warehouseId: defaultWarehouseId,
             stock: stockMain,
             count: 0, // Initialize count to 0 during import
             lastUpdated: new Date().toISOString(),
         });
     }
     console.log(`Parsed ${productDetails.length} product details and ${inventoryItems.length} inventory items from CSV.`);
     return { details: productDetails, inventory: inventoryItems };
 }

// --- React Component ---

export const ProductDatabase: React.FC<ProductDatabaseProps> = () => {
  const { toast } = useToast();
  const [productDetails, setProductDetails] = useState<ProductDetail[]>([]); // Local state for details
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]); // Local state for inventory items
  const [isLoading, setIsLoading] = useState(true); // Loading state for initial DB load
  const [isEditModalOpen, setIsEditModalOpen] = useState(false); // State for Add/Edit Detail Dialog
  const [selectedDetail, setSelectedDetail] = useState<ProductDetail | null>(null); // Detail being edited
  const [isAlertOpen, setIsAlertOpen] = useState(false); // State for Confirmation Dialogs
  const [alertAction, setAlertAction] = useState<'deleteProduct' | 'clearDatabase' | null>(null); // Type of confirmation
  const [productToDeleteBarcode, setProductToDeleteBarcode] = useState<string | null>(null); // Barcode for delete confirmation
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false); // Combined loading/processing state
  const [processingStatus, setProcessingStatus] = useState<string>(""); // Detailed status message
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const isMobile = useIsMobile();

  const productDetailForm = useForm<ProductDetailValues>({
    resolver: zodResolver(productDetailSchema),
    defaultValues: { barcode: "", description: "", provider: "Desconocido", stock: 0 }, // Add stock default
  });
  const { handleSubmit: handleDetailSubmit, reset: resetDetailForm, control: detailControl, setValue: setDetailValue } = productDetailForm;

  // Load initial data from IndexedDB on mount
  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    console.log("ProductDatabase: Loading initial data...");
    try {
        const [details, inventory] = await Promise.all([
            getAllProductDetails(),
            getAllInventoryItems() // Load all inventory items initially
        ]);
        setProductDetails(details);
        setInventoryItems(inventory);
        console.log(`ProductDatabase: Loaded ${details.length} details and ${inventory.length} inventory items.`);
    } catch (error) {
        console.error("ProductDatabase: Failed to load initial data:", error);
        toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo cargar la información de productos." });
    } finally {
        setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // --- CRUD Handlers (Interacting with IndexedDB and Local State) ---

 const handleAddOrUpdateDetail = useCallback(async (data: ProductDetailValues) => {
    const isUpdating = !!selectedDetail;
    const detailData: ProductDetail = {
        barcode: isUpdating ? selectedDetail.barcode : data.barcode.trim(), // Keep original barcode on update
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
    };

    if (!detailData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }

    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando detalle..." : "Agregando producto...");
    try {
        // Add or update the product detail
        await addOrUpdateProductDetail(detailData);

        // If adding a NEW product, also add the initial inventory item for 'main' warehouse
        if (!isUpdating) {
            const initialInventoryItem: InventoryItem = {
                barcode: detailData.barcode,
                warehouseId: 'main', // Default to 'main' warehouse
                stock: data.stock ?? 0, // Use stock from form
                count: 0, // Initial count is 0
                lastUpdated: new Date().toISOString(),
            };
            await addOrUpdateInventoryItem(initialInventoryItem);
            // Update local inventory state as well
             setInventoryItems(prevItems => [...prevItems, initialInventoryItem]);
        }

        // Update local product details state
        setProductDetails(prevDetails => {
            const existingIndex = prevDetails.findIndex(d => d.barcode === detailData.barcode);
            if (existingIndex > -1) {
                const newDetails = [...prevDetails];
                newDetails[existingIndex] = detailData;
                return newDetails;
            } else {
                return [detailData, ...prevDetails]; // Add new to top
            }
        });


        toast({
            title: isUpdating ? "Detalle Actualizado" : "Producto Agregado",
            description: `${detailData.description} (${detailData.barcode}) ha sido ${isUpdating ? 'actualizado' : 'agregado con stock inicial'}.`,
        });
        resetDetailForm({ barcode: "", description: "", provider: "Desconocido", stock: 0 }); // Reset form including stock
        setIsEditModalOpen(false);
        setSelectedDetail(null);
    } catch (error: any) {
        console.error("Detail/Inventory operation failed", error);
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.message?.includes('ConstraintError')) {
            errorMessage = `El producto con código de barras ${detailData.barcode} ya existe.`;
        } else if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        toast({ variant: "destructive", title: "Error de Base de Datos", description: errorMessage });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
    }
}, [selectedDetail, toast, resetDetailForm]); // Removed handleUpdateInventory dependency as it's integrated


  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
      if (!barcode) {
          toast({ variant: "destructive", title: "Error Interno", description: "No se puede eliminar el producto sin código de barras." });
          return;
      }
      setIsProcessing(true);
      setProcessingStatus("Eliminando producto...");
      try {
        await deleteProductCompletely(barcode); // Use the new helper
        // Update local states
        setProductDetails(prev => prev.filter(d => d.barcode !== barcode));
        setInventoryItems(prev => prev.filter(i => i.barcode !== barcode));
        toast({
          title: "Producto Eliminado",
          description: `El producto ${barcode} y todo su inventario asociado han sido eliminados.`,
        });
      } catch (error: any) {
        console.error("Failed to delete product completely", error);
        toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
      } finally {
          setIsProcessing(false);
          setProcessingStatus("");
          setIsAlertOpen(false);
          setProductToDeleteBarcode(null);
          setAlertAction(null);
          // Close edit dialog if it was for the deleted product
          if (selectedDetail?.barcode === barcode) {
             setIsEditModalOpen(false);
             setSelectedDetail(null);
             resetDetailForm();
          }
      }
  }, [toast, resetDetailForm, selectedDetail]);


  const handleClearDatabase = useCallback(async () => {
    setIsProcessing(true);
    setProcessingStatus("Borrando base de datos...");
    try {
      await clearDatabaseCompletely(); // Use the new helper
      setProductDetails([]); // Clear local states
      setInventoryItems([]);
      toast({ title: "Base de Datos Borrada", description: "Todos los productos y el inventario han sido eliminados." });
    } catch (error: any) {
      console.error("Failed to clear database", error);
      toast({ variant: "destructive", title: "Error al Borrar DB", description: `No se pudo borrar la base de datos: ${error.message}` });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
        setIsAlertOpen(false);
        setAlertAction(null);
    }
  }, [toast]);


  // --- Dialog and Alert Triggers ---

  const handleOpenEditDialog = useCallback((detail: ProductDetail | null) => {
    setSelectedDetail(detail);
    if (detail) {
        resetDetailForm({
            barcode: detail.barcode || "",
            description: detail.description || "",
            provider: detail.provider || "Desconocido",
            stock: 0, // Stock is not editable here, only on creation
        });
    } else {
        resetDetailForm({ barcode: "", description: "", provider: "Desconocido", stock: 0 }); // Reset with stock
    }
    setIsEditModalOpen(true);
  }, [resetDetailForm]);

  const triggerDeleteProductAlert = useCallback((barcode: string | null) => {
      if (!barcode) {
         toast({ variant: "destructive", title: "Error Interno", description: "Datos del producto no disponibles para eliminar." });
         return;
      }
      setProductToDeleteBarcode(barcode);
      setAlertAction('deleteProduct');
      setIsAlertOpen(true);
  }, [toast]);

  const triggerClearDatabaseAlert = useCallback(() => {
      if (productDetails.length === 0 && inventoryItems.length === 0) {
           toast({ title: "Base de Datos Vacía", description: "La base de datos ya está vacía." });
           return;
      }
      setAlertAction('clearDatabase');
      setIsAlertOpen(true);
  }, [productDetails, inventoryItems, toast]);

   const handleDeleteConfirmation = useCallback(() => {
        console.log(`Confirming action: ${alertAction}`);
        if (alertAction === 'deleteProduct' && productToDeleteBarcode) {
            handleDeleteProduct(productToDeleteBarcode);
        } else if (alertAction === 'clearDatabase') {
            handleClearDatabase();
        } else {
            console.warn("Delete confirmation called with invalid state:", { alertAction, productToDeleteBarcode });
            setIsAlertOpen(false);
            setProductToDeleteBarcode(null);
            setAlertAction(null);
        }
    }, [alertAction, productToDeleteBarcode, handleDeleteProduct, handleClearDatabase]);



   // --- Google Sheet Loading ---
   const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrl) {
            toast({ variant: "destructive", title: "URL Requerida", description: "Introduce la URL de la hoja de Google." });
            return;
        }

        console.log("Starting Google Sheet load process...");
        setIsProcessing(true);
        setUploadProgress(0);
        setProcessingStatus("Obteniendo datos de Google Sheet...");

        try {
            const { details, inventory } = await fetchAndParseGoogleSheetData(googleSheetUrl);
            const totalItemsToLoad = details.length + inventory.length;
             let itemsLoaded = 0;

             if (totalItemsToLoad === 0) {
                 toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja.", variant: "default" });
             } else {
                 // --- Incremental Database Update ---
                 setProcessingStatus(`Actualizando detalles (${details.length})...`);
                 await addProductDetailsInBulk(details);
                 itemsLoaded += details.length;
                 setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));


                 setProcessingStatus(`Actualizando inventario (${inventory.length})...`);
                 await addInventoryItemsInBulk(inventory);
                  itemsLoaded += inventory.length;
                 setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));

                 console.log("Bulk add/update to IndexedDB completed.");

                 // After DB update, refresh the local state
                 await loadInitialData(); // Reload data to reflect changes

                 toast({ title: "Carga Completa", description: `Se procesaron ${details.length} detalles y ${inventory.length} registros de inventario desde la Hoja de Google.` });
             }

        } catch (error: any) {
            console.error("Error during Google Sheet load process:", error);
            setProcessingStatus("Error durante la carga.");
            toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet.", duration: 9000 });
        } finally {
            setIsProcessing(false);
            setProcessingStatus("");
            setUploadProgress(0);
            console.log("Google Sheet load process finished.");
        }
    }, [googleSheetUrl, toast, loadInitialData]); // Added loadInitialData dependency


  // --- Export and Filtering ---

  const handleExportDatabase = useCallback(() => {
     if (productDetails.length === 0) {
       toast({ title: "Base de Datos Vacía", description: "No hay detalles de producto para exportar." });
       return;
     }
     // Exporting just the details for now. Exporting combined data needs more logic.
     try {
         const csvData = convertDetailsToCSV(productDetails); // Use a dedicated CSV converter
         const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" });
         const link = document.createElement("a");
         link.href = URL.createObjectURL(blob);
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         link.setAttribute("download", `product_database_details_${timestamp}.csv`);
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         toast({ title: "Exportación Iniciada", description: "Se ha iniciado la descarga del archivo CSV de detalles." });
     } catch (error) {
          console.error("Error exporting database details:", error);
          toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
     }
   }, [productDetails, toast]); // Added toast dependency

    // Converts product details data to CSV format string
    const convertDetailsToCSV = useCallback((data: ProductDetail[]) => {
        if (!data || data.length === 0) return "";
        const headers = ["barcode", "description", "provider"];
        const safeQuote = (field: any): string => {
            const str = String(field ?? '');
            const escapedStr = str.replace(/"/g, '""');
            return `"${escapedStr}"`;
        };
        const rows = data.map((detail) => [
            safeQuote(detail.barcode),
            safeQuote(detail.description),
            safeQuote(detail.provider),
        ]);
        return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    }, []);


   // Filter products based on search term and provider selection
   // Now filters based on productDetails state
   const filteredDetails = React.useMemo(() => {
        return productDetails.filter(detail => {
            const searchTermLower = searchTerm.toLowerCase();
            const matchesSearch = searchTerm === "" ||
                                (detail.barcode || '').toLowerCase().includes(searchTermLower) ||
                                (detail.description || '').toLowerCase().includes(searchTermLower) ||
                                (detail.provider || '').toLowerCase().includes(searchTermLower);
            const matchesProvider = selectedProviderFilter === 'all' || (detail.provider || "Desconocido") === selectedProviderFilter;
            return matchesSearch && matchesProvider;
        });
    }, [productDetails, searchTerm, selectedProviderFilter]);

    // Generate unique provider options from productDetails
    const providerOptions = React.useMemo(() => {
        const providers = new Set(productDetails.map(p => p.provider || "Desconocido").filter(Boolean));
        return ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1;
            if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
    }, [productDetails]);


  // --- Render ---

  return (
    <div className="p-4 md:p-6 space-y-6">
       {/* --- Toolbar --- */}
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
             <Button onClick={() => handleOpenEditDialog(null)} disabled={isProcessing || isLoading}>
                 Agregar Producto
             </Button>
             <Button onClick={handleExportDatabase} variant="outline" disabled={productDetails.length === 0 || isProcessing || isLoading}>
                 Exportar Detalles <FileDown className="ml-2 h-4 w-4" />
             </Button>
             <Button variant="destructive" onClick={triggerClearDatabaseAlert} disabled={(productDetails.length === 0 && inventoryItems.length === 0) || isProcessing || isLoading}>
                <Trash className="mr-2 h-4 w-4" /> Borrar Todo
             </Button>
         </div>
          {/* Search and Filter Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <Label htmlFor="search-product" className="sr-only">Buscar Producto</Label>
             <Input
                 id="search-product"
                 type="text"
                 placeholder="Buscar por código, descripción..."
                 value={searchTerm}
                 onChange={(e) => setSearchTerm(e.target.value)}
                 className="h-10 flex-grow min-w-[150px]"
                 disabled={isProcessing || isLoading}
             />
             <Select
                 value={selectedProviderFilter}
                 onValueChange={setSelectedProviderFilter}
                 disabled={providerOptions.length <= 1 || isProcessing || isLoading}
             >
                 <SelectTrigger className="w-full sm:w-auto md:w-[200px] h-10">
                     <Filter className="mr-2 h-4 w-4" />
                     <SelectValue placeholder="Filtrar proveedor" />
                 </SelectTrigger>
                 <SelectContent>
                     {providerOptions.map(provider => (
                         <SelectItem key={provider} value={provider}>
                             {provider === 'all' ? 'Todos los Proveedores' : provider}
                         </SelectItem>
                     ))}
                 </SelectContent>
             </Select>
         </div>
       </div>

      {/* --- Google Sheet Loader --- */}
       <div className="space-y-2 p-4 border rounded-lg bg-card dark:bg-gray-800 shadow-sm">
           <Label htmlFor="google-sheet-url" className="block font-medium mb-1 dark:text-gray-200">
              Cargar/Actualizar desde Google Sheet:
           </Label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
             <Input
             id="google-sheet-url"
             type="url"
             placeholder="URL de Hoja de Google (pública y compartida)"
             value={googleSheetUrl}
             onChange={(e) => setGoogleSheetUrl(e.target.value)}
             className="flex-grow h-10 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
             disabled={isProcessing || isLoading}
             aria-describedby="google-sheet-info"
             />
             <Button variant="secondary" disabled={isProcessing || isLoading || !googleSheetUrl} onClick={handleLoadFromGoogleSheet}>
                 <Upload className="mr-2 h-4 w-4" />
                 {isProcessing && processingStatus.includes("Google") ? 'Cargando...' : 'Cargar Datos'}
             </Button>
         </div>
         <p id="google-sheet-info" className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
               Asegúrese de que la hoja sea pública ('Cualquier persona con el enlace'). Se leerán columnas por posición: 1:Cód. Barras, 2:Descripción, 3:Proveedor, 4:Stock (para almacén 'main').
         </p>
         {isProcessing && (
             <div className="mt-4 space-y-1">
                 <Progress value={uploadProgress} className="h-2 w-full" />
                 <p className="text-sm text-muted-foreground dark:text-gray-400 text-center">
                     {processingStatus || `Cargando... (${uploadProgress}%)`}
                 </p>
             </div>
         )}
         {isLoading && !isProcessing && (
              <p className="text-sm text-muted-foreground dark:text-gray-400 text-center mt-2">Cargando datos iniciales...</p>
         )}
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
               {alertAction === 'deleteProduct' && productToDeleteBarcode ?
                 `Estás a punto de eliminar permanentemente el producto con código "${productToDeleteBarcode}" y todo su inventario asociado. Esta acción no se puede deshacer.`
                  : alertAction === 'clearDatabase' ?
                  "Estás a punto de eliminar TODOS los productos y el inventario de la base de datos local permanentemente. Esta acción no se puede deshacer."
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


      {/* --- Products Table (Displays Product Details) --- */}
       <ScrollArea className="border rounded-lg shadow-sm h-[calc(100vh-480px)] md:h-[calc(100vh-420px)] bg-white dark:bg-gray-800">
         <Table>
            <TableCaption className="dark:text-gray-400">
               {isLoading ? "Cargando..." :
               filteredDetails.length === 0
                 ? (productDetails.length > 0 ? 'No hay productos que coincidan con la búsqueda/filtro.' : 'La base de datos está vacía.')
                 : `Mostrando ${filteredDetails.length} de ${productDetails.length} productos.`
               }
           </TableCaption>
            <TableHeader className="sticky top-0 bg-background dark:bg-gray-700 z-10 shadow-sm">
             <TableRow>
               <TableHead className="w-[25%] px-3 py-3 dark:text-gray-300">Código Barras</TableHead>
               <TableHead className="w-[40%] px-3 py-3 dark:text-gray-300">Descripción (Click para editar)</TableHead>
               <TableHead className="w-[20%] px-3 py-3 hidden md:table-cell dark:text-gray-300">Proveedor</TableHead>
                <TableHead className="w-[15%] px-3 py-3 text-right dark:text-gray-300">Stock Total</TableHead>
             </TableRow>
           </TableHeader>
           <TableBody>
             {isLoading ? (
                 <TableRow>
                     <TableCell colSpan={4} className="text-center py-10 text-muted-foreground dark:text-gray-400">
                         Cargando datos...
                     </TableCell>
                 </TableRow>
             ) : filteredDetails.length === 0 ? (
                   <TableRow>
                       <TableCell colSpan={4} className="text-center py-10 text-muted-foreground dark:text-gray-400">
                           {productDetails.length > 0 ? "No hay productos que coincidan." : "La base de datos está vacía."}
                       </TableCell>
                   </TableRow>
               ) : (
                   filteredDetails.map((detail) => {
                      // Calculate total stock across all warehouses for display
                       const totalStock = inventoryItems
                           .filter(item => item.barcode === detail.barcode)
                           .reduce((sum, item) => sum + (item.stock || 0), 0);

                       return (
                           <TableRow key={detail.barcode} className="hover:bg-muted/50 dark:hover:bg-gray-700 text-sm transition-colors duration-150">
                               <TableCell className="px-3 py-2 font-medium dark:text-gray-100" aria-label={`Código ${detail.barcode}`}>
                                   {detail.barcode}
                               </TableCell>
                               <TableCell
                                   className="px-3 py-2 cursor-pointer hover:text-primary dark:hover:text-teal-400 hover:underline dark:text-gray-100"
                                   onClick={() => handleOpenEditDialog(detail)}
                                   aria-label={`Editar producto ${detail.description}`}
                                   title={`Editar ${detail.description}`}
                               >
                                   {detail.description}
                               </TableCell>
                               <TableCell className="px-3 py-2 hidden md:table-cell text-muted-foreground dark:text-gray-300" aria-label={`Proveedor ${detail.provider}`}>
                                   {detail.provider || 'N/A'}
                               </TableCell>
                                <TableCell className="px-3 py-2 text-right font-medium tabular-nums text-muted-foreground dark:text-gray-300" aria-label={`Stock total ${totalStock}`}>
                                  {totalStock}
                                </TableCell>
                           </TableRow>
                       );
                   })
               )}
           </TableBody>
         </Table>
       </ScrollArea>

      {/* --- Add/Edit Product Detail Dialog --- */}
      <Dialog open={isEditModalOpen} onOpenChange={(isOpen) => { if (!isOpen) { setIsEditModalOpen(false); setSelectedDetail(null); resetDetailForm(); } else { setIsEditModalOpen(true); } }}>
        <DialogContent className="sm:max-w-lg dark:bg-gray-800 dark:text-white">
          <DialogHeader>
            <DialogTitle className="dark:text-gray-100">{selectedDetail ? "Editar Detalle Producto" : "Agregar Nuevo Producto"}</DialogTitle>
            <DialogDescription className="dark:text-gray-400">
              {selectedDetail ? "Modifica los detalles del producto. El stock se gestiona por almacén." : "Añade un nuevo producto (detalle general) y su stock inicial para el almacén principal."}
            </DialogDescription>
          </DialogHeader>
          <Form {...productDetailForm}>
            <form onSubmit={handleDetailSubmit(handleAddOrUpdateDetail)} className="space-y-4 p-2">
              <FormField
                control={detailControl}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Código de Barras *</FormLabel>
                    <FormControl>
                       <Input type="text" {...field} readOnly={!!selectedDetail} aria-required="true" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={detailControl}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Descripción *</FormLabel>
                    <FormControl>
                       <Input type="text" {...field} aria-required="true" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={detailControl}
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Proveedor</FormLabel>
                    <FormControl>
                      <Input type="text" {...field} placeholder="Opcional" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Stock field only visible when adding a new product */}
              {!selectedDetail && (
                <FormField
                    control={detailControl}
                    name="stock"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel className="dark:text-gray-200">Stock Inicial (Almacén Principal) *</FormLabel>
                        <FormControl>
                        <Input type="number" {...field} aria-required="true" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                        </FormControl>
                         <FormDescUi className="text-xs dark:text-gray-400">Este stock se asignará al almacén 'Principal'.</FormDescUi>
                        <FormMessage />
                    </FormItem>
                    )}
                />
               )}

               <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between w-full pt-6 gap-2">
                    {selectedDetail && (
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => triggerDeleteProductAlert(selectedDetail.barcode)}
                            className="sm:mr-auto"
                            disabled={isProcessing}
                        >
                            <Trash className="mr-2 h-4 w-4" /> Eliminar Producto (y todo su inventario)
                        </Button>
                    )}
                    {!selectedDetail && <div className="sm:mr-auto"></div> /* Spacer */}
                    <div className="flex gap-2 justify-end">
                         <DialogClose asChild>
                             <Button type="button" variant="outline" disabled={isProcessing} className="dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700">Cancelar</Button>
                         </DialogClose>
                          <Button type="submit" disabled={isProcessing} className="dark:bg-teal-600 dark:hover:bg-teal-700">
                             {isProcessing ? "Guardando..." : (selectedDetail ? <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</> : "Agregar Producto")}
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
    