// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, debounce } from "@/lib/utils";
import {
    Filter, Play, Loader2, Save, Trash, Upload, Edit, AlertTriangle, Plus
} from "lucide-react"; // Plus importado

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

// Las funciones de IndexedDB se manejan ahora en page.tsx
// import { getAllProductsFromDB as getAllProductsFromIndexedDB, ... } from '@/lib/database';

const SEARCH_DEBOUNCE_MS = 300;

 interface ProductDatabaseProps {
  userId: string | null; // Todavía necesario para cualquier lógica futura específica del usuario
  catalogProducts: ProductDetail[]; // Recibido de page.tsx, que ahora obtiene de IndexedDB
  isLoadingCatalog: boolean; // Indicador de carga específico para el catálogo
  processingStatus: string; // Para mensajes de estado
  setProcessingStatus: (status: string) => void; // Para actualizar mensajes de estado
  
  onLoadFromGoogleSheet: (sheetUrlOrId: string) => Promise<void>; // Llamado desde page.tsx
  onAddOrUpdateProduct: (product: ProductDetail) => Promise<void>; // Llamado desde page.tsx
  onDeleteProduct: (barcode: string) => Promise<void>; // Llamado desde page.tsx
  onClearCatalogRequest: () => void; // Para abrir diálogo de confirmación en page.tsx
  onStartCountByProvider: (products: ProductDetail[]) => void; // Llamado desde page.tsx
  onEditProductRequest: (product: ProductDetail) => void; // Para abrir diálogo de edición en page.tsx
 }


const ProductDatabaseComponent: React.FC<ProductDatabaseProps> = ({
    userId,
    catalogProducts, // Lista de productos del catálogo (desde IndexedDB vía page.tsx)
    isLoadingCatalog, // Indicador de si el catálogo se está cargando/sincronizando
    processingStatus,
    setProcessingStatus, // Aún se usa para el estado de carga de GS
    onLoadFromGoogleSheet,
    onAddOrUpdateProduct, // Se conecta con handleAddOrUpdateCatalogProduct en page.tsx
    onDeleteProduct,      // Se conecta con handleDeleteCatalogProduct en page.tsx
    onClearCatalogRequest,
    onStartCountByProvider,
    onEditProductRequest
 }) => {
  const { toast } = useToast();
  // isLoadingLocal ya no es necesario, se usa isLoadingCatalog de props
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

  // Ya no hay carga directa de productos aquí, se reciben como prop 'catalogProducts'
  // useEffect(() => {
  //   if (userId) {
  //     loadLocalCatalog(); // Esta función ahora está en page.tsx como synchronizeAndLoadCatalog
  //   }
  // }, [userId, loadLocalCatalog]);

  const handleGoogleSheetUrlOrIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGoogleSheetUrlOrId(e.target.value);
  };

  const handleLoadFromGoogleSheetClick = async () => {
    if (!googleSheetUrlOrId) {
      requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido" }));
      return;
    }
    // Llama a la función pasada por props, que ahora está en page.tsx
    // y maneja la lógica de fetchGoogleSheetData y la actualización de IndexedDB
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
    return catalogProducts
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
      // El ordenamiento ahora se hace en page.tsx antes de pasar catalogProducts
  }, [catalogProducts, searchTerm, selectedProviderFilter]);

  const isLoading = isLoadingCatalog || (processingStatus !== ""); // Considerar ambos

  const handleAddNewProductClick = () => {
    // Llama a la prop que abre EditProductDialog en page.tsx
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
            Columnas: 1=Código, 2=Descripción, 3=Vencimiento (YYYY-MM-DD opcional), 6=Stock, 10=Proveedor. Asegúrese que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.
         </p>
         {processingStatus && (
             <div className="mt-4 space-y-1">
                 <p className="text-sm text-muted-foreground text-center">
                     {processingStatus}
                 </p>
             </div>
         )}
         {isLoadingCatalog && !processingStatus && ( // Usar isLoadingCatalog aquí
              <div className="flex justify-center items-center py-6">
                 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                 <span className="ml-2 text-muted-foreground">Cargando catálogo...</span>
              </div>
         )}
          <Button
                variant="destructive"
                onClick={onClearCatalogRequest} 
                disabled={isLoading || catalogProducts.length === 0}
                className="mt-4 w-full sm:w-auto"
                title="Eliminar todos los productos del catálogo local (IndexedDB)"
            >
                 <Trash className="mr-2 h-4 w-4" /> Borrar Catálogo Completo
            </Button>
       </div>

       <ProductTable
           products={filteredProducts}
           isLoading={isLoadingCatalog && !processingStatus} // isLoadingCatalog para la tabla
           onEdit={(product) => onEditProductRequest(product)} // Llama a la prop de page.tsx
           onDeleteRequest={(product) => {
             if (userId && product.barcode) {
                onDeleteProduct(product.barcode); // Llama a la prop de page.tsx
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
        <TableCaption>Productos en el catálogo local (IndexedDB). Click en la descripción para editar.</TableCaption>
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

// La lógica de fetchGoogleSheetData y extractSpreadsheetIdAndGid ahora reside en page.tsx
// o en un archivo de utilidades, y se llama desde page.tsx.
// ProductDatabaseComponent solo invoca la prop onLoadFromGoogleSheet.

