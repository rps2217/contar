// src/components/product-database.tsx
"use client";

import type { ProductDetail, DisplayProduct } from '@/types/product';
// zodResolver and other form-related imports might not be directly needed here if EditProductDialog handles it
// import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  addOrUpdateProductToDB,
  getAllProductsFromDB,
  deleteProductFromDB,
  clearProductDatabase as clearProductDatabaseFromDB,
  addProductsToDB,
} from '@/lib/database';
import {
    Filter, Play, Loader2, Save, Trash, Upload, AlertCircle, Warehouse as WarehouseIcon, CalendarIcon
} from "lucide-react";
import Papa from 'papaparse';
import * as React from "react"; 
import { useCallback, useEffect, useState, useMemo } from "react";
// import { useForm } from "react-hook-form"; // Might not be needed directly here
// import * as z from "zod"; // Might not be needed directly here
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
import { format, parse, isValid } from 'date-fns';
import { es } from 'date-fns/locale';


const GOOGLE_SHEET_URL_LOCALSTORAGE_KEY = 'stockCounterPro_googleSheetUrl';

// Helper Function to Extract Spreadsheet ID
const extractSpreadsheetId = (input: string): string | null => {
  if (!input) return null;
  const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
  const match = input.match(sheetUrlPattern);
  if (match && match[1]) {
    return match[1];
  }
  if (!input.startsWith('http') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
    return input;
  }
  return null;
};

// Google Sheet Parsing Logic
const parseGoogleSheetUrl = (sheetUrlOrId: string): { spreadsheetId: string | null; gid: string } => {
    const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
    const gidMatch = sheetUrlOrId.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';

    if (!spreadsheetId) {
         console.warn("Could not extract spreadsheet ID from input:", sheetUrlOrId);
         throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL/ID proporcionado. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }
    return { spreadsheetId, gid };
};

async function fetchAndParseGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
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
        if (status === 400 || errorBody.toLowerCase().includes("publish to the web")) userMessage = "Error: La hoja de cálculo debe estar 'Publicada en la web' como CSV para acceder a ella sin autenticación. Ve a Archivo > Compartir > Publicar en la web en Google Sheets.";
        else if (status === 403 || errorBody.toLowerCase().includes("google accounts sign in")) userMessage = "Error de Acceso: La hoja no es pública o requiere inicio de sesión. Cambie la configuración de compartir a 'Cualquier persona con el enlace puede ver' y asegúrese de que esté publicada en la web como CSV.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL/ID y el ID de la hoja.";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL/ID.`;
        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log(`Successfully fetched CSV data (length: ${csvText.length}). Parsing...`);

    return new Promise((resolve, reject) => {
        Papa.parse<string[]>(csvText, {
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length > 0) {
                    console.warn("Parsing errors encountered:", results.errors);
                    // Optionally reject or continue with partial data
                }
                const csvData = results.data;
                const products: ProductDetail[] = [];
                if (csvData.length === 0) {
                    console.warn("CSV data is empty or contains only empty lines.");
                    resolve(products);
                    return;
                }
                console.log(`Processing ${csvData.length} data rows (assuming first row is header).`);
                const startDataRow = 1; // Assume first row is header and skip it

                for (let i = startDataRow; i < csvData.length; i++) {
                    const values = csvData[i];
                    // Column 1: Barcode (index 0)
                    // Column 2: Description (index 1)
                    // Column 6: Stock (index 5)
                    // Column 10: Provider (index 9)
                    // Column 11 (NEW): Expiration Date (index 10), format YYYY-MM-DD
                    if (!values || values.length < 2) { // Barcode and Description are essential
                        console.warn(`Skipping row ${i + 1}: Insufficient essential columns. Row:`, values);
                        continue;
                    }

                    const barcode = values[0]?.trim();
                    if (!barcode) {
                        console.warn(`Skipping row ${i + 1}: Missing or empty barcode. Row:`, values);
                        continue;
                    }
                    if (barcode.length > 100) {
                        console.warn(`Skipping row ${i + 1}: Barcode too long (${barcode.length} chars). Row:`, values);
                        continue;
                    }

                    const description = values[1]?.trim() || `Producto ${barcode}`;
                    
                    let stock = 0;
                    if (values.length > 5 && values[5]) {
                        const stockStr = values[5].trim();
                        const parsedStock = parseInt(stockStr, 10);
                        if (!isNaN(parsedStock) && parsedStock >= 0) {
                            stock = parsedStock;
                        } else {
                            console.warn(`Invalid stock value "${stockStr}" for barcode ${barcode} in row ${i + 1}. Defaulting to 0.`);
                        }
                    }

                    const provider = (values.length > 9 && values[9]?.trim()) ? values[9].trim() : "Desconocido";

                    let expirationDate: string | undefined = undefined;
                    if (values.length > 10 && values[10]) {
                        const dateStr = values[10].trim();
                        // Try to parse common date formats or ensure it's YYYY-MM-DD
                        const commonFormats = ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"];
                        let parsedValidDate: Date | null = null;

                        for (const fmt of commonFormats) {
                            try {
                                const d = parse(dateStr, fmt, new Date());
                                if (isValid(d)) {
                                    parsedValidDate = d;
                                    break;
                                }
                            } catch (e) {/* ignore parse errors for other formats */}
                        }
                        
                        if (parsedValidDate) {
                            expirationDate = format(parsedValidDate, "yyyy-MM-dd");
                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && isValid(parseISO(dateStr))) {
                           expirationDate = dateStr; // Already in YYYY-MM-DD and valid
                        } else {
                            console.warn(`Invalid or unparseable expiration date "${dateStr}" for barcode ${barcode} in row ${i + 1}. Skipping expiration date.`);
                        }
                    }

                    products.push({ barcode, description, provider, stock, expirationDate });
                }
                console.log(`Parsed ${products.length} products from CSV.`);
                resolve(products);
            },
            error: (error: any) => {
                console.error("PapaParse error:", error);
                reject(new Error(`Error al analizar el archivo CSV: ${error.message}`));
            }
        });
    });
}


 interface ProductDatabaseProps {
  onStartCountByProvider: (products: DisplayProduct[]) => void;
 }


export const ProductDatabase: React.FC<ProductDatabaseProps> = ({ onStartCountByProvider }) => {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductDetail[]>([]);
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


 const handleAddOrUpdateProductSubmit = useCallback(async (data: ProductDetail) => { // Use ProductDetail directly
    const isUpdating = !!selectedProduct;
    const productData: ProductDetail = {
        barcode: isUpdating ? selectedProduct!.barcode : data.barcode.trim(),
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
        stock: data.stock ?? 0,
        expirationDate: data.expirationDate || undefined,
    };

    if (!productData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }

    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        await addOrUpdateProductToDB(productData);
        await loadProductsFromDB();
        toast({
            title: isUpdating ? "Producto Actualizado" : "Producto Agregado",
            description: `${productData.description} (${productData.barcode}) ha sido ${isUpdating ? 'actualizado' : 'agregado'}.`,
        });
        setIsEditModalOpen(false);
    } catch (error: any) {
        console.error("Add/Update product failed", error);
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.name === 'ConstraintError') { 
            errorMessage = `El producto con código de barras ${productData.barcode} ya existe.`;
        } else if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        toast({ variant: "destructive", title: "Error de Base de Datos", description: errorMessage });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
        setSelectedProduct(null);
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
      await loadProductsFromDB(); 
      toast({
        title: "Producto Eliminado",
        description: `El producto ${product?.description || barcode} ha sido eliminado de la base de datos.`,
      });
      setIsEditModalOpen(false); 
      setIsAlertOpen(false); 
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
      await clearProductDatabaseFromDB(); 
      setProducts([]); 
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

             const CHUNK_SIZE = 200; 
             for (let i = 0; i < totalItemsToLoad; i += CHUNK_SIZE) {
                 const chunk = parsedProducts.slice(i, i + CHUNK_SIZE);
                 await addProductsToDB(chunk);
                 itemsLoaded += chunk.length;
                 setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));
                 setProcessingStatus(`Cargando ${itemsLoaded} de ${totalItemsToLoad} productos...`);
             }

             await loadProductsFromDB(); 
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
         const dataToExport = products.map(p => ({
             BARCODE: p.barcode,
             DESCRIPTION: p.description,
             PROVIDER: p.provider,
             STOCK: p.stock ?? 0,
             FECHA_VENCIMIENTO: p.expirationDate || '', // Include expirationDate
         }));
         const csv = Papa.unparse(dataToExport, { header: true, quotes: true, skipEmptyLines: true });
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


    const providerOptions = useMemo(() => {
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

      const productsToCount: DisplayProduct[] = providerProducts.map(p => ({
          ...p,
          warehouseId: '', 
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


  const filteredProducts = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return products.filter(product => {
      const matchesSearch = !lowerSearchTerm ||
                            product.description.toLowerCase().includes(lowerSearchTerm) ||
                            product.barcode.includes(lowerSearchTerm) ||
                            (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
                            (product.expirationDate || '').includes(lowerSearchTerm); // Include expiration date in search

      const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;

      return matchesSearch && matchesProvider;
    }).sort((a, b) => { // Sort by expiration date (ascending, nulls/empty last)
        if (!a.expirationDate && !b.expirationDate) return 0;
        if (!a.expirationDate) return 1;
        if (!b.expirationDate) return -1;
        return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime();
    });
  }, [products, searchTerm, selectedProviderFilter]);


  return (
    <div className="p-4 md:p-6 space-y-6">
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
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
                <SelectValue placeholder="Acciones DB" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Acciones Base de Datos</SelectLabel>
                  <SelectItem value="add">
                    Agregar Producto
                  </SelectItem>
                  <SelectItem value="export" disabled={products.length === 0}>
                    Exportar Base de Datos (CSV)
                  </SelectItem>
                  <SelectItem value="clear" disabled={products.length === 0}>Borrar Base de Datos</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
         </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <Label htmlFor="search-product" className="sr-only">Buscar Producto</Label>
             <Input
                 id="search-product"
                 type="text"
                 placeholder="Buscar por código, descripción, fecha..."
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
              La hoja debe estar 'Publicada en la web' como CSV. Se leerá por posición de columna (asumiendo primera fila es encabezado): Col 1: Código, Col 2: Descripción, Col 6: Stock, Col 10: Proveedor, Col 11: Vencimiento (YYYY-MM-DD).
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

       <ProductTable
           products={filteredProducts}
           isLoading={isLoading}
           onEdit={handleOpenEditDialog}
       />

      <EditProductDialog
          isOpen={isEditModalOpen}
          setIsOpen={setIsEditModalOpen}
          selectedDetail={selectedProduct}
          setSelectedDetail={setSelectedProduct}
          onSubmit={handleAddOrUpdateProductSubmit}
          onDelete={(barcode) => triggerDeleteProductAlert(products.find(p => p.barcode === barcode) || null)}
          isProcessing={isProcessing}
          initialStock={selectedProduct?.stock} 
          context="database"
       />
    </div>
  );
};


interface ProductTableProps {
  products: ProductDetail[];
  isLoading: boolean;
  onEdit: (product: ProductDetail) => void;
}

const ProductTable: React.FC<ProductTableProps> = ({
  products,
  isLoading,
  onEdit,
}) => {

  return (
    <ScrollArea className="h-[calc(100vh-480px)] md:h-[calc(100vh-430px)] border rounded-lg shadow-sm bg-white dark:bg-gray-800">
      <Table>
        <TableCaption className="dark:text-gray-400">Productos en la base de datos. Click en la descripción para editar.</TableCaption>
        <TableHeader className="sticky top-0 bg-gray-50 dark:bg-gray-700 z-10 shadow-sm">
          <TableRow>
            <TableHead className="w-[20%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Código Barras</TableHead>
            <TableHead className="w-[35%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Descripción</TableHead>
            <TableHead className="w-[20%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Proveedor</TableHead>
            <TableHead className="w-[10%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock</TableHead>
            <TableHead className="w-[15%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Vencimiento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-10 text-gray-500 dark:text-gray-400">
                Cargando productos...
              </TableCell>
            </TableRow>
          ) : products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-10 text-gray-500 dark:text-gray-400">
                No hay productos en la base de datos.
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => (
              <TableRow key={product.barcode} className="hover:bg-muted/50 dark:hover:bg-gray-700 text-sm transition-colors duration-150">
                <TableCell className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">{product.barcode}</TableCell>
                <TableCell
                    className="px-4 py-3 text-gray-800 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                    onClick={() => onEdit(product)}
                    title={`Editar ${product.description}`}
                 >
                    {product.description}
                </TableCell>
                 <TableCell className="px-4 py-3 text-gray-600 dark:text-gray-300">{product.provider || 'N/A'}</TableCell>
                <TableCell className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 tabular-nums">
                  {product.stock ?? 0}
                </TableCell>
                <TableCell 
                    className={cn("px-4 py-3 text-center text-gray-600 dark:text-gray-300 tabular-nums",
                        product.expirationDate && new Date(product.expirationDate) < new Date() ? 'text-red-500 dark:text-red-400 font-semibold' : ''
                    )}
                    title={product.expirationDate ? `Vence: ${format(parseISO(product.expirationDate), 'PPP', {locale: es})}` : 'Sin fecha'}
                >
                  {product.expirationDate ? format(parseISO(product.expirationDate), 'dd/MM/yy', {locale: es}) : 'N/A'}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};
