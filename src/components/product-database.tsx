
// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, debounce } from "@/lib/utils";
import {
    Filter, Play, Loader2, Save, Trash, Upload, Edit, AlertTriangle, Plus, X, PackageSearch, FileSpreadsheet, BookOpenText
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
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

import { format, parseISO, isValid as isValidDate } from 'date-fns';
import { es } from 'date-fns/locale';
import { GOOGLE_SHEET_URL_LOCALSTORAGE_KEY } from '@/lib/constants';
import { useLocalStorage } from '@/hooks/use-local-storage';


const SEARCH_DEBOUNCE_MS = 300;

 interface ProductDatabaseProps {
  userId: string | null;
  catalogProducts: ProductDetail[];
  isLoadingCatalog: boolean;
  processingStatus: string; // For Google Sheet load status primarily
  googleSheetUrl: string;
  setGoogleSheetUrl: (url: string) => void; // For useLocalStorage hook in parent

  onLoadFromGoogleSheet: (sheetUrlOrId: string) => Promise<void>;
  onAddOrUpdateProduct: (product: ProductDetail) => Promise<void>;
  onDeleteProductRequest: (barcode: string) => void;
  onClearCatalogRequest: () => void;
  onStartCountByProvider: (products: ProductDetail[]) => void;
  onEditProductRequest: (product: ProductDetail) => void;
 }


const ProductDatabaseComponent: React.FC<ProductDatabaseProps> = ({
    userId,
    catalogProducts = [], // Default to empty array
    isLoadingCatalog: parentIsLoadingCatalog, // Prop for general catalog loading from parent
    processingStatus: parentProcessingStatus,  // Prop for specific processing status (e.g. GS load)
    googleSheetUrl, // This comes from useLocalStorage in parent
    setGoogleSheetUrl, // This updates the useLocalStorage in parent
    onLoadFromGoogleSheet,
    onAddOrUpdateProduct, // This will now call a handler in page.tsx that interacts with Firestore
    onDeleteProductRequest,
    onClearCatalogRequest,
    onStartCountByProvider,
    onEditProductRequest
 }) => {
  const { toast } = useToast();
  // localGoogleSheetUrl is for the input field, to avoid updating localStorage on every keystroke
  const [localGoogleSheetUrl, setLocalGoogleSheetUrl] = useState(googleSheetUrl);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Sync localGoogleSheetUrl if the prop from useLocalStorage changes
  useEffect(() => {
    if (googleSheetUrl !== localGoogleSheetUrl) {
      setLocalGoogleSheetUrl(googleSheetUrl);
    }
  }, [googleSheetUrl, localGoogleSheetUrl]);


  const handleLoadFromGoogleSheetClick = async () => {
    if (!localGoogleSheetUrl.trim()) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido", description: "Por favor, ingrese la URL o ID de la Hoja de Google." }));
      return;
    }
    // Call the handler from page.tsx, which now contains the full logic
    // including fetchGoogleSheetData, saving to Firestore, and updating IndexedDB cache
    await onLoadFromGoogleSheet(localGoogleSheetUrl.trim());
    // setGoogleSheetUrl(localGoogleSheetUrl.trim()); // This will be called by parent on success via useLocalStorage
  };

  const providerOptions = useMemo(() => {
        const providers = new Set((catalogProducts || []).map(p => p.provider || "Desconocido").filter(Boolean));
        const sortedProviders = ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1; if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
        return sortedProviders;
    }, [catalogProducts]);

  const handleStartCountByProviderClick = useCallback(async () => {
    if (selectedProviderFilter === 'all') {
      requestAnimationFrame(() => toast({ title: "Seleccionar Proveedor", description:"Debe seleccionar un proveedor para iniciar el conteo." }));
      return;
    }
    if (!isMountedRef.current) return;
    const providerProducts = (catalogProducts || []).filter(product => (product.provider || "Desconocido") === selectedProviderFilter);
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
    return (catalogProducts || []) // Ensure catalogProducts is an array
      .filter(product => {
        if (!product || !product.barcode) return false; // Basic check for valid product object
        const matchesSearch = !lowerSearchTerm ||
                              (product.description || '').toLowerCase().includes(lowerSearchTerm) ||
                              product.barcode.includes(lowerSearchTerm) ||
                              (product.provider || '').toLowerCase().includes(lowerSearchTerm) ||
                              (product.expirationDate && isValidDate(parseISO(product.expirationDate)) && format(parseISO(product.expirationDate), 'dd/MM/yy', {locale: es}).includes(lowerSearchTerm));
        const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;
        return matchesSearch && matchesProvider;
      })
  }, [catalogProducts, searchTerm, selectedProviderFilter]);

  // isLoading combines the general catalog loading state from parent and any specific processing status
  const isLoading = parentIsLoadingCatalog || (parentProcessingStatus !== "" && parentProcessingStatus !== "Catálogo local cargado." && parentProcessingStatus !== "Catálogo local vacío.");

  const handleAddNewProductClick = () => {
    onEditProductRequest({ barcode: '', description: '', provider: '', stock: 0, expirationDate: null });
  };


  return (
    <div className="p-4 md:p-6 space-y-6 h-full flex flex-col">
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

       <Card className="shadow-md rounded-lg bg-card border border-border">
           <CardHeader>
             <CardTitle className="text-lg flex items-center">
                <FileSpreadsheet className="mr-2 h-5 w-5 text-primary" />
                Cargar/Actualizar Catálogo desde Google Sheet
             </CardTitle>
             <CardDescription>
                Pega la URL completa de tu Hoja de Google o su ID. Asegúrate que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.
                La carga actualizará tu catálogo local (IndexedDB).
             </CardDescription>
           </CardHeader>
           <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Label htmlFor="google-sheet-url" className="sr-only">URL de Hoja de Google</Label>
                <Input
                    id="google-sheet-url"
                    type="text"
                    placeholder="URL completa o ID de Hoja de Google"
                    value={localGoogleSheetUrl} // Usa el estado local
                    onChange={(e) => setLocalGoogleSheetUrl(e.target.value)}
                    className="flex-grow h-10 bg-background"
                    aria-describedby="google-sheet-info"
                    disabled={isLoading && parentProcessingStatus.includes("Google Sheet")} // Deshabilitar solo si la carga de GS está en curso
                />
                <Button
                    variant="secondary"
                    disabled={isLoading || !localGoogleSheetUrl.trim()}
                    onClick={handleLoadFromGoogleSheetClick}
                    className="h-10"
                >
                    {(isLoading && parentProcessingStatus.includes("Google Sheet")) ?
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> :
                      <Upload className="mr-2 h-4 w-4" />
                    }
                    {(isLoading && parentProcessingStatus.includes("Google Sheet")) ? 'Cargando...' : 'Cargar Datos'}
                </Button>
            </div>
            <p id="google-sheet-info" className="text-xs text-muted-foreground mt-1">
                Columnas: 1=Código, 2=Descripción, 3=Vencimiento(Opcional YYYY-MM-DD), 6=Stock, 10=Proveedor.
            </p>
            </CardContent>
            <CardFooter className="flex flex-col items-start space-y-2">
                {parentProcessingStatus && parentProcessingStatus !== "Catálogo local cargado." && parentProcessingStatus !== "Catálogo local vacío." && (
                    <div className="w-full text-center p-2 bg-muted/50 rounded-md">
                        <p className="text-sm text-muted-foreground">
                            {parentProcessingStatus}
                        </p>
                    </div>
                )}
                 <Button
                    variant="destructive"
                    onClick={onClearCatalogRequest} // Esto llama a la función en page.tsx
                    disabled={isLoading || (catalogProducts || []).length === 0}
                    className="w-full sm:w-auto"
                    title="Eliminar todos los productos del catálogo local (IndexedDB)"
                >
                    <Trash className="mr-2 h-4 w-4" /> Borrar Catálogo Completo
                </Button>
            </CardFooter>
       </Card>


       <ProductTable
           products={filteredProducts}
           isLoading={parentIsLoadingCatalog && !parentProcessingStatus} // Mostrar carga solo si el catálogo general se está cargando
           onEdit={onEditProductRequest}
           onDeleteRequest={(productBarcode) => { // onDeleteRequest en ProductTable espera barcode
             if (userId && productBarcode) {
                onDeleteProductRequest(productBarcode); // Llama a la función en page.tsx
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
  onDeleteRequest: (barcode: string) => void;
}

const ProductTable: React.FC<ProductTableProps> = React.memo(({
  products,
  isLoading,
  onEdit,
  onDeleteRequest
}) => {
  return (
    <ScrollArea className="flex-1 border rounded-lg shadow-sm bg-card dark:bg-card">
      <Table>
        <TableCaption>Productos en el catálogo local (IndexedDB). Click en la descripción para editar.</TableCaption>
        <TableHeader className="sticky top-0 bg-muted/50 z-10 shadow-sm">
          <TableRow>
            <TableHead className="w-[20%] sm:w-[15%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Código Barras</TableHead>
            <TableHead className="w-[30%] sm:w-[25%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Descripción</TableHead>
            <TableHead className="w-[20%] sm:w-[20%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider hidden md:table-cell">Proveedor</TableHead>
            <TableHead className="w-[10%] sm:w-[10%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Stock</TableHead>
            <TableHead className="w-[10%] sm:w-[15%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider hidden md:table-cell">Vencimiento</TableHead>
            <TableHead className="w-[10%] sm:w-[15%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                <div className="flex justify-center items-center">
                   <Loader2 className="h-6 w-6 animate-spin mr-2" />
                   Cargando productos del catálogo...
                </div>
              </TableCell>
            </TableRow>
          ) : products.length === 0 ? (
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
                 <TableCell className="px-2 sm:px-4 py-3 hidden md:table-cell">{product.provider || 'N/A'}</TableCell>
                <TableCell className="px-2 sm:px-4 py-3 text-center tabular-nums">
                  {product.stock ?? 0}
                </TableCell>
                <TableCell
                    className={cn("px-2 sm:px-4 py-3 text-center tabular-nums text-xs hidden md:table-cell",
                        isValidExp && expirationDateObj && new Date() > expirationDateObj ? 'text-red-500 font-semibold' : ''
                    )}
                    title={isValidExp && expirationDateObj ? `Vence: ${format(expirationDateObj, 'PP', {locale: es})}` : 'Sin fecha'}
                >
                  {isValidExp && expirationDateObj ? format(expirationDateObj, 'dd/MM/yy', {locale: es}) : 'N/A'}
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(product)} className="text-blue-600 hover:text-blue-700 h-7 w-7" title="Editar Producto">
                        <Edit className="h-4 w-4"/>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDeleteRequest(product.barcode)} className="text-red-600 hover:text-red-700 h-7 w-7" title="Eliminar Producto">
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

// Helper functions (previously in this file, now assumed to be in page.tsx or a utility file)
// Moved fetchGoogleSheetData and extractSpreadsheetIdAndGid to page.tsx
// to centralize data fetching and state management logic.
// Ensure Papa is imported in page.tsx if fetchGoogleSheetData is moved there.
