
// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, debounce } from "@/lib/utils";
// Corrected import: Product catalog functions should come from database.ts (IndexedDB)
import {
  getAllProductsFromDB as getAllProductsFromIndexedDB,
  addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  deleteProductFromDB as deleteProductFromIndexedDB,
  addProductsToDB as addProductsToIndexedDB,
  clearProductDatabase as clearProductDatabaseInIndexedDB,
} from '@/lib/database'; // Using IndexedDB for product catalog

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
import { GOOGLE_SHEET_URL_LOCALSTORAGE_KEY, DEFAULT_WAREHOUSE_ID } from '@/lib/constants';
import { useLocalStorage } from '@/hooks/use-local-storage';


const CHUNK_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 300;

const extractSpreadsheetId = (input: string): string | null => {
  if (!input) return null;
  const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/edit|\/htmlview|\/pubhtml|\/export)?(?:[#?].*)?/;
  const match = input.match(sheetUrlPattern);
  if (match && match[1]) {
    return match[1];
  }
  if (!input.includes('/') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
    return input;
  }
  return null;
};

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


async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrlOrId);
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

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
        const errorBody = await response.text().catch(() => "Could not read error response body.");
        let userMessage = `Error ${status} al obtener datos. `;

        if (status === 400) userMessage += "Solicitud incorrecta. Verifique la URL y el GID de la hoja.";
        else if (status === 403) userMessage += "Acceso denegado. Asegúrese de que la hoja de cálculo tenga permisos de 'cualquiera con el enlace puede ver'.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL/ID y el ID de la hoja (gid).";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL/ID.`;

        console.error("Google Sheet fetch error details:", { status, statusText, errorBody, csvExportUrl });
        throw new Error(userMessage);
    }

    const csvText = await response.text();

    return new Promise((resolve, reject) => {
        if (typeof Papa === 'undefined') {
            reject(new Error("PapaParse (Papa) is not defined. Ensure it's correctly imported or loaded."));
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

                if (csvData.length <= 1) {
                    resolve(products);
                    return;
                }
                
                const BARCODE_COLUMN_INDEX = 0;
                const DESCRIPTION_COLUMN_INDEX = 1;
                const STOCK_COLUMN_INDEX = 5;
                const PROVIDER_COLUMN_INDEX = 9;
                const EXPIRATION_DATE_COLUMN_INDEX = 2;

                for (let i = 1; i < csvData.length; i++) {
                    const values = csvData[i];
                    if (!values || values.length === 0) continue;

                    const barcode = values[BARCODE_COLUMN_INDEX]?.trim();
                    const description = values[DESCRIPTION_COLUMN_INDEX]?.trim();
                    const stockStr = values[STOCK_COLUMN_INDEX]?.trim();
                    const provider = values[PROVIDER_COLUMN_INDEX]?.trim();
                    const expirationDateStr = values[EXPIRATION_DATE_COLUMN_INDEX]?.trim();

                    if (!barcode) { 
                        console.warn(`Fila ${i + 1} omitida: Código de barras vacío o faltante.`);
                        continue;
                    }

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
  userId: string | null; // Keep userId prop for potential future use or if interacting with user-specific local settings
  onStartCountByProvider: (products: ProductDetail[]) => void;
  isTransitionPending?: boolean;
  catalogProducts: ProductDetail[];
  setCatalogProducts: React.Dispatch<React.SetStateAction<ProductDetail[]>>;
  onClearCatalogRequest: () => void;
 }


const ProductDatabaseComponent: React.FC<ProductDatabaseProps> = ({
    userId, // May not be directly used if all data ops are purely local via IndexedDB now
    onStartCountByProvider,
    isTransitionPending,
    catalogProducts, // This prop is now the source of truth for display, managed by page.tsx
    setCatalogProducts, // This prop is used to update the catalog in page.tsx after local DB ops
    onClearCatalogRequest // Renamed to reflect it's a request
}) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false); 
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductDetail | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false); 
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [googleSheetUrlOrId, setGoogleSheetUrlOrId] = useLocalStorage<string>(
      GOOGLE_SHEET_URL_LOCALSTORAGE_KEY,
      ""
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const isMountedRef = useRef(false);
  // Removed showClearConfirm state as the dialog is now controlled by page.tsx

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load products from IndexedDB when component mounts
  useEffect(() => {
    if (!isMountedRef.current) return;
    setIsLoading(true);
    getAllProductsFromIndexedDB() // Use IndexedDB function
        .then(products => {
            if (isMountedRef.current) {
                setCatalogProducts(products.sort((a, b) => a.description.localeCompare(b.description)));
            }
        })
        .catch(error => {
            console.error("Failed to load catalog from IndexedDB:", error);
            if (isMountedRef.current) {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: "No se pudo cargar el catálogo local." }));
            }
        })
        .finally(() => {
            if (isMountedRef.current) {
                setIsLoading(false);
            }
        });
  }, [setCatalogProducts, toast]); // Removed userId as it's not needed for local DB ops here


  const handleGoogleSheetUrlOrIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrlOrId = e.target.value;
    setGoogleSheetUrlOrId(newUrlOrId);
  };


 const handleAddOrUpdateProductSubmit = useCallback(async (data: ProductDetail) => {
    const isUpdating = !!selectedProduct; 
    const productData: ProductDetail = {
        barcode: isUpdating ? selectedProduct!.barcode : data.barcode.trim(),
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
        stock: Number.isFinite(Number(data.stock)) ? Number(data.stock) : 0,
        expirationDate: (data.expirationDate && typeof data.expirationDate === 'string' && data.expirationDate.trim() !== "") 
                        ? data.expirationDate.trim() 
                        : null,
    };

    if (!productData.barcode) {
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." }));
        return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        await addOrUpdateProductToIndexedDB(productData); // Use IndexedDB function

        if (isMountedRef.current) {
            setCatalogProducts(prev => {
                const existingIndex = prev.findIndex(p => p.barcode === productData.barcode);
                if (existingIndex !== -1) {
                    const updatedCatalog = [...prev];
                    updatedCatalog[existingIndex] = productData;
                    return updatedCatalog;
                }
                return [...prev, productData].sort((a, b) => a.description.localeCompare(b.description));
            });
            requestAnimationFrame(() => toast({ title: isUpdating ? "Producto Actualizado" : "Producto Agregado" }));
            setIsEditModalOpen(false);
            setSelectedProduct(null);
        }
    } catch (error: any) {
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto localmente.`;
        if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Catálogo Local", description: errorMessage }));
        }
    } finally {
        if (isMountedRef.current) {
            setIsProcessing(false);
            setProcessingStatus("");
        }
    }
 }, [selectedProduct, toast, setCatalogProducts]);


  const handleDeleteProductRequest = useCallback((product: ProductDetail) => {
    // This function is now passed from page.tsx, which handles the confirmation dialog
    // For now, we can keep a local way to open the edit dialog with the product,
    // and the delete action can be initiated from there.
    // Or, ideally, page.tsx handles the dialog entirely.
    // For simplicity, let's assume page.tsx's deleteProductFromCatalog (passed via props)
    // handles the confirmation and then calls the actual DB delete.
    // This component's handleDeleteProductRequest will now just set the product for the dialog.
    setSelectedProduct(product);
    // The actual confirmation and deletion is handled by page.tsx's `handleDeleteProductFromCatalog`
    // which is triggered by the EditProductDialog's onDelete prop.
    // To open the dialog for editing/deleting:
    handleOpenEditDialog(product);
  }, []);

  // This function is now primarily for the EditProductDialog's onDelete prop
  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
    if (!barcode) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Interno", description: "Código de barras no disponible para eliminar." }));
        return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus("Eliminando producto...");
    try {
      await deleteProductFromIndexedDB(barcode); // Use IndexedDB function
      if (isMountedRef.current) {
          setCatalogProducts(prev => prev.filter(p => p.barcode !== barcode));
          requestAnimationFrame(() => toast({ title: "Producto Eliminado del Catálogo Local" }));
      }
    } catch (error: any) {
      if (isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar del catálogo local: ${error.message}` }));
      }
    } finally {
        if (isMountedRef.current) {
            setIsProcessing(false);
            setProcessingStatus("");
            setIsEditModalOpen(false); 
            setSelectedProduct(null);
        }
    }
  }, [toast, setCatalogProducts]);


  const handleOpenEditDialog = useCallback((product: ProductDetail | null) => {
    setSelectedProduct(product); 
    setIsEditModalOpen(true);
  }, []);


   const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrlOrId) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "URL/ID Requerido", description: "Introduce la URL de la hoja de Google o el ID." }));
            return;
        }
        if (!isMountedRef.current) return;
        setIsProcessing(true);
        setUploadProgress(0);
        setProcessingStatus("Obteniendo datos de Google Sheet...");

        try {
            const parsedProducts = await fetchGoogleSheetData(googleSheetUrlOrId);
             const totalItemsToLoad = parsedProducts.length;

             if (totalItemsToLoad === 0) {
                 if(isMountedRef.current) requestAnimationFrame(() => toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja.", variant: "default" }));
                 setIsProcessing(false);
                 setProcessingStatus("");
                 return;
             }
             if (isMountedRef.current) setProcessingStatus(`Cargando ${totalItemsToLoad} productos a catálogo local...`);

             await addProductsToIndexedDB(parsedProducts); // Use IndexedDB function

             if (isMountedRef.current) {
                const updatedCatalog = await getAllProductsFromIndexedDB(); // Use IndexedDB function
                setCatalogProducts(updatedCatalog.sort((a, b) => a.description.localeCompare(b.description)));
                setUploadProgress(100); 
                requestAnimationFrame(() => toast({ title: "Carga Completa", description: `Se procesaron y guardaron ${totalItemsToLoad} productos en el catálogo local.` }));
             }

        } catch (error: any) {
            if (isMountedRef.current) {
                setProcessingStatus("Error durante la carga.");
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet."}));
            }
        } finally {
            if (isMountedRef.current) {
                setIsProcessing(false);
                setProcessingStatus("");
            }
        }
    }, [googleSheetUrlOrId, toast, setCatalogProducts]);


  const handleExportDatabase = useCallback(() => {
     if (catalogProducts.length === 0) {
       requestAnimationFrame(() => toast({ title: "Catálogo Vacío", description: "No hay productos para exportar." }));
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
         if (typeof Papa === 'undefined') {
            throw new Error("PapaParse (Papa) no está cargado. No se puede exportar.");
         }
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
          requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Exportación", description: error.message || "No se pudo generar el archivo CSV." }));
     }
   }, [catalogProducts, toast]);


    const providerOptions = useMemo(() => {
        const providers = new Set(catalogProducts.map(p => p.provider || "Desconocido").filter(Boolean));
        // Convert set to array, add 'all', sort, and then ensure 'all' is at the beginning
        const sortedProviders = ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1;
            if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
        return sortedProviders;
    }, [catalogProducts]);


  const handleStartCountByProviderClick = useCallback(async () => {
    if (selectedProviderFilter === 'all') {
      requestAnimationFrame(() => toast({
        variant: "default",
        title: "Seleccionar Proveedor",
        description: "Por favor, selecciona un proveedor específico para iniciar el conteo.",
      }));
      return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus(`Buscando productos de ${selectedProviderFilter}...`);

    try {
      const providerProducts = catalogProducts.filter(product => (product.provider || "Desconocido") === selectedProviderFilter);

      if (providerProducts.length === 0) {
        if (isMountedRef.current) requestAnimationFrame(() => toast({ title: "Vacío", description: `No hay productos registrados para el proveedor ${selectedProviderFilter}.` }));
        setIsProcessing(false);
        setProcessingStatus("");
        return;
      }
      onStartCountByProvider(providerProducts); 
    } catch (error) {
      if (isMountedRef.current) requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "No se pudo iniciar el conteo por proveedor." }));
    } finally {
      if (isMountedRef.current) {
          setIsProcessing(false);
          setProcessingStatus("");
      }
    }
  }, [selectedProviderFilter, catalogProducts, onStartCountByProvider, toast]);


  const debouncedSetSearchTerm = useMemo(
    () => debounce((term: string) => {
        if(isMountedRef.current) setSearchTerm(term)
    }, SEARCH_DEBOUNCE_MS),
    [] // Empty dependency array means this is created once
  );

  useEffect(() => {
    return () => {
      debouncedSetSearchTerm.clear?.();
    };
  }, [debouncedSetSearchTerm]);


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
    }).sort((a, b) => {
        return a.description.localeCompare(b.description);
    });
  }, [catalogProducts, searchTerm, selectedProviderFilter]);

  // The actual confirmation dialog for clearing the catalog is now handled by page.tsx
  // So, handleConfirmClearCatalog is removed from here. onClearCatalogRequest prop will trigger it in parent.

  return (
    <div className="p-4 md:p-6 space-y-6">
       <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
         <div className="flex flex-wrap gap-2">
            <Select
              onValueChange={(value) => {
                if (value === "add") handleOpenEditDialog(null);
                else if (value === "export") handleExportDatabase();
                else if (value === "clear") onClearCatalogRequest(); // Call prop passed from page.tsx
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
                  <SelectItem value="add">
                    Agregar Producto
                  </SelectItem>
                  <SelectItem value="export" disabled={catalogProducts.length === 0}>
                    Exportar Catálogo (CSV)
                  </SelectItem>
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
                className="h-10 text-green-600 border-green-500 hover:bg-green-50 hover:text-green-700 dark:text-green-400 dark:border-green-600 dark:hover:bg-green-900/50 dark:hover:text-green-300"
                title={`Iniciar conteo para ${selectedProviderFilter === 'all' ? 'un proveedor' : selectedProviderFilter}`}
            >
                <Play className="mr-2 h-4 w-4" /> Contar Proveedor
            </Button>
         </div>
       </div>

       <div className="space-y-2 p-4 border rounded-lg bg-card dark:bg-card shadow-sm">
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
             <Button variant="secondary" disabled={isProcessing || isLoading || !googleSheetUrlOrId || isTransitionPending} onClick={handleLoadFromGoogleSheet}>
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
           onEdit={handleOpenEditDialog} // Keep this for opening the dialog
           onDeleteRequest={handleDeleteProductRequest} // Keep this for triggering delete process
       />

      <EditProductDialog
          isOpen={isEditModalOpen}
          setIsOpen={(open) => {
            setIsEditModalOpen(open);
            if (!open) setSelectedProduct(null); 
          }}
          selectedDetail={selectedProduct}
          setSelectedDetail={setSelectedProduct} 
          onSubmit={handleAddOrUpdateProductSubmit}
          onDelete={handleDeleteProduct} // This will be called by the dialog's delete button
          isProcessing={isProcessing || isTransitionPending}
          initialStock={selectedProduct?.stock} // Pass initial stock for context
          context="database" // Context is 'database' for catalog operations
       />
    </div>
  );
};

export const ProductDatabase = React.memo(ProductDatabaseComponent);


interface ProductTableProps {
  products: ProductDetail[];
  isLoading: boolean;
  onEdit: (product: ProductDetail) => void;
  onDeleteRequest: (product: ProductDetail) => void; // Keep to trigger delete flow
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
            <TableHead className="w-[40%] sm:w-[25%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Descripción</TableHead> {/* Adjusted width */}
            <TableHead className="w-[20%] sm:w-[20%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Proveedor</TableHead>
            <TableHead className="w-[10%] sm:w-[10%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Stock</TableHead>
            <TableHead className="w-[10%] sm:w-[15%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Vencimiento</TableHead> {/* Made always visible */}
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
                    className={cn("px-2 sm:px-4 py-3 text-center tabular-nums text-xs", // Always visible
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
                    <Button variant="ghost" size="icon" onClick={() => onDeleteRequest(product)} className="text-destructive hover:text-destructive/80 h-7 w-7" title="Eliminar Producto">
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
