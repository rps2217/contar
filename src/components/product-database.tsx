// src/components/product-database.tsx
"use client";

import type { ProductDetail, InventoryItem, DisplayProduct } from '@/types/product';
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem } from "@/lib/utils";
import {
  addOrUpdateProductToDB,
  getAllProductsFromDB,
  deleteProductFromDB,
  clearProductDatabase as clearProductDatabaseFromDB, // Renamed to avoid conflict
  addProductsToDB,
} from '@/lib/database';
import {
    Edit, Filter, Play, Loader2, Save, Trash, Upload, AlertCircle, Warehouse as WarehouseIcon
} from "lucide-react";
import Papa from 'papaparse'; // Using PapaParse for robust CSV parsing
import * as React from "react"; // Import React
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { EditProductDialog } from "@/components/edit-product-dialog";
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
import { useLocalStorage } from '@/hooks/use-local-storage';

// --- Zod Schema ---
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

const GOOGLE_SHEET_URL_LOCALSTORAGE_KEY = 'stockCounterPro_googleSheetUrl';

// --- Helper Function to Extract Spreadsheet ID ---
const extractSpreadsheetId = (input: string): string | null => {
  if (!input) return null;
  // Regex for standard Google Sheet URL
  const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
  const match = input.match(sheetUrlPattern);
  if (match && match[1]) {
    return match[1];
  }
  // If it's not a URL but looks like an ID (common length for IDs)
  if (!input.startsWith('http') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
    return input;
  }
  return null; // Not a valid URL or ID format
};

// --- Google Sheet Parsing Logic ---
const parseGoogleSheetUrl = (sheetUrlOrId: string): { spreadsheetId: string | null; gid: string } => {
    const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
    const gidMatch = sheetUrlOrId.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0'; // Default to first sheet if GID not specified

    if (!spreadsheetId) {
         console.warn("Could not extract spreadsheet ID from input:", sheetUrlOrId);
         throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL/ID proporcionado. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }
    return { spreadsheetId, gid };
};

async function fetchAndParseGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrlOrId);
    // Use a more reliable CSV export URL format
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log("Fetching Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        // Add a cache-busting parameter to ensure fresh data
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" }); // Prevent caching of the CSV
    } catch (error: any) {
        console.error("Network error fetching Google Sheet:", error);
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL/ID.";
        // Provide more specific feedback if possible
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
        // Attempt to read the error body, which might contain useful info or HTML
        const errorBody = await response.text().catch(() => "Could not read error response body.");
        console.error(`Failed to fetch Google Sheet data: ${status} ${statusText}`, { url: csvExportUrl, body: errorBody.substring(0, 500) }); // Log part of the body

        let userMessage = `Error ${status} al obtener datos. `;
        if (status === 400) userMessage += "Verifique la URL/ID y asegúrese de que el ID de la hoja (gid=...) sea correcto.";
        else if (status === 403 || errorBody.toLowerCase().includes("google accounts sign in")) userMessage = "Error de Acceso: La hoja no es pública. Cambie la configuración de compartir a 'Cualquier persona con el enlace puede ver'.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL/ID y el ID de la hoja.";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL/ID.`;

        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log(`Successfully fetched CSV data (length: ${csvText.length}). Parsing...`);

    // Use Papaparse for robust CSV parsing
    const { data: csvData, errors: parseErrors } = Papa.parse<string[]>(csvText, {
      header: false, // Data is parsed by position, not by header names
      skipEmptyLines: true,
    });

    if (parseErrors.length > 0) {
        console.warn("Parsing errors encountered:", parseErrors);
        // Depending on severity, you might choose to throw an error or continue
        // For now, we'll log and continue, skipping problematic rows.
    }

    const products: ProductDetail[] = [];
    if (csvData.length === 0) {
        console.warn("CSV data is empty or contains only empty lines.");
        return products;
    }

    console.log(`Processing ${csvData.length} data rows (including potential header).`);

    // Determine if the first row is a header or actual data.
    // For position-based, we might assume all rows are data unless a specific check is made.
    // Let's start from row 0, assuming no header or header is to be ignored for positional mapping.
    const startDataRow = 0; // Or 1 if you're sure the first row is always a header and should be skipped

    for (let i = startDataRow; i < csvData.length; i++) {
        const values = csvData[i];

        // Expecting at least 10 columns now to access provider safely
        if (!values || values.length < 10) {
            console.warn(`Skipping row ${i + 1}: Insufficient columns. Expected at least 10. Row:`, values);
            continue;
        }

        // --- Column Position Mapping (0-based index) ---
        // Column 1: Barcode
        const barcode = values[0]?.trim(); // Barcode is in the first column (index 0)
        if (!barcode) {
            console.warn(`Skipping row ${i + 1}: Missing or empty barcode (Column 1). Row:`, values);
            continue;
        }
         if (barcode.length > 100) { // Add length check if needed
             console.warn(`Skipping row ${i + 1}: Barcode too long (${barcode.length} chars). Row:`, values);
             continue;
         }

        // Column 2: Description
        const description = values[1]?.trim() || `Producto ${barcode}`; // Description is in the second column (index 1)
        // Column 6: Stock
        const stockStr = values[5]?.trim() || '0'; // Stock is in the sixth column (index 5)
        let stock = parseInt(stockStr, 10);
        if (isNaN(stock) || stock < 0) {
           console.warn(`Invalid stock value "${stockStr}" for barcode ${barcode} in row ${i + 1} (Column 6). Defaulting to 0.`);
           stock = 0;
        }
        // Column 10: Provider
        const provider = values[9]?.trim() || "Desconocido"; // Provider is in the tenth column (index 9)


        products.push({
            barcode: barcode,
            description: description,
            provider: provider,
            stock: stock, // Stock from the sheet is now part of ProductDetail
        });
    }

    console.log(`Parsed ${products.length} products from CSV based on column position.`);
    return products;
}


 interface ProductDatabaseProps {
  onStartCountByProvider: (products: DisplayProduct[]) => void;
  // No currentWarehouseId prop needed here as this component manages its own data
 }


export const ProductDatabase: React.FC<ProductDatabaseProps> = ({ onStartCountByProvider }) => {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductDetail[]>([]); // Holds all products from DB
  const [isLoading, setIsLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductDetail | null>(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertAction, setAlertAction] = useState<'deleteProduct' | 'clearDatabase' | null>(null);
  const [productToDelete, setProductToDelete] = useState<ProductDetail | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [googleSheetUrlOrId, setGoogleSheetUrlOrId] = useLocalStorage<string>(
      GOOGLE_SHEET_URL_LOCALSTORAGE_KEY,
      ""
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");


  // Load initial data from IndexedDB
  const loadProductsFromDB = useCallback(async () => {
    setIsLoading(true);
    try {
      const dbProducts = await getAllProductsFromDB();
      setProducts(dbProducts);
    } catch (error) {
      console.error("Failed to load products from IndexedDB:", error);
      toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo cargar la información de productos." });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadProductsFromDB();
  }, [loadProductsFromDB]);


  const handleGoogleSheetUrlOrIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrlOrId = e.target.value;
    setGoogleSheetUrlOrId(newUrlOrId);
  };


 const handleAddOrUpdateProductSubmit = useCallback(async (data: ProductDetailValues) => {
    const isUpdating = !!selectedProduct;
    const productData: ProductDetail = {
        ...data,
        barcode: isUpdating ? selectedProduct!.barcode : data.barcode.trim(), // Keep original barcode if updating
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
        stock: data.stock ?? 0, // Ensure stock is a number
    };

    if (!productData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }

    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        await addOrUpdateProductToDB(productData);
        await loadProductsFromDB(); // Reload data from DB
        toast({
            title: isUpdating ? "Producto Actualizado" : "Producto Agregado",
            description: `${productData.description} (${productData.barcode}) ha sido ${isUpdating ? 'actualizado' : 'agregado'}.`,
        });
        setIsEditModalOpen(false);
    } catch (error: any) {
        console.error("Add/Update product failed", error);
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.name === 'ConstraintError') { // Specific IndexedDB error for unique key violation
            errorMessage = `El producto con código de barras ${productData.barcode} ya existe.`;
        } else if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        toast({ variant: "destructive", title: "Error de Base de Datos", description: errorMessage });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
        setSelectedProduct(null); // Clear selection after operation
    }
 }, [selectedProduct, toast, loadProductsFromDB]);


  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
    if (!barcode) {
        toast({ variant: "destructive", title: "Error Interno", description: "No se puede eliminar el producto sin código de barras." });
        return;
    }
    const product = products.find(p => p.barcode === barcode);

    setIsProcessing(true);
    setProcessingStatus("Eliminando producto...");
    try {
      await deleteProductFromDB(barcode);
      await loadProductsFromDB(); // Reload
      toast({
        title: "Producto Eliminado",
        description: `El producto ${product?.description || barcode} ha sido eliminado de la base de datos.`,
      });
      setIsEditModalOpen(false); // Close edit dialog if open
      setIsAlertOpen(false); // Close confirmation dialog
      setProductToDelete(null);
      setAlertAction(null);
    } catch (error: any) {
      console.error("Failed to delete product", error);
      toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
    } finally {
          setIsProcessing(false);
          setProcessingStatus("");
    }
  }, [products, toast, loadProductsFromDB]);


  const handleClearProductDatabase = useCallback(async () => {
    setIsProcessing(true);
    setProcessingStatus("Borrando base de datos...");
    try {
      await clearProductDatabaseFromDB(); // Use renamed import
      setProducts([]); // Clear local state
      toast({ title: "Base de Datos Borrada", description: "Todos los productos han sido eliminados." });
    } catch (error: any) {
      console.error("Failed to clear product database", error);
      toast({ variant: "destructive", title: "Error al Borrar DB", description: `No se pudo borrar la base de datos: ${error.message}` });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
        setIsAlertOpen(false);
        setAlertAction(null);
    }
  }, [toast]);


  const handleOpenEditDialog = useCallback((product: ProductDetail | null) => {
    setSelectedProduct(product);
    setIsEditModalOpen(true);
  }, []);

  const triggerDeleteProductAlert = useCallback((product: ProductDetail | null) => {
      if (!product) {
         toast({ variant: "destructive", title: "Error Interno", description: "Datos del producto no disponibles para eliminar." });
         return;
      }
      setProductToDelete(product);
      setAlertAction('deleteProduct');
      setIsAlertOpen(true);
  }, [toast]);

  const triggerClearDatabaseAlert = useCallback(() => {
      if (products.length === 0) {
           toast({ title: "Base de Datos Vacía", description: "La base de datos ya está vacía." });
           return;
      }
      setAlertAction('clearDatabase');
      setIsAlertOpen(true);
  }, [products, toast]);

 const handleDeleteConfirmation = useCallback(() => {
    if (alertAction === 'deleteProduct' && productToDelete) {
        handleDeleteProduct(productToDelete.barcode);
    } else if (alertAction === 'clearDatabase') {
        handleClearProductDatabase();
    } else {
        console.warn("Delete confirmation called with invalid state:", { alertAction, productToDelete });
    }
    // Dialog closing and state reset now happens within handleDeleteProduct/handleClearProductDatabase
}, [alertAction, productToDelete, handleDeleteProduct, handleClearProductDatabase]);



   const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrlOrId) {
            toast({ variant: "destructive", title: "URL/ID Requerido", description: "Introduce la URL de la hoja de Google o el ID." });
            return;
        }

        setIsProcessing(true);
        setUploadProgress(0);
        setProcessingStatus("Obteniendo datos de Google Sheet...");

        try {
            const parsedProducts = await fetchAndParseGoogleSheetData(googleSheetUrlOrId);
             const totalItemsToLoad = parsedProducts.length;
             let itemsLoaded = 0;

             if (totalItemsToLoad === 0) {
                 toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja.", variant: "default" });
                 setIsProcessing(false);
                 setProcessingStatus("");
                 return;
             }

             // Batch add to IndexedDB
             const CHUNK_SIZE = 200; // Process in chunks
             for (let i = 0; i < totalItemsToLoad; i += CHUNK_SIZE) {
                 const chunk = parsedProducts.slice(i, i + CHUNK_SIZE);
                 await addProductsToDB(chunk); // This function handles transactions internally
                 itemsLoaded += chunk.length;
                 setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));
                 setProcessingStatus(`Cargando ${itemsLoaded} de ${totalItemsToLoad} productos...`);
             }


             await loadProductsFromDB(); // Reload data from DB
             toast({ title: "Carga Completa", description: `Se procesaron ${totalItemsToLoad} productos desde Google Sheet.` });

        } catch (error: any) {
            console.error("Error during Google Sheet load process:", error);
            setProcessingStatus("Error durante la carga.");
            toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet.", duration: 9000 });
        } finally {
            setIsProcessing(false);
            setProcessingStatus("");
            setUploadProgress(0);
        }
    }, [googleSheetUrlOrId, toast, loadProductsFromDB]);


  const handleExportDatabase = useCallback(() => {
     if (products.length === 0) {
       toast({ title: "Base de Datos Vacía", description: "No hay productos para exportar." });
       return;
     }
     try {
         // Use Papaparse for CSV generation
         const csv = Papa.unparse(products.map(p => ({
             BARCODE: p.barcode,
             DESCRIPTION: p.description,
             PROVIDER: p.provider,
             STOCK: p.stock ?? 0,
         })), {
            header: true,
            quotes: true, // Ensure fields with commas are quoted
            skipEmptyLines: true,
         });

         const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
         const link = document.createElement("a");
         link.href = URL.createObjectURL(blob);
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         link.setAttribute("download", `product_database_${timestamp}.csv`);
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(link.href);
         toast({ title: "Exportación Iniciada", description: "Se ha iniciado la descarga del archivo CSV." });
     } catch (error) {
          console.error("Error exporting database:", error);
          toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
     }
   }, [products, toast]);


    // Generate unique provider options from products
    const providerOptions = React.useMemo(() => {
        const providers = new Set(products.map(p => p.provider || "Desconocido").filter(Boolean));
        const sortedProviders = ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1;
            if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
        return sortedProviders;
    }, [products]);

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
    setProcessingStatus(`Buscando productos de ${selectedProviderFilter}...`);

    try {
      const providerProducts = products.filter(product => (product.provider || "Desconocido") === selectedProviderFilter);

      if (providerProducts.length === 0) {
        toast({ title: "Vacío", description: `No hay productos registrados para el proveedor ${selectedProviderFilter}.` });
        setIsProcessing(false);
        setProcessingStatus("");
        return;
      }

      // Convert ProductDetail[] to DisplayProduct[] for onStartCountByProvider
      // Assuming onStartCountByProvider expects DisplayProduct which might have warehouseId, count, etc.
      // For this context, we'll assume the count starts at 0 for a new session.
      // The warehouseId would be determined by the "Contador" section's current warehouse.
      const productsToCount: DisplayProduct[] = providerProducts.map(p => ({
          ...p,
          warehouseId: '', // This will be set by the main page context
          count: 0,
          lastUpdated: new Date().toISOString()
      }));

      onStartCountByProvider(productsToCount);

    } catch (error) {
      console.error("Error starting count by provider:", error);
      toast({ variant: "destructive", title: "Error", description: "No se pudo iniciar el conteo por proveedor." });
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  }, [selectedProviderFilter, products, onStartCountByProvider, toast]);


  const filteredProducts = React.useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return products.filter(product => {
      const matchesSearch = !lowerSearchTerm ||
                            product.description.toLowerCase().includes(lowerSearchTerm) ||
                            product.barcode.includes(lowerSearchTerm) ||
                            (product.provider || '').toLowerCase().includes(lowerSearchTerm);

      const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;

      return matchesSearch && matchesProvider;
    });
  }, [products, searchTerm, selectedProviderFilter]);


  return (
    <div className="p-4 md:p-6 space-y-6">
       {/* --- Toolbar --- */}
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
            {/* Actions Dropdown */}
            <Select onValueChange={(value) => {
                switch (value) {
                  case "add":
                    handleOpenEditDialog(null);
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
                  <SelectItem value="export" disabled={products.length === 0}>
                    Exportar Base de Datos
                  </SelectItem>
                  <SelectItem value="clear" disabled={products.length === 0}>Borrar Base de Datos</SelectItem>
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
                title={`Iniciar conteo para ${selectedProviderFilter === 'all' ? 'un proveedor' : selectedProviderFilter}`}
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
             type="text"
             placeholder="URL de Hoja de Google o ID de Hoja"
             value={googleSheetUrlOrId}
             onChange={handleGoogleSheetUrlOrIdChange}
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
              Introduzca la URL completa de la Hoja de Google (compartida públicamente) o simplemente el ID de la hoja de cálculo. Los datos se leerán por posición de columna (ignorando encabezados): Col 1: Código Barras, Col 2: Descripción, Col 6: Stock, Col 10: Proveedor.
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
              <p className="text-sm text-muted-foreground dark:text-gray-400 text-center mt-2">Cargando base de datos local...</p>
         )}
       </div>

       {/* Confirmation Dialog for Delete/Clear */}
        <ConfirmationDialog
            isOpen={isAlertOpen}
            onOpenChange={setIsAlertOpen}
            title={alertAction === 'deleteProduct' ? 'Confirmar Eliminación' : 'Confirmar Borrado Completo'}
            description={
                alertAction === 'deleteProduct' && productToDelete ?
                `¿Estás seguro de que deseas eliminar permanentemente el producto "${productToDelete.description}" (${productToDelete.barcode})? Esta acción no se puede deshacer.`
                : alertAction === 'clearDatabase' ?
                "Estás a punto de eliminar TODOS los productos de la base de datos permanentemente. Esta acción no se puede deshacer."
                : "Esta acción no se puede deshacer."
            }
            confirmText={alertAction === 'deleteProduct' ? "Sí, Eliminar Producto" : "Sí, Borrar Todo"}
            onConfirm={handleDeleteConfirmation}
            onCancel={() => { setIsAlertOpen(false); setProductToDelete(null); setAlertAction(null); }}
            isDestructive={true}
            isProcessing={isProcessing}
        />


      {/* Products Table */}
       <ProductTable
           products={filteredProducts}
           isLoading={isLoading}
           onEdit={handleOpenEditDialog}
           onDelete={(barcode) => {
                const product = products.find(p => p.barcode === barcode);
                if (product) {
                     triggerDeleteProductAlert(product);
                } else {
                    toast({variant: "destructive", title: "Error", description: "No se encontró el producto para eliminar."})
                }
            }}
       />

      {/* Add/Edit Product Dialog */}
      <EditProductDialog
          isOpen={isEditModalOpen}
          setIsOpen={setIsEditModalOpen}
          selectedDetail={selectedProduct} // Changed from selectedProduct
          setSelectedDetail={setSelectedProduct}
          onSubmit={handleAddOrUpdateProductSubmit}
          onDelete={(barcode) => triggerDeleteProductAlert(products.find(p => p.barcode === barcode) || null)}
          isProcessing={isProcessing}
          initialStock={selectedProduct?.stock} // Pass current stock of selected product
          context="database"
          // No warehouseName prop needed if EditProductDialog handles stock for the product detail directly
       />
    </div>
  );
};


// --- Child Component: ProductTable ---
interface ProductTableProps {
  products: ProductDetail[]; // Changed from ProductDetail[] to ProductDetail[]
  isLoading: boolean;
  onEdit: (product: ProductDetail) => void; // Changed from ProductDetail to ProductDetail
  onDelete: (barcode: string) => void;
}

const ProductTable: React.FC<ProductTableProps> = ({
  products,
  isLoading,
  onEdit,
  onDelete,
}) => {

  return (
    <ScrollArea className="h-[calc(100vh-400px)] md:h-[calc(100vh-350px)] border rounded-lg shadow-sm bg-white dark:bg-gray-800">
      <Table>
        <TableCaption className="dark:text-gray-400">Productos en la base de datos.</TableCaption>
        <TableHeader className="sticky top-0 bg-gray-50 dark:bg-gray-700 z-10 shadow-sm">
          <TableRow>
            <TableHead className="w-[15%] md:w-[15%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Código Barras</TableHead>
            <TableHead className="w-[40%] md:w-[45%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Descripción (Click para Editar)</TableHead>
             <TableHead className="hidden md:table-cell w-[20%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Proveedor</TableHead>
            <TableHead className="w-[15%] md:w-[15%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock</TableHead>
            {/* Actions column removed as editing is triggered by clicking description */}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-10 text-gray-500 dark:text-gray-400">
                Cargando productos...
              </TableCell>
            </TableRow>
          ) : products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-10 text-gray-500 dark:text-gray-400">
                No hay productos en la base de datos.
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => ( // Changed from ProductDetail to ProductDetail
              <TableRow key={product.barcode} className="hover:bg-muted/50 dark:hover:bg-gray-700 text-sm transition-colors duration-150">
                <TableCell className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">{product.barcode}</TableCell>
                <TableCell
                    className="px-4 py-3 text-gray-800 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                    onClick={() => onEdit(product)} // Trigger edit on description click
                    title={`Editar ${product.description}`}
                 >
                    {product.description}
                </TableCell>
                 <TableCell className="hidden md:table-cell px-4 py-3 text-gray-600 dark:text-gray-300">{product.provider || 'N/A'}</TableCell>
                <TableCell className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 tabular-nums">
                  {product.stock ?? 0}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};
