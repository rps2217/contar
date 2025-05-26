
// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, debounce } from "@/lib/utils";
import {
    Filter, Play, Loader2, Save, Trash, Upload, Edit, AlertTriangle
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
import {
    getAllProductsFromDB as getAllProductsFromIndexedDB, // Renamed for clarity
    // addOrUpdateProductToDB as addOrUpdateProductToIndexedDB, // No longer directly called from here
    // deleteProductFromDB as deleteProductFromIndexedDB, // No longer directly called from here
    // addProductsToDB as addProductsToIndexedDB, // No longer directly called from here
    // clearProductDatabase as clearProductDatabaseInIndexedDB // No longer directly called from here
} from '@/lib/database';


const SEARCH_DEBOUNCE_MS = 300;

 interface ProductDatabaseProps {
  userId: string | null; // Keep for future use if needed for user-specific catalogs
  isLoadingExternal?: boolean; // For loading state controlled by parent (e.g., Firestore sync)
  onProductUpdate: () => Promise<void>; // Callback to inform parent that catalog changed
  onLoadFromGoogleSheet: (sheetUrlOrId: string) => Promise<void>; // Callback to parent
  onStartCountByProvider: (products: ProductDetail[]) => void;
  processingStatus?: string;
  setProcessingStatus: (status: string) => void; // Allow parent to manage this
  onEditProductRequest: (product: ProductDetail | null) => void; // To open edit dialog in parent
 }


const ProductDatabaseComponent: React.FC<ProductDatabaseProps> = ({
    userId,
    isLoadingExternal = false,
    onProductUpdate,
    onLoadFromGoogleSheet,
    onStartCountByProvider,
    processingStatus,
    setProcessingStatus,
    onEditProductRequest
 }) => {
  const { toast } = useToast();
  const [isLoadingLocal, setIsLoadingLocal] = useState(false); // For local operations like initial load
  const [localCatalogProducts, setLocalCatalogProducts] = useState<ProductDetail[]>([]);
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

  const loadLocalCatalog = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsLoadingLocal(true);
    setProcessingStatus("Cargando catálogo desde base local...");
    try {
      const products = await getAllProductsFromIndexedDB();
      if (isMountedRef.current) {
        setLocalCatalogProducts(products);
        setProcessingStatus("Catálogo local cargado.");
      }
    } catch (error: any) {
      if (isMountedRef.current) {
        toast({ variant: "destructive", title: "Error Catálogo Local", description: error.message });
        setProcessingStatus(`Error: ${error.message}`);
      }
    } finally {
      if (isMountedRef.current) setIsLoadingLocal(false);
    }
  }, [toast, setProcessingStatus]);

  useEffect(() => {
    loadLocalCatalog();
  }, [loadLocalCatalog]);


  const handleGoogleSheetUrlOrIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGoogleSheetUrlOrId(e.target.value);
  };

  const handleLoadFromGoogleSheetClick = async () => {
    if (!googleSheetUrlOrId) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido" }));
      return;
    }
    await onLoadFromGoogleSheet(googleSheetUrlOrId);
    // Parent will call onProductUpdate which should trigger a reload if necessary
  };

  const providerOptions = useMemo(() => {
        const providers = new Set(localCatalogProducts.map(p => p.provider || "Desconocido").filter(Boolean));
        const sortedProviders = ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1; if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
        return sortedProviders;
    }, [localCatalogProducts]);

  const handleStartCountByProviderClick = useCallback(async () => {
    if (selectedProviderFilter === 'all') {
      requestAnimationFrame(() => toast({ title: "Seleccionar Proveedor" }));
      return;
    }
    if (!isMountedRef.current) return;
    const providerProducts = localCatalogProducts.filter(product => (product.provider || "Desconocido") === selectedProviderFilter);
    if (providerProducts.length === 0) {
      if (isMountedRef.current) requestAnimationFrame(() => toast({ title: "Vacío", description: `No hay productos para ${selectedProviderFilter}.` }));
    } else {
      onStartCountByProvider(providerProducts); 
    }
  }, [selectedProviderFilter, localCatalogProducts, onStartCountByProvider, toast]);

  const debouncedSetSearchTerm = useMemo(
    () => debounce((term: string) => { if(isMountedRef.current) setSearchTerm(term) }, SEARCH_DEBOUNCE_MS),
    [] 
  );
  useEffect(() => () => debouncedSetSearchTerm.clear?.(), [debouncedSetSearchTerm]);

  const filteredProducts = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return localCatalogProducts
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
      .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
  }, [localCatalogProducts, searchTerm, selectedProviderFilter]);

  //isLoading combines external and local loading states
  const isLoading = isLoadingExternal || isLoadingLocal;


  return (
    <div className="p-4 md:p-6 space-y-6">
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
            <Button
                onClick={() => onEditProductRequest(null)} // Pass null for new product
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
              Cargar/Actualizar Catálogo desde Google Sheet (a base local):
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
            Columnas: 1=Código, 2=Descripción, 3=Vencimiento(Opcional), 6=Stock, 10=Proveedor. Asegúrese que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.
         </p>
         {processingStatus && (
             <div className="mt-4 space-y-1">
                 <p className="text-sm text-muted-foreground text-center">
                     {processingStatus}
                 </p>
             </div>
         )}
         {isLoading && !processingStatus && ( 
              <div className="flex justify-center items-center py-6">
                 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                 <span className="ml-2 text-muted-foreground">Cargando catálogo de productos...</span>
              </div>
         )}
       </div>

       <ProductTable
           products={filteredProducts}
           isLoading={isLoading && !processingStatus} // Show loading if global load or local load without specific status
           onEdit={(product) => onEditProductRequest(product)} 
           // Delete action will be handled by parent via onProductUpdate after successful deletion
       />
    </div>
  );
};

export const ProductDatabase = React.memo(ProductDatabaseComponent);


interface ProductTableProps {
  products: ProductDetail[];
  isLoading: boolean;
  onEdit: (product: ProductDetail) => void;
  // onDeleteRequest is removed, parent will handle deletion and then trigger onProductUpdate
}

const ProductTable: React.FC<ProductTableProps> = React.memo(({
  products,
  isLoading,
  onEdit,
}) => {
  return (
    <ScrollArea className="h-[calc(100vh-500px)] md:h-[calc(100vh-450px)] border rounded-lg shadow-sm bg-card dark:bg-card">
      <Table>
        <TableCaption>Productos en el catálogo local. Click en la descripción para editar.</TableCaption>
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
                    title={isValidExp ? `Vence: ${format(expirationDateObj!, 'PP', {locale: es})}` : 'Sin fecha'}
                >
                  {isValidExp ? format(expirationDateObj!, 'dd/MM/yy', {locale: es}) : 'N/A'}
                </TableCell>
                <TableCell className="px-2 sm:px-4 py-3 text-center">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(product)} className="text-blue-600 hover:text-blue-700 h-7 w-7" title="Editar Producto">
                        <Edit className="h-4 w-4"/>
                    </Button>
                    {/* El botón de eliminar aquí ya no es necesario si la edición abre un diálogo con opción de eliminar */}
                    {/* O si la eliminación se maneja completamente a través del diálogo de edición. */}
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
    