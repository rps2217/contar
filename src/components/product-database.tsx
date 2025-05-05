// src/components/product-database.tsx
"use client";

import type { ProductDetail, InventoryItem, DisplayProduct } from '@/types/product';
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem } from "@/lib/utils";
import {
    addOrUpdateProductDetail,
    getAllProductDetails,
    deleteProductCompletely,
    clearDatabaseCompletely,
    addOrUpdateInventoryItem,
    getInventoryItem,
    getAllInventoryItems,
    addInventoryItemsInBulk,
    addProductDetailsInBulk,
    getInventoryItemsForWarehouse,
} from '@/lib/indexeddb-helpers';
import {
    Edit, Filter, Play, Loader2, Save, Trash, Upload, AlertCircle, Warehouse as WarehouseIcon
} from "lucide-react";
import Papa from 'papaparse'; // Using PapaParse for robust CSV parsing
import * as React from "react"; // Import React
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { ConfirmationDialog } from "@/components/confirmation-dialog"; // Import ConfirmationDialog
import { EditProductDialog } from "@/components/edit-product-dialog"; // Import EditProductDialog
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
    SelectGroup, SelectLabel, } from "@/components/ui/select";
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useLocalStorage } from '@/hooks/use-local-storage'; // Import useLocalStorage


// --- Zod Schema ---
// Schema remains the same as it defines the data structure *within* the app
const productDetailSchema = z.object({
  barcode: z.string().min(1, { message: "El código de barras es requerido." }),
  description: z.string().min(1, { message: "La descripción es requerida." }),
  provider: z.string().optional(),
  stock: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? 0 : Number(val)),
    z.number().min(0, { message: "El stock debe ser mayor o igual a 0." }).default(0)
  ),
});
type ProductDetailValues = z.infer<typeof productDetailSchema>;

const GOOGLE_SHEET_URL_LOCALSTORAGE_KEY = 'stockCounterPro_googleSheetUrl'; // Key for storing the full URL or ID
const GOOGLE_SHEET_ID_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

// --- Helper Function to Extract Spreadsheet ID ---
const extractSpreadsheetId = (input: string): string | null => {
  if (!input) return null;
  const match = input.match(GOOGLE_SHEET_ID_PATTERN);
  if (match && match[1]) {
    return match[1]; // Return the ID if found in a URL
  }
  // Assume the input is the ID itself if it doesn't look like a URL
  if (!input.startsWith('http') && input.length > 20) { // Basic check for ID-like string
      return input;
  }
  return null; // Return null if no ID could be extracted
};


// --- Google Sheet Parsing Logic (Position-Based) ---
const parseGoogleSheetUrl = (sheetUrlOrId: string): { spreadsheetId: string | null; gid: string } => {
    const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
    const gidMatch = sheetUrlOrId.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0'; // Default to first sheet (gid=0)

    if (!spreadsheetId) {
         console.warn("Could not extract spreadsheet ID from input:", sheetUrlOrId);
         throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL/ID proporcionado.");
    }
    return { spreadsheetId, gid };
};

async function fetchAndParseGoogleSheetData(sheetUrlOrId: string): Promise<{ details: ProductDetail[], inventory: InventoryItem[] }> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrlOrId);
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log("Fetching Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" });
    } catch (error: any) {
        console.error("Network error fetching Google Sheet:", error);
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL/ID.";
        if (error.message?.includes('Failed to fetch')) {
            userMessage += " Posible problema de CORS o conectividad, o la URL/ID es incorrecta.";
        } else {
            userMessage += ` Detalle: ${error.message}`;
        }
        throw new Error(userMessage);
    }

    if (!response.ok) {
        const status = response.status;
        const statusText = response.statusText;
        const errorBody = await response.text().catch(() => "Could not read error response body.");
        console.error(`Failed to fetch Google Sheet data: ${status} ${statusText}`, { url: csvExportUrl, body: errorBody.substring(0, 500) });

        let userMessage = `Error ${status} al obtener datos. `;
        if (status === 400) userMessage += "Verifique la URL/ID y asegúrese de que el ID de la hoja (gid=...) sea correcto.";
        else if (status === 403 || errorBody.toLowerCase().includes("google accounts sign in")) userMessage = "Error de Acceso: La hoja no es pública. Cambie la configuración de compartir a 'Cualquier persona con el enlace puede ver'.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL/ID y el ID de la hoja.";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL/ID.`;

        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log(`Successfully fetched CSV data (length: ${csvText.length}). Parsing...`);

    const result = Papa.parse<string[]>(csvText, {
      header: false, // Parse by position, not header names
      skipEmptyLines: true,
    });

    if (result.errors.length > 0) {
      console.warn("Parsing errors encountered:", result.errors);
    }

    const productDetails: ProductDetail[] = [];
    const inventoryItems: InventoryItem[] = [];
    const defaultWarehouseId = 'main'; // Stock from sheet goes to the 'main' warehouse

    if (result.data.length === 0) {
        console.warn("CSV data is empty or contains only empty lines.");
        return { details: [], inventory: [] };
    }

    console.log(`Processing ${result.data.length} data rows (including potential header).`);

    // Assume the first row is headers and skip it
    const startDataRow = 1;

    for (let i = startDataRow; i < result.data.length; i++) {
        const values = result.data[i];

        // Expecting at least 10 columns now to access provider safely
        if (!values || values.length < 10) {
            console.warn(`Skipping row ${i + 1}: Insufficient columns. Expected at least 10. Row:`, values);
            continue;
        }

        // --- NEW Column Position Mapping (0-based index) ---
        // Column 1: Barcode
        const barcode = values[0]?.trim();
        if (!barcode) {
            console.warn(`Skipping row ${i + 1}: Missing or empty barcode (Column 1). Row:`, values);
            continue;
        }
         if (barcode.length > 100) {
             console.warn(`Skipping row ${i + 1}: Barcode too long (${barcode.length} chars). Row:`, values);
             continue;
         }

        // Column 2: Description
        const description = values[1]?.trim() || `Producto ${barcode}`;
        // Column 6: Stock (for 'main' warehouse)
        const stockStr = values[5]?.trim() || '0'; // Index 5 for Column 6
        let stockMain = parseInt(stockStr, 10);
        if (isNaN(stockMain) || stockMain < 0) {
           console.warn(`Invalid stock value "${stockStr}" for barcode ${barcode} in row ${i + 1} (Column 6). Defaulting to 0.`);
           stockMain = 0;
        }
        // Column 10: Provider
        const provider = values[9]?.trim() || "Desconocido"; // Index 9 for Column 10


        productDetails.push({
            barcode: barcode,
            description: description,
            provider: provider,
        });

        inventoryItems.push({
            barcode: barcode,
            warehouseId: defaultWarehouseId, // Stock from sheet assigned to 'main'
            stock: stockMain,
            count: 0, // Default count to 0 on import
            lastUpdated: new Date().toISOString(),
        });
    }

    console.log(`Parsed ${productDetails.length} product details and ${inventoryItems.length} inventory items from CSV based on column position.`);
    return { details: productDetails, inventory: inventoryItems };
}

 // --- Props Interface for ProductDatabase ---
 interface ProductDatabaseProps {
    currentWarehouseId: string;
    onStartCountByProvider: (products: DisplayProduct[]) => void;
 }


// --- React Component ---

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({ currentWarehouseId, onStartCountByProvider }) => {
  const { toast } = useToast();
  const [productDetails, setProductDetails] = useState<ProductDetail[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<ProductDetail | null>(null);
  const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertAction, setAlertAction] = useState<'deleteProduct' | 'clearDatabase' | null>(null);
  const [productToDelete, setProductToDelete] = useState<ProductDetail | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [googleSheetUrlOrId, setGoogleSheetUrlOrId] = useLocalStorage<string>( // Renamed state variable
      GOOGLE_SHEET_URL_LOCALSTORAGE_KEY,
      ""
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");

  // Load initial data from IndexedDB on mount
  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    console.log("ProductDatabase: Loading initial data...");
    try {
        const [details, inventory] = await Promise.all([
            getAllProductDetails(),
            getAllInventoryItems()
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


  const handleGoogleSheetUrlOrIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrlOrId = e.target.value;
    setGoogleSheetUrlOrId(newUrlOrId); // Updates state and localStorage via the hook
  };


  // --- CRUD Handlers ---

 const handleAddOrUpdateDetailSubmit = useCallback(async (data: ProductDetailValues) => {
    const isUpdating = !!selectedDetail;
    const detailData: ProductDetail = {
        barcode: isUpdating ? selectedDetail!.barcode : data.barcode.trim(),
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
    };

    if (!detailData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }

    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        // Update product details (description, provider)
        await addOrUpdateProductDetail(detailData);

        // Update inventory item specifically for the 'main' warehouse
        const mainInventoryItem = await getInventoryItem(detailData.barcode, 'main');
        const updatedMainInventory: InventoryItem = {
            barcode: detailData.barcode,
            warehouseId: 'main',
            stock: data.stock ?? 0, // Use the stock from the form data
            count: mainInventoryItem?.count ?? 0, // Preserve existing count for 'main' warehouse
            lastUpdated: new Date().toISOString(),
        };
        await addOrUpdateInventoryItem(updatedMainInventory);

        // Refresh local state to reflect changes immediately
        await loadInitialData();

        toast({
            title: isUpdating ? "Producto Actualizado" : "Producto Agregado",
            description: `${detailData.description} (${detailData.barcode}) ha sido ${isUpdating ? 'actualizado (incluyendo stock en almacén principal)' : 'agregado con stock inicial'}.`,
        });
        setIsEditModalOpen(false);
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
        setSelectedDetail(null);
    }
 }, [selectedDetail, toast, loadInitialData]);


 const handleDeleteProduct = useCallback(async (barcode: string | null) => {
    if (!barcode) {
        toast({ variant: "destructive", title: "Error Interno", description: "No se puede eliminar el producto sin código de barras." });
        return;
    }
    const detailToDelete = productDetails.find(d => d.barcode === barcode);

    setIsProcessing(true);
    setProcessingStatus("Eliminando producto...");
    try {
      await deleteProductCompletely(barcode);
      await loadInitialData(); // Refresh data after deletion
      toast({
        title: "Producto Eliminado",
        description: `El producto ${detailToDelete?.description || barcode} y todo su inventario asociado han sido eliminados.`,
      });
      setIsEditModalOpen(false); // Close edit dialog if open
      setIsAlertOpen(false); // Close confirmation dialog
      setProductToDelete(null);
      setAlertAction(null);
    } catch (error: any) {
      console.error("Failed to delete product completely", error);
      toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
    } finally {
          setIsProcessing(false);
          setProcessingStatus("");
    }
  }, [toast, loadInitialData, productDetails]); // Added loadInitialData


  const handleClearDatabase = useCallback(async () => {
    setIsProcessing(true);
    setProcessingStatus("Borrando base de datos...");
    try {
      await clearDatabaseCompletely();
      setProductDetails([]); // Clear local state
      setInventoryItems([]); // Clear local state
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

  const handleOpenEditDialog = useCallback(async (detail: ProductDetail | null) => {
    if (detail) {
         const mainInventory = await getInventoryItem(detail.barcode, 'main');
         setInitialStockForEdit(mainInventory?.stock ?? 0);
         setSelectedDetail(detail);
    } else {
        // Adding a new product, stock starts at 0
        setInitialStockForEdit(0);
        setSelectedDetail(null); // Ensure selectedDetail is null for adding
    }
    setIsEditModalOpen(true);
  }, []);

  const triggerDeleteProductAlert = useCallback((detail: ProductDetail | null) => {
      if (!detail) {
         toast({ variant: "destructive", title: "Error Interno", description: "Datos del producto no disponibles para eliminar." });
         return;
      }
      setProductToDelete(detail);
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
        if (alertAction === 'deleteProduct' && productToDelete) {
            handleDeleteProduct(productToDelete.barcode);
        } else if (alertAction === 'clearDatabase') {
            handleClearDatabase();
        } else {
            console.warn("Delete confirmation called with invalid state:", { alertAction, productToDelete });
        }
        setIsAlertOpen(false); // Close dialog after action
        setProductToDelete(null); // Reset state
        setAlertAction(null);
    }, [alertAction, productToDelete, handleDeleteProduct, handleClearDatabase]);



   // --- Google Sheet Loading ---
   const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrlOrId) { // Check if input is empty
            toast({ variant: "destructive", title: "URL/ID Requerido", description: "Introduce la URL de la hoja de Google o el ID." });
            return;
        }

        setIsProcessing(true);
        setUploadProgress(0);
        setProcessingStatus("Obteniendo datos de Google Sheet...");

        try {
            const { details, inventory } = await fetchAndParseGoogleSheetData(googleSheetUrlOrId); // Pass the input value
            const totalItemsToLoad = details.length + inventory.length;
             let itemsLoaded = 0;
             const batchSize = 100;

             if (totalItemsToLoad === 0) {
                 toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja.", variant: "default" });
             } else {
                 setProcessingStatus(`Actualizando detalles (${details.length})...`);
                 for (let i = 0; i < details.length; i += batchSize) {
                     const batch = details.slice(i, i + batchSize);
                     await addProductDetailsInBulk(batch);
                     itemsLoaded += batch.length;
                     setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));
                     await new Promise(resolve => setTimeout(resolve, 5)); // Small delay to allow UI update
                 }

                 setProcessingStatus(`Actualizando inventario (${inventory.length})...`);
                 for (let i = 0; i < inventory.length; i += batchSize) {
                     const batch = inventory.slice(i, i + batchSize);
                     await addInventoryItemsInBulk(batch);
                     itemsLoaded += batch.length;
                     setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));
                     await new Promise(resolve => setTimeout(resolve, 5)); // Small delay
                 }

                 console.log("Bulk add/update to IndexedDB completed.");
                 await loadInitialData(); // Refresh the data displayed in the table
                 toast({ title: "Carga Completa", description: `Se procesaron ${details.length} detalles y ${inventory.length} registros de inventario.` });
             }

        } catch (error: any) {
            console.error("Error during Google Sheet load process:", error);
            setProcessingStatus("Error durante la carga.");
            toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet.", duration: 9000 });
        } finally {
            setIsProcessing(false);
            setProcessingStatus("");
            setUploadProgress(0);
        }
    }, [googleSheetUrlOrId, toast, loadInitialData]); // Depend on the URL/ID state


  // --- Export and Filtering ---

  const handleExportDatabase = useCallback(() => {
     if (productDetails.length === 0) {
       toast({ title: "Base de Datos Vacía", description: "No hay detalles de producto para exportar." });
       return;
     }
     try {
         const csvData = convertDetailsToCSV(productDetails);
         const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" });
         const link = document.createElement("a");
         link.href = URL.createObjectURL(blob);
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         link.setAttribute("download", `product_database_details_${timestamp}.csv`);
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(link.href);
         toast({ title: "Exportación Iniciada", description: "Se ha iniciado la descarga del archivo CSV de detalles." });
     } catch (error) {
          console.error("Error exporting database details:", error);
          toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
     }
   }, [productDetails, toast]);

    // Converts product details data to CSV format string
    const convertDetailsToCSV = useCallback((data: ProductDetail[]) => {
        if (!data || data.length === 0) return "";
        const headers = ["barcode", "description", "provider"];
        const safeQuote = (field: any): string => {
            const str = String(field ?? '');
            const escapedStr = str.replace(/"/g, '""');
            return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${escapedStr}"` : str;
        };
        const rows = data.map((detail) => [
            safeQuote(detail.barcode),
            safeQuote(detail.description),
            safeQuote(detail.provider),
        ]);
        return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    }, []);

    // Generate unique provider options from productDetails
    const providerOptions = React.useMemo(() => {
        const providers = new Set(productDetails.map(p => p.provider || "Desconocido").filter(Boolean));
        const sortedProviders = ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1;
            if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
        return sortedProviders;
    }, [productDetails]);

 // --- Count by Provider ---
  const handleStartCountByProviderClick = useCallback(async () => {
    if (selectedProviderFilter === 'all') {
      toast({
        variant: "destructive",
        title: "Seleccionar Proveedor",
        description: "Por favor, selecciona un proveedor específico para iniciar el conteo.",
      });
      return;
    }

    setIsProcessing(true);
    setProcessingStatus(`Buscando productos de ${selectedProviderFilter} en almacén ${currentWarehouseId}...`);

    try {
      const providerDetails = productDetails.filter(detail => (detail.provider || "Desconocido") === selectedProviderFilter);
      if (providerDetails.length === 0) {
        toast({ title: "Vacío", description: `No hay productos registrados para el proveedor ${selectedProviderFilter}.` });
        setIsProcessing(false);
        setProcessingStatus("");
        return;
      }

      const warehouseInventory = await getInventoryItemsForWarehouse(currentWarehouseId);
      const inventoryMap = new Map<string, InventoryItem>();
      warehouseInventory.forEach(item => inventoryMap.set(item.barcode, item));

      const productsToCount: DisplayProduct[] = providerDetails.map(detail => {
        const inventory = inventoryMap.get(detail.barcode);
        return {
          ...detail,
          warehouseId: currentWarehouseId,
          stock: inventory?.stock ?? 0,
          count: 0, // Reset count for the new session
          lastUpdated: inventory?.lastUpdated || new Date().toISOString(),
        };
      });

      onStartCountByProvider(productsToCount); // Pass the prepared list to the parent

    } catch (error) {
      console.error("Error starting count by provider:", error);
      toast({ variant: "destructive", title: "Error", description: "No se pudo iniciar el conteo por proveedor." });
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  }, [selectedProviderFilter, productDetails, currentWarehouseId, onStartCountByProvider, toast]);


  // --- Filter Products for Display ---
  const filteredProducts = React.useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return productDetails.filter(product => {
      const matchesSearch = !lowerSearchTerm ||
                            product.description.toLowerCase().includes(lowerSearchTerm) ||
                            product.barcode.includes(lowerSearchTerm) ||
                            (product.provider || '').toLowerCase().includes(lowerSearchTerm);

      const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;

      return matchesSearch && matchesProvider;
    });
  }, [productDetails, searchTerm, selectedProviderFilter]);

  // --- Render ---

  return (
    <div className="p-4 md:p-6 space-y-6">
       {/* --- Toolbar --- */}
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
            {/* Actions Dropdown */}
            <Select onValueChange={(value) => {
                switch (value) {
                  case "add":
                    handleOpenEditDialog(null); // Open dialog for adding new product
                    break;
                  case "export":
                    handleExportDatabase();
                    break;
                  case "clear":
                    triggerClearDatabaseAlert();
                    break;
                }
              }} disabled={isProcessing || isLoading}>
              <SelectTrigger className="w-full sm:w-auto md:w-[200px] h-10">
                <SelectValue placeholder="Acciones" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Acciones</SelectLabel>
                  <SelectItem value="add">
                    Agregar Producto
                  </SelectItem>
                  <SelectItem value="export" disabled={productDetails.length === 0}>
                    Exportar Detalles
                  </SelectItem>
                  <SelectItem value="clear" disabled={productDetails.length === 0 && inventoryItems.length === 0}>Borrar Todo</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
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
             {/* Provider Filter Dropdown */}
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
            {/* Start Count by Provider Button */}
            <Button
                onClick={handleStartCountByProviderClick}
                disabled={selectedProviderFilter === 'all' || isProcessing || isLoading}
                variant="outline"
                className="h-10 text-green-600 border-green-500 hover:bg-green-50 hover:text-green-700 dark:text-green-400 dark:border-green-600 dark:hover:bg-green-900/50 dark:hover:text-green-300"
                title={`Iniciar conteo para ${selectedProviderFilter === 'all' ? 'un proveedor' : selectedProviderFilter} en ${currentWarehouseId}`}
            >
                <Play className="mr-2 h-4 w-4" /> Contar Proveedor
            </Button>
         </div>
       </div>

      {/* --- Google Sheet Loader --- */}
       <div className="space-y-2 p-4 border rounded-lg bg-card dark:bg-gray-800 shadow-sm">
           <Label htmlFor="google-sheet-url" className="block font-medium mb-1 dark:text-gray-200">
              Cargar/Actualizar desde Google Sheet (URL o ID):
           </Label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
             <Input
             id="google-sheet-url"
             type="text" // Changed to text to allow URL or ID
             placeholder="URL de Hoja de Google o ID de Hoja" // Updated placeholder
             value={googleSheetUrlOrId}
             onChange={handleGoogleSheetUrlOrIdChange} // Use the new handler
             className="flex-grow h-10 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
             disabled={isProcessing || isLoading}
             aria-describedby="google-sheet-info"
             />
             <Button variant="secondary" disabled={isProcessing || isLoading || !googleSheetUrlOrId} onClick={handleLoadFromGoogleSheet}>
                {isProcessing && processingStatus.includes("Google") ?
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :
                  <Upload className="mr-2 h-4 w-4" />
                 }
                 {isProcessing && processingStatus.includes("Google") ? 'Cargando...' : 'Cargar Datos'}
             </Button>
         </div>
         <p id="google-sheet-info" className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
              Introduzca la URL completa de la Hoja de Google (compartida públicamente) o simplemente el ID de la hoja de cálculo. Se leerán las columnas 1, 2, 6 y 10 por posición (ignorando la primera fila): 1:Código Barras, 2:Descripción, 6:Stock (para almacén 'main'), 10:Proveedor. Columnas adicionales serán ignoradas.
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

       {/* Confirmation Dialog for Delete/Clear */}
        <ConfirmationDialog
            isOpen={isAlertOpen}
            onOpenChange={setIsAlertOpen}
            title={alertAction === 'deleteProduct' ? 'Confirmar Eliminación' : 'Confirmar Borrado Completo'}
            description={
                alertAction === 'deleteProduct' && productToDelete ?
                `¿Estás seguro de que deseas eliminar permanentemente el producto "${productToDelete.description}" (${productToDelete.barcode}) y todo su inventario asociado? Esta acción no se puede deshacer.`
                : alertAction === 'clearDatabase' ?
                "Estás a punto de eliminar TODOS los productos y el inventario de la base de datos local permanentemente. Esta acción no se puede deshacer."
                : "Esta acción no se puede deshacer."
            }
            confirmText={alertAction === 'deleteProduct' ? "Sí, Eliminar Producto" : "Sí, Borrar Todo"}
            onConfirm={handleDeleteConfirmation}
            onCancel={() => { setIsAlertOpen(false); setProductToDelete(null); setAlertAction(null); }} // Ensure state reset on cancel
            isDestructive={true} // Make confirm button red
            isProcessing={isProcessing} // Disable buttons while processing
        />


      {/* Products Table */}
       <ProductTable
           productDetails={filteredProducts} // Use filtered products
           inventoryItems={inventoryItems} // Pass inventoryItems to find stock for 'main'
           isLoading={isLoading}
           onEdit={handleOpenEditDialog}
           onDelete={(barcode) => {
                const detail = productDetails.find(d => d.barcode === barcode);
                if (detail) {
                     triggerDeleteProductAlert(detail);
                } else {
                    toast({variant: "destructive", title: "Error", description: "No se encontró el producto para eliminar."})
                }
            }}
       />

      {/* Add/Edit Product Dialog */}
      <EditProductDialog
          isOpen={isEditModalOpen}
          setIsOpen={setIsEditModalOpen}
          selectedDetail={selectedDetail}
          setSelectedDetail={setSelectedDetail} // Pass handler to clear selection on close
          onSubmit={handleAddOrUpdateDetailSubmit}
          onDelete={(barcode) => triggerDeleteProductAlert(productDetails.find(d => d.barcode === barcode) || null)} // Trigger confirmation for delete
          isProcessing={isProcessing}
          initialStock={initialStockForEdit}
          context="database" // Indicate context is database management
       />
    </div>
  );
};


// --- Child Component: ProductTable ---
interface ProductTableProps {
  productDetails: ProductDetail[];
  inventoryItems: InventoryItem[]; // Needed to display 'main' stock
  isLoading: boolean;
  onEdit: (detail: ProductDetail) => void;
  onDelete: (barcode: string) => void;
}

const ProductTable: React.FC<ProductTableProps> = ({
  productDetails,
  inventoryItems,
  isLoading,
  onEdit,
  onDelete,
}) => {

  // Create a map for quick stock lookup in the 'main' warehouse
  const mainStockMap = React.useMemo(() => {
    const map = new Map<string, number>();
    inventoryItems
      .filter(item => item.warehouseId === 'main')
      .forEach(item => map.set(item.barcode, item.stock ?? 0));
    return map;
  }, [inventoryItems]);

  return (
    <ScrollArea className="h-[calc(100vh-400px)] md:h-[calc(100vh-350px)] border rounded-lg shadow-sm bg-white dark:bg-gray-800">
      <Table>
        <TableCaption className="dark:text-gray-400">Productos en la base de datos.</TableCaption>
        <TableHeader className="sticky top-0 bg-gray-50 dark:bg-gray-700 z-10 shadow-sm">
          <TableRow>
            <TableHead className="w-[15%] md:w-[15%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Código Barras</TableHead>
            <TableHead className="w-[40%] md:w-[45%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Descripción (Click para Editar)</TableHead>
            <TableHead className="hidden md:table-cell w-[20%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Proveedor</TableHead>
            <TableHead className="w-[15%] md:w-[15%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock (Principal)</TableHead>
            <TableHead className="w-[15%] md:w-[10%] text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-10 text-gray-500 dark:text-gray-400">
                Cargando productos...
              </TableCell>
            </TableRow>
          ) : productDetails.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-10 text-gray-500 dark:text-gray-400">
                No hay productos en la base de datos.
              </TableCell>
            </TableRow>
          ) : (
            productDetails.map((detail) => (
              <TableRow key={detail.barcode} className="hover:bg-muted/50 dark:hover:bg-gray-700 text-sm transition-colors duration-150">
                <TableCell className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">{detail.barcode}</TableCell>
                <TableCell
                    className="px-4 py-3 text-gray-800 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                    onClick={() => onEdit(detail)}
                    title={`Editar ${detail.description}`}
                 >
                    {detail.description}
                </TableCell>
                 <TableCell className="hidden md:table-cell px-4 py-3 text-gray-600 dark:text-gray-300">{detail.provider || 'N/A'}</TableCell>
                <TableCell className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 tabular-nums">
                  {mainStockMap.get(detail.barcode) ?? 0}
                </TableCell>
                <TableCell className="text-right px-4 py-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                        onClick={() => onEdit(detail)}
                        aria-label={`Editar ${detail.description}`}
                        title={`Editar ${detail.description}`}
                    >
                     <Edit className="mr-1 h-4 w-4" />
                        <span className="hidden sm:inline">Editar</span>
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 ml-1"
                        onClick={() => onDelete(detail.barcode)}
                        aria-label={`Borrar ${detail.description}`}
                        title={`Borrar ${detail.description}`}
                    >
                     <Trash className="mr-1 h-4 w-4" />
                      <span className="hidden sm:inline">Borrar</span>
                    </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};
