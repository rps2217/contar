
// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, debounce } from "@/lib/utils";
import {
    Filter, Play, Loader2, Save, Trash, Upload, Edit, AlertTriangle, Plus // Added Plus here
} from "lucide-react";

import * as React from "react";
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
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


// IndexedDB functions (as a cache/fallback for the catalog)
import {
    getAllProductsFromDB as getAllProductsFromIndexedDB,
    addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
    deleteProductFromDB as deleteProductFromIndexedDB,
    addProductsToDB as addProductsToIndexedDB,
    clearProductDatabase as clearProductDatabaseInIndexedDB,
} from '@/lib/database';

// Firestore functions (master source for the catalog)
import {
  getAllProductsFromCatalog,
  addOrUpdateProductInCatalog,
  deleteProductFromCatalog,
  addProductsToCatalog,
  clearProductCatalogInFirestore,
} from '@/lib/firestore-service';


const SEARCH_DEBOUNCE_MS = 300;

 interface ProductDatabaseProps {
  userId: string | null;
  catalogProducts: ProductDetail[]; // Received from parent (Home.tsx), sourced from Firestore
  isLoadingExternal: boolean;
  processingStatus: string;
  setProcessingStatus: (status: string) => void;
  onEditProductRequest: (product: ProductDetail) => void;
  // Callbacks to parent (Home.tsx) to handle Firestore operations and state updates
  onLoadFromGoogleSheet: (sheetUrlOrId: string) => Promise<void>;
  onAddOrUpdateLocalProduct: (product: ProductDetail) => Promise<void>; // This will call the handler in page.tsx
  onDeleteLocalProduct: (barcode: string) => Promise<void>; // This will call the handler in page.tsx
  onClearCatalogRequest: () => void; // To open confirmation dialog in parent
  onStartCountByProvider: (products: ProductDetail[]) => void;
 }


const ProductDatabaseComponent: React.FC<ProductDatabaseProps> = ({
    userId,
    catalogProducts, // Use this prop for displaying products
    isLoadingExternal = false,
    processingStatus,
    setProcessingStatus,
    onEditProductRequest,
    onLoadFromGoogleSheet,
    onAddOrUpdateLocalProduct, // Renamed for clarity, points to handleAddOrUpdateCatalogProduct in page.tsx
    onDeleteLocalProduct,      // Renamed for clarity, points to handleDeleteCatalogProduct in page.tsx
    onClearCatalogRequest,
    onStartCountByProvider
 }) => {
  const { toast } = useToast();
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
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
    // This now calls the function passed from Home.tsx, which handles Firestore & IndexedDB cache
    await onLoadFromGoogleSheet(googleSheetUrlOrId);
  };

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
    const providerProducts = catalogProducts.filter(product => (product.provider || "Desconocido") === selectedProviderFilter);
    if (providerProducts.length === 0) {
      if (isMountedRef.current) requestAnimationFrame(() => toast({ title: "Vacío", description: `No hay productos para ${selectedProviderFilter}.` }));
    } else {
      onStartCountByProvider(providerProducts);
    }
  }, [selectedProviderFilter, catalogProducts, onStartCountByProvider, toast]);

  const debouncedSetSearchTerm = useMemo(
    () => debounce((term: string) => { if(isMountedRef.current) setSearchTerm(term) }, SEARCH_DEBOUNCE_MS),
    []
  );
  useEffect(() => () => debouncedSetSearchTerm.clear?.(), [debouncedSetSearchTerm]);

  const filteredProducts = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return catalogProducts // Use catalogProducts prop directly
      .filter(product => {
        if (!product || !product.barcode) return false;
        const matchesSearch = !lowerSearchTerm ||
                              (product.description || '').toLowerCase().includes(lowerSearchTerm) ||
                              product.barcode.includes(lowerSearchTerm) ||
                              (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
                              (product.expirationDate && isValidDate(parseISO(product.expirationDate)) && format(parseISO(product.expirationDate), 'dd/MM/yy', {locale: es}).includes(lowerSearchTerm));
        const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;
        return matchesSearch && matchesProvider;
      })
      // Sorting is now handled by the parent component (Home.tsx) which gets data from Firestore
      // .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
  }, [catalogProducts, searchTerm, selectedProviderFilter]);

  //isLoading combines external and local loading states
  const isLoading = isLoadingExternal || isLoadingLocal;

  const handleAddNewProductClick = () => {
    // Calls the prop function which opens EditProductDialog in Home.tsx with product = null
    onEditProductRequest({ barcode: '', description: '', provider: '', stock: 0, expirationDate: null });
  };


  return (
    <div className="p-4 md:p-6 space-y-6">
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
            <Button
                onClick={handleAddNewProductClick}
                disabled={isLoading}
                variant="outline"
                className="h-10 text-primary border-primary/50 hover:bg-primary/10"
            >
                <Plus className="mr-2 h-4 w-4" /> Agregar Producto
            </Button>
         </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <Label htmlFor="search-product-db" className="sr-only">Buscar Producto</Label>
             <Input
                 id="search-product-db"
                 type="text"
                 placeholder="Buscar por código, descripción..."
                 onChange={(e) => debouncedSetSearchTerm(e.target.value)}
                 className="h-10 flex-grow min-w-[150px] bg-card"
                 disabled={isLoading}
             />
             <Select
                 value={selectedProviderFilter}
                 onValueChange={setSelectedProviderFilter}
                 disabled={providerOptions.length <= 1 || isLoading}
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
                disabled={selectedProviderFilter === 'all' || isLoading}
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
             disabled={isLoading}
             aria-describedby="google-sheet-info"
             />
             <Button variant="secondary" disabled={isLoading || !googleSheetUrlOrId} onClick={handleLoadFromGoogleSheetClick}>
                {isLoading && processingStatus?.includes("Google") ?
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :
                  <Upload className="mr-2 h-4 w-4" />
                 }
                 {isLoading && processingStatus?.includes("Google") ? 'Cargando...' : 'Cargar Datos'}
             </Button>
         </div>
         <p id="google-sheet-info" className="text-xs text-muted-foreground mt-1">
            Columnas: 1=Código, 2=Descripción, 6=Stock, 10=Proveedor. (Opcional Col 3=Vencimiento YYYY-MM-DD). Asegúrese que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.
         </p>
         {processingStatus && (
             <div className="mt-4 space-y-1">
                 <p className="text-sm text-muted-foreground text-center">
                     {processingStatus}
                 </p>
             </div>
         )}
         {isLoadingExternal && !processingStatus && (
              <div className="flex justify-center items-center py-6">
                 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                 <span className="ml-2 text-muted-foreground">Sincronizando catálogo desde la nube...</span>
              </div>
         )}
          <Button
                variant="destructive"
                onClick={onClearCatalogRequest} // Uses prop from parent
                disabled={isLoading || catalogProducts.length === 0}
                className="mt-4 w-full sm:w-auto"
                title="Eliminar todos los productos del catálogo (nube y local)"
            >
                 <Trash className="mr-2 h-4 w-4" /> Borrar Catálogo Completo
            </Button>
       </div>

       <ProductTable
           products={filteredProducts} // Use the filtered list based on catalogProducts prop
           isLoading={isLoadingExternal && !processingStatus} // Show loading if global load or local load without specific status
           onEdit={(product) => onEditProductRequest(product)}
           onDeleteRequest={(product) => {
             if (userId && product.barcode) {
                onDeleteLocalProduct(product.barcode); // Calls handler in page.tsx
             }
           }}
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
  onDeleteRequest
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
                   Cargando productos del catálogo...
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
                    title={isValidExp ? `Vence: ${format(expirationDateObj!, 'PP', {locale: es})}` : 'Sin fecha'}
                >
                  {isValidExp ? format(expirationDateObj!, 'dd/MM/yy', {locale: es}) : 'N/A'}
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(product)} className="text-blue-600 hover:text-blue-700 h-7 w-7" title="Editar Producto">
                        <Edit className="h-4 w-4"/>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDeleteRequest(product)} className="text-red-600 hover:text-red-700 h-7 w-7" title="Eliminar Producto">
                        <Trash className="h-4 w-4"/>
                    </Button>
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

// --- Google Sheet Data Fetching Logic ---
const extractSpreadsheetIdAndGid = (input: string): { spreadsheetId: string | null; gid: string } => {
    if (!input) return { spreadsheetId: null, gid: '0' };
  
    let spreadsheetId: string | null = null;
    const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/.*)?/;
    const idMatch = input.match(sheetUrlPattern);
  
    if (idMatch && idMatch[1]) {
        spreadsheetId = idMatch[1];
    } else if (!input.includes('/') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
        spreadsheetId = input;
    }
  
    const gidMatch = input.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
  
    return { spreadsheetId, gid };
  };
  
async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = extractSpreadsheetIdAndGid(sheetUrlOrId);
  
    if (!spreadsheetId) {
      console.warn("[fetchGoogleSheetData] Could not extract spreadsheet ID from input:", sheetUrlOrId);
      throw new Error("URL/ID de Hoja de Google inválido. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }
  
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
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
      console.error("[fetchGoogleSheetData] Network error:", error);
      throw new Error(userMessage);
    }
  
    if (!response.ok) {
      const status = response.status;
      const statusText = response.statusText;
      let errorBody = "No se pudo leer el cuerpo del error.";
      try { errorBody = await response.text(); } catch { /* no-op */ }
  
      let userMessage = `Error ${status} al obtener datos. `;
      if (status === 400) userMessage += "Solicitud incorrecta.";
      else if (status === 403) userMessage += "Acceso denegado. Asegúrese de que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.";
      else if (status === 404) userMessage += "Hoja no encontrada.";
      else userMessage += ` ${statusText}. Detalle: ${errorBody.substring(0, 200)}`;
      
      console.error("[fetchGoogleSheetData] Google Sheet fetch error details:", { status, statusText, errorBody, csvExportUrl });
      throw new Error(userMessage);
    }
  
    const csvText = await response.text();
  
    return new Promise((resolve, reject) => {
      if (typeof Papa === 'undefined') {
        console.error("[fetchGoogleSheetData] PapaParse (Papa) is not defined/loaded.");
        reject(new Error("La librería PapaParse (Papa) no está cargada."));
        return;
      }
  
      Papa.parse<string[]>(csvText, {
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
              results.errors.forEach(err => console.warn(`[fetchGoogleSheetData] PapaParse error: ${err.message} on row ${err.row}. Code: ${err.code}. Type: ${err.type}`));
          }
          const csvData = results.data;
          const products: ProductDetail[] = [];
  
          if (csvData.length <= 1) {
            resolve(products);
            return;
          }
          
          const BARCODE_COLUMN_INDEX = 0; // Columna 1
          const DESCRIPTION_COLUMN_INDEX = 1; // Columna 2
          const STOCK_COLUMN_INDEX = 5; // Columna 6
          const PROVIDER_COLUMN_INDEX = 9; // Columna 10
          const EXPIRATION_DATE_COLUMN_INDEX = 2; 
  
          for (let i = 1; i < csvData.length; i++) {
            const values = csvData[i];
            if (!values || values.length === 0 || values.every(v => !v?.trim())) continue;
  
            const barcode = values[BARCODE_COLUMN_INDEX]?.trim();
            if (!barcode) {
              console.warn(`[fetchGoogleSheetData] Fila ${i + 1} omitida: Código de barras vacío o faltante.`);
              continue;
            }
  
            const description = values[DESCRIPTION_COLUMN_INDEX]?.trim();
            const provider = values[PROVIDER_COLUMN_INDEX]?.trim();
            const stockStr = values[STOCK_COLUMN_INDEX]?.trim();
            const expirationDateStr = values[EXPIRATION_DATE_COLUMN_INDEX]?.trim();
  
            const finalDescription = description || `Producto ${barcode}`;
            const finalProvider = provider || "Desconocido";
  
            let stock = 0;
            if (stockStr) {
              const parsedStock = parseInt(stockStr, 10);
              if (!isNaN(parsedStock) && parsedStock >= 0) {
                stock = parsedStock;
              } else {
                console.warn(`[fetchGoogleSheetData] Valor de stock inválido "${stockStr}" para código ${barcode} en fila ${i + 1}. Usando 0.`);
              }
            }
            
            const expirationDate: string | null = (expirationDateStr && expirationDateStr.trim() !== "") ? expirationDateStr.trim() : null;
  
            products.push({ barcode, description: finalDescription, provider: finalProvider, stock, expirationDate });
          }
          resolve(products);
        },
        error: (error: any) => {
          console.error("[fetchGoogleSheetData] PapaParse CSV parsing error:", error);
          reject(new Error(`Error al analizar el archivo CSV desde Google Sheet: ${error.message}`));
        }
      });
    });
}
