// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, debounce } from "@/lib/utils";
// Firestore functions are called via props from page.tsx
// Local IndexedDB functions for fallback or direct interaction if needed
import {
  addProductsToDB as addProductsToIndexedDBCache,
  clearProductDatabase as clearProductDatabaseInIndexedDBCache,
} from '@/lib/database'; 

import {
    Filter, Play, Loader2, Save, Trash, Upload, Edit, AlertTriangle
} from "lucide-react";
import Papa from 'papaparse';
import * as React from "react";
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { EditProductDialog } from "@/components/edit-product-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
    SelectGroup, SelectLabel,
} from "@/components/ui/select";
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { format, parseISO, isValid as isValidDate } from 'date-fns';
import { es } from 'date-fns/locale';
import { GOOGLE_SHEET_URL_LOCALSTORAGE_KEY } from '@/lib/constants';
import { useLocalStorage } from '@/hooks/use-local-storage';


const CHUNK_SIZE = 200; // For parsing CSV, not directly for Firestore batch limits
const SEARCH_DEBOUNCE_MS = 300;

// Helper to extract spreadsheet ID and GID from URL or ID
const extractSpreadsheetIdAndGid = (input: string): { spreadsheetId: string | null; gid: string } => {
    if (!input) return { spreadsheetId: null, gid: '0' };
    let spreadsheetId: string | null = null;
    const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/.*)?/;
    const idMatch = input.match(sheetUrlPattern);
    if (idMatch && idMatch[1]) {
        spreadsheetId = idMatch[1];
    } else if (!input.includes('/') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
        // Assume it's just an ID if it doesn't look like a URL but matches ID pattern
        spreadsheetId = input;
    }

    const gidMatch = input.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0'; // Default to first sheet if GID not specified

    return { spreadsheetId, gid };
};


async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);

    if (!spreadsheetId) {
        console.warn("Could not extract spreadsheet ID from input:", sheetUrlOrId);
        throw new Error("URL/ID de Hoja de Google inválido. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }

    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log(`Fetching Google Sheet data from: ${csvExportUrl}`);

    let response: Response;
    try {
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" });
    } catch (error: any) {
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL/ID.";
        if (error.message?.includes('Failed to fetch')) {
            userMessage += " Posible problema de CORS, conectividad, o la URL/ID es incorrecta. Asegúrese de que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.";
        } else {
            userMessage += ` Detalle: ${error.message}`;
        }
        throw new Error(userMessage);
    }

    if (!response.ok) {
        const status = response.status;
        const statusText = response.statusText;
        let errorBody = "No se pudo leer el cuerpo del error.";
        try { errorBody = await response.text(); } catch { /* no-op */ }

        let userMessage = `Error ${status} al obtener datos. `;
        if (status === 400) userMessage += "Solicitud incorrecta. Verifique la URL y el GID de la hoja.";
        else if (status === 403) userMessage += "Acceso denegado. Asegúrese de que la hoja de cálculo tenga permisos de 'cualquiera con el enlace puede ver'.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL/ID y el ID de la hoja (gid).";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL/ID. Detalle del servidor: ${errorBody.substring(0, 200)}`;
        
        console.error("Google Sheet fetch error details:", { status, statusText, errorBody, csvExportUrl });
        throw new Error(userMessage);
    }

    const csvText = await response.text();

    return new Promise((resolve, reject) => {
        if (typeof Papa === 'undefined') {
            reject(new Error("La librería PapaParse (Papa) no está cargada."));
            return;
        }

        Papa.parse<string[]>(csvText, {
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length > 0) {
                     results.errors.forEach(err => console.warn(`PapaParse error: ${err.message} on row ${err.row}. Code: ${err.code}. Type: ${err.type}`));
                }
                const csvData = results.data;
                const products: ProductDetail[] = [];

                if (csvData.length <= 1) { // Only header or empty
                    resolve(products);
                    return;
                }
                
                // Columna 1 (índice 0) para código
                // Columna 2 (índice 1) para descripción
                // Columna 3 (índice 2) para fecha de vencimiento (opcional)
                // Columna 6 (índice 5) para stock
                // Columna 10 (índice 9) para proveedor
                const BARCODE_COLUMN_INDEX = 0;
                const DESCRIPTION_COLUMN_INDEX = 1;
                const EXPIRATION_DATE_COLUMN_INDEX = 2; // ¡AJUSTA ESTO SI ES DIFERENTE!
                const STOCK_COLUMN_INDEX = 5;
                const PROVIDER_COLUMN_INDEX = 9;

                for (let i = 1; i < csvData.length; i++) { // Empezar desde 1 para saltar encabezados
                    const values = csvData[i];
                    if (!values || values.length === 0 || values.every(v => !v?.trim())) continue; // Skip fully empty rows

                    const barcode = values[BARCODE_COLUMN_INDEX]?.trim();
                    if (!barcode) { 
                        console.warn(`Fila ${i + 1} omitida: Código de barras vacío o faltante.`);
                        continue;
                    }

                    const description = values[DESCRIPTION_COLUMN_INDEX]?.trim();
                    const stockStr = values[STOCK_COLUMN_INDEX]?.trim();
                    const provider = values[PROVIDER_COLUMN_INDEX]?.trim();
                    const expirationDateStr = values[EXPIRATION_DATE_COLUMN_INDEX]?.trim();

                    const finalDescription = description || `Producto ${barcode}`; 
                    const finalProvider = provider || "Desconocido"; 

                    let stock = 0;
                    if (stockStr) {
                        const parsedStock = parseInt(stockStr, 10);
                        if (!isNaN(parsedStock) && parsedStock >= 0) {
                            stock = parsedStock;
                        } else {
                             console.warn(`Valor de stock inválido "${stockStr}" para código ${barcode} en fila ${i + 1}. Usando 0.`);
                        }
                    }
                    
                    const expirationDate: string | null = expirationDateStr ? expirationDateStr : null;

                    products.push({ barcode, description: finalDescription, provider: finalProvider, stock, expirationDate });
                }
                resolve(products);
            },
            error: (error: any) => {
                reject(new Error(`Error al analizar el archivo CSV: ${error.message}`));
            }
        });
    });
}


 interface ProductDatabaseProps {
  userId: string | null; 
  isTransitionPending?: boolean;
  catalogProducts: ProductDetail[]; // Passed from parent, reflects Firestore data
  onCatalogChange: () => Promise<void>; // Callback to re-sync catalog after local changes
  onClearCatalogRequest: () => void;
  onStartCountByProvider: (products: ProductDetail[]) => void;
  // Callbacks for CRUD operations, to be handled by parent (page.tsx)
  onAddOrUpdateProduct: (product: ProductDetail) => Promise<void>;
  onDeleteProduct: (barcode: string) => Promise<void>;
  onLoadFromGoogleSheet: (sheetUrlOrId: string) => Promise<void>;
 }


const ProductDatabaseComponent: React.FC<ProductDatabaseProps> = ({
    userId,
    isTransitionPending,
    catalogProducts,
    onCatalogChange,
    onClearCatalogRequest,
    onStartCountByProvider,
    onAddOrUpdateProduct,
    onDeleteProduct,
    onLoadFromGoogleSheet,
 }) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false); 
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedProductForEdit, setSelectedProductForEdit] = useState<ProductDetail | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false); 
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [googleSheetUrlOrId, setGoogleSheetUrlOrId] = useLocalStorage<string>(
      GOOGLE_SHEET_URL_LOCALSTORAGE_KEY, ""
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const handleGoogleSheetUrlOrIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGoogleSheetUrlOrId(e.target.value);
  };

  const handleLoadFromGoogleSheetClick = async () => {
    if (!googleSheetUrlOrId) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido" }));
      return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setUploadProgress(0); 
    setProcessingStatus("Obteniendo datos de Google Sheet...");
    try {
      await onLoadFromGoogleSheet(googleSheetUrlOrId);
      // Success toast is handled by parent (page.tsx) after Firestore operation completes
      if (isMountedRef.current) setUploadProgress(100);
    } catch (error: any) {
      if (isMountedRef.current) {
        setProcessingStatus("Error durante la carga.");
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido."}));
      }
    } finally {
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStatus(""); }
    }
  };

  const handleAddOrUpdateProductSubmit = async (data: ProductDetail) => {
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus(selectedProductForEdit ? "Actualizando producto..." : "Agregando producto...");
    try {
      await onAddOrUpdateProduct(data); // Call parent handler for Firestore operation
      if (isMountedRef.current) {
        setIsEditModalOpen(false);
        setSelectedProductForEdit(null);
      }
    } catch (error: any) {
      if (isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo", description: `Error al guardar: ${error.message}` }));
      }
    } finally {
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStatus(""); }
    }
  };

  const handleDeleteProductSubmit = async (barcode: string) => {
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus("Eliminando producto...");
    try {
      await onDeleteProduct(barcode); // Call parent handler for Firestore operation
      if (isMountedRef.current) {
        setIsEditModalOpen(false);
        setSelectedProductForEdit(null);
      }
    } catch (error: any) {
      if (isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` }));
      }
    } finally {
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStatus(""); }
    }
  };

  const handleOpenEditDialog = useCallback((product: ProductDetail | null) => {
    setSelectedProductForEdit(product); 
    setIsEditModalOpen(true);
  }, []);

  const handleExportDatabase = useCallback(() => {
     if (catalogProducts.length === 0) {
       requestAnimationFrame(() => toast({ title: "Catálogo Vacío" }));
       return;
     }
     try {
         const dataToExport = catalogProducts.map(p => ({
             CODIGO_BARRAS: p.barcode,
             DESCRIPCION: p.description,
             PROVEEDOR: p.provider,
             STOCK: p.stock ?? 0,
             FECHA_VENCIMIENTO: p.expirationDate && isValidDate(parseISO(p.expirationDate)) ? format(parseISO(p.expirationDate), "yyyy-MM-dd") : '',
         }));
         if (typeof Papa === 'undefined') throw new Error("PapaParse no está cargado.");
         const csv = Papa.unparse(dataToExport, { header: true, quotes: true, skipEmptyLines: true });
         const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
         const link = document.createElement("a");
         link.href = URL.createObjectURL(blob);
         const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
         link.setAttribute("download", `catalogo_productos_${timestamp}.csv`);
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(link.href);
         requestAnimationFrame(() => toast({ title: "Exportación Iniciada"}));
     } catch (error: any) {
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Exportación", description: error.message }));
     }
   }, [catalogProducts, toast]);

    const providerOptions = useMemo(() => {
        const providers = new Set(catalogProducts.map(p => p.provider || "Desconocido").filter(Boolean));
        const sortedProviders = ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1; if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
        return sortedProviders;
    }, [catalogProducts]);

  const handleStartCountByProviderClick = useCallback(async () => {
    if (selectedProviderFilter === 'all') {
      requestAnimationFrame(() => toast({ title: "Seleccionar Proveedor" }));
      return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus(`Buscando productos de ${selectedProviderFilter}...`);
    try {
      const providerProducts = catalogProducts.filter(product => (product.provider || "Desconocido") === selectedProviderFilter);
      if (providerProducts.length === 0) {
        if (isMountedRef.current) requestAnimationFrame(() => toast({ title: "Vacío", description: `No hay productos para ${selectedProviderFilter}.` }));
      } else {
        onStartCountByProvider(providerProducts); 
      }
    } catch (error) {
      if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error" }));
    } finally {
      if (isMountedRef.current) { setIsProcessing(false); setProcessingStatus(""); }
    }
  }, [selectedProviderFilter, catalogProducts, onStartCountByProvider, toast]);

  const debouncedSetSearchTerm = useMemo(
    () => debounce((term: string) => { if(isMountedRef.current) setSearchTerm(term) }, SEARCH_DEBOUNCE_MS),
    [] 
  );
  useEffect(() => () => debouncedSetSearchTerm.clear?.(), [debouncedSetSearchTerm]);

  const filteredProducts = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return catalogProducts.filter(product => {
      const matchesSearch = !lowerSearchTerm ||
                            product.description.toLowerCase().includes(lowerSearchTerm) ||
                            product.barcode.includes(lowerSearchTerm) ||
                            (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
                            (product.expirationDate && isValidDate(parseISO(product.expirationDate)) && format(parseISO(product.expirationDate), 'dd/MM/yy', {locale: es}).includes(lowerSearchTerm));
      const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;
      return matchesSearch && matchesProvider;
    }).sort((a, b) => a.description.localeCompare(b.description));
  }, [catalogProducts, searchTerm, selectedProviderFilter]);

  return (
    <div className="p-4 md:p-6 space-y-6">
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
            <Select
              onValueChange={(value) => {
                if (value === "add") handleOpenEditDialog(null);
                else if (value === "export") handleExportDatabase();
                else if (value === "clear") onClearCatalogRequest();
              }}
              disabled={isProcessing || isLoading || isTransitionPending}
              value="" 
            >
              <SelectTrigger className="w-full sm:w-auto md:w-[200px] h-10 bg-card">
                <SelectValue placeholder="Acciones Catálogo" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Acciones Catálogo</SelectLabel>
                  <SelectItem value="add">Agregar Producto</SelectItem>
                  <SelectItem value="export" disabled={catalogProducts.length === 0}>Exportar Catálogo (CSV)</SelectItem>
                  <SelectItem value="clear" disabled={catalogProducts.length === 0} className="text-destructive focus:text-destructive">Borrar Catálogo</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
         </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <Label htmlFor="search-product-db" className="sr-only">Buscar Producto</Label>
             <Input
                 id="search-product-db"
                 type="text"
                 placeholder="Buscar por código, descripción..."
                 onChange={(e) => debouncedSetSearchTerm(e.target.value)}
                 className="h-10 flex-grow min-w-[150px] bg-card"
                 disabled={isProcessing || isLoading || isTransitionPending}
             />
             <Select
                 value={selectedProviderFilter}
                 onValueChange={setSelectedProviderFilter}
                 disabled={providerOptions.length <= 1 || isProcessing || isLoading || isTransitionPending}
             >
                 <SelectTrigger className="w-full sm:w-auto md:w-[200px] h-10 bg-card">
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
                disabled={selectedProviderFilter === 'all' || isProcessing || isLoading || isTransitionPending}
                variant="outline"
                className="h-10 text-primary border-primary/50 hover:bg-primary/10"
                title={`Iniciar conteo para ${selectedProviderFilter === 'all' ? 'un proveedor' : selectedProviderFilter}`}
            >
                <Play className="mr-2 h-4 w-4" /> Contar Proveedor
            </Button>
         </div>
       </div>

       <div className="space-y-2 p-4 border rounded-lg bg-card shadow-sm">
           <Label htmlFor="google-sheet-url" className="block font-medium mb-1">
              Cargar/Actualizar Catálogo desde Google Sheet:
           </Label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
             <Input
             id="google-sheet-url"
             type="text"
             placeholder="URL completa de Hoja de Google o ID de Hoja"
             value={googleSheetUrlOrId}
             onChange={handleGoogleSheetUrlOrIdChange}
             className="flex-grow h-10 bg-background"
             disabled={isProcessing || isLoading || isTransitionPending}
             aria-describedby="google-sheet-info"
             />
             <Button variant="secondary" disabled={isProcessing || isLoading || !googleSheetUrlOrId || isTransitionPending} onClick={handleLoadFromGoogleSheetClick}>
                {isProcessing && processingStatus.includes("Google") ?
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :
                  <Upload className="mr-2 h-4 w-4" />
                 }
                 {isProcessing && processingStatus.includes("Google") ? 'Cargando...' : 'Cargar Datos'}
             </Button>
         </div>
         <p id="google-sheet-info" className="text-xs text-muted-foreground mt-1">
             La hoja debe tener permisos de 'cualquiera con el enlace puede ver'. Columnas: 1=Código, 2=Descripción, 3=Vencimiento (YYYY-MM-DD, opcional), 6=Stock, 10=Proveedor.
         </p>
         {isProcessing && uploadProgress > 0 && (
             <div className="mt-4 space-y-1">
                 <Progress value={uploadProgress} className="h-2 w-full" />
                 <p className="text-sm text-muted-foreground text-center">
                     {processingStatus || `Cargando... (${uploadProgress}%)`}
                 </p>
             </div>
         )}
         {isLoading && !isProcessing && ( 
              <div className="flex justify-center items-center py-6">
                 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                 <span className="ml-2 text-muted-foreground">Cargando catálogo de productos...</span>
              </div>
         )}
       </div>

       <ProductTable
           products={filteredProducts}
           isLoading={isLoading || isTransitionPending}
           onEdit={handleOpenEditDialog}
           onDeleteRequest={(product) => {
              // This could open a confirmation dialog controlled by ProductDatabase component
              // For now, we'll directly call the delete handler passed from parent for simplicity of this refactor.
              // Ideally, a confirmation dialog is managed here or by the parent.
              if (product && product.barcode) {
                // Example of direct call if no confirmation is needed here:
                // handleDeleteProductSubmit(product.barcode);
                // For consistency with other delete operations, we'll set the product and open a shared dialog if needed.
                // Or, ProductTable could have its own delete confirmation.
                // For this refactor, keeping it simple: onEdit also handles delete intent through the dialog.
                handleOpenEditDialog(product); // User can delete from the edit dialog
              }
           }}
       />

      <EditProductDialog
          isOpen={isEditModalOpen}
          setIsOpen={(open) => {
            setIsEditModalOpen(open);
            if (!open) setSelectedProductForEdit(null); 
          }}
          selectedDetail={selectedProductForEdit}
          setSelectedDetail={setSelectedProductForEdit} 
          onSubmit={handleAddOrUpdateProductSubmit}
          onDelete={selectedProductForEdit ? () => handleDeleteProductSubmit(selectedProductForEdit.barcode) : undefined}
          isProcessing={isProcessing || isTransitionPending}
          context="database"
       />
    </div>
  );
};

export const ProductDatabase = React.memo(ProductDatabaseComponent);


interface ProductTableProps {
  products: ProductDetail[];
  isLoading: boolean;
  onEdit: (product: ProductDetail) => void;
  onDeleteRequest: (product: ProductDetail) => void;
}

const ProductTable: React.FC<ProductTableProps> = React.memo(({
  products,
  isLoading,
  onEdit,
  onDeleteRequest,
}) => {
  return (
    <ScrollArea className="h-[calc(100vh-500px)] md:h-[calc(100vh-450px)] border rounded-lg shadow-sm bg-card dark:bg-card">
      <Table>
        <TableCaption>Productos en el catálogo. Click en la descripción para editar.</TableCaption>
        <TableHeader className="sticky top-0 bg-muted/50 z-10 shadow-sm">
          <TableRow>
            <TableHead className="w-[20%] sm:w-[15%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Código Barras</TableHead>
            <TableHead className="w-[30%] sm:w-[25%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Descripción</TableHead>
            <TableHead className="w-[20%] sm:w-[20%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Proveedor</TableHead>
            <TableHead className="w-[10%] sm:w-[10%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Stock</TableHead>
            <TableHead className="w-[10%] sm:w-[15%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Vencimiento</TableHead>
            <TableHead className="w-[10%] sm:w-[15%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && !products.length ? ( 
            <TableRow>
              <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                <div className="flex justify-center items-center">
                   <Loader2 className="h-6 w-6 animate-spin mr-2" />
                   Cargando productos...
                </div>
              </TableCell>
            </TableRow>
          ) : !isLoading && products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                No hay productos en el catálogo. Agrega uno o carga desde Google Sheet.
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => {
              const expirationDateObj = product.expirationDate ? parseISO(product.expirationDate) : null;
              const isValidExp = expirationDateObj && isValidDate(expirationDateObj);
              return (
              <TableRow key={product.barcode} className="text-sm hover:bg-muted/10 transition-colors">
                <TableCell className="px-2 sm:px-4 py-3 font-mono">{product.barcode}</TableCell>
                <TableCell
                    className="px-2 sm:px-4 py-3 font-semibold cursor-pointer hover:text-primary hover:underline"
                    onClick={() => onEdit(product)}
                    title={`Editar ${product.description}`}
                 >
                    {product.description}
                </TableCell>
                 <TableCell className="px-2 sm:px-4 py-3">{product.provider || 'N/A'}</TableCell>
                <TableCell className="px-2 sm:px-4 py-3 text-center tabular-nums">
                  {product.stock ?? 0}
                </TableCell>
                <TableCell
                    className={cn("px-2 sm:px-4 py-3 text-center tabular-nums text-xs",
                        isValidExp && new Date() > expirationDateObj! ? 'text-red-500 font-semibold' : ''
                    )}
                    title={isValidExp ? `Vence: ${format(expirationDateObj!, 'PPP', {locale: es})}` : 'Sin fecha'}
                >
                  {isValidExp ? format(expirationDateObj!, 'dd/MM/yy', {locale: es}) : 'N/A'}
                </TableCell>
                <TableCell className="px-2 sm:px-4 py-3 text-center">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(product)} className="text-primary hover:text-primary/80 h-7 w-7" title="Editar Producto">
                        <Edit className="h-4 w-4"/>
                    </Button>
                    {/* The delete action is now handled via the EditProductDialog */}
                </TableCell>
              </TableRow>
            )})
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
});
ProductTable.displayName = 'ProductTable';
