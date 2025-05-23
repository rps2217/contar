
// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, debounce } from "@/lib/utils";
import {
  // Functions for IndexedDB (local catalog) - these might be phased out if all moves to Firestore
  // getProductFromDB as getProductFromIndexedDB,
  // getAllProductsFromDB as getAllProductsFromIndexedDB,
  // addOrUpdateProductToDB as addOrUpdateProductToIndexedDB,
  // deleteProductFromDB as deleteProductFromIndexedDB,
  // clearProductDatabase as clearProductDatabaseFromDB,
  // addProductsToDB as addProductsToIndexedDB,
} from '@/lib/database'; // Assuming these are still used for local fallback or specific features
import {
  // Functions for Firestore (cloud catalog)
  getAllProductsFromCatalog, 
  addOrUpdateProductInCatalog,
  deleteProductFromCatalog,
  addProductsToCatalog,
  clearProductCatalogInFirestore,
} from '@/lib/firestore-service'; 

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


const CHUNK_SIZE = 200; // For processing large CSVs
const SEARCH_DEBOUNCE_MS = 300;


const extractSpreadsheetId = (input: string): string | null => {
  if (!input) return null;
  // Regex to capture spreadsheet ID from various Google Sheets URL formats
  const sheetUrlPattern = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)(?:\/edit|\/htmlview|\/pubhtml|\/export)?(?:[#?].*)?/;
  const match = input.match(sheetUrlPattern);
  if (match && match[1]) {
    return match[1];
  }
  // Fallback for just an ID string (less reliable, but a common user input)
  // A typical Google Sheet ID is 44 characters long and contains letters, numbers, hyphens, and underscores.
  if (!input.includes('/') && input.length > 30 && input.length < 50 && /^[a-zA-Z0-9-_]+$/.test(input)) {
    return input;
  }
  return null;
};

const parseGoogleSheetUrl = (sheetUrlOrId: string): { spreadsheetId: string | null; gid: string } => {
    const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
    const gidMatch = sheetUrlOrId.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0'; // Default to first sheet if gid is not specified

    if (!spreadsheetId) {
         console.warn("Could not extract spreadsheet ID from input:", sheetUrlOrId);
         // This error should ideally be shown to the user in the UI as well
         throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL/ID proporcionado. Asegúrate de que la URL sea válida o que el ID sea correcto.");
    }
    return { spreadsheetId, gid };
};


async function fetchGoogleSheetData(sheetUrlOrId: string): Promise<ProductDetail[]> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrlOrId);
    // Construct the CSV export URL
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

    let response: Response;
    try {
        // Append a cache-busting query parameter
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" }); // Disable caching
    } catch (error: any) {
        // Handle network errors (e.g., no internet, DNS failure)
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL/ID.";
        if (error.message?.includes('Failed to fetch')) { // More specific error checking if possible
            userMessage += " Posible problema de CORS, conectividad, o la URL/ID es incorrecta. Asegúrese de que la hoja tenga permisos de 'cualquiera con el enlace puede ver'.";
        } else {
            userMessage += ` Detalle: ${error.message}`;
        }
        throw new Error(userMessage);
    }

    if (!response.ok) {
        // Handle HTTP errors (e.g., 403 Forbidden, 404 Not Found)
        const status = response.status;
        const statusText = response.statusText;
        // Attempt to read error body for more details, but don't let it fail the whole process
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

    // Promisify Papa.parse for async/await usage
    return new Promise((resolve, reject) => {
        if (typeof Papa === 'undefined') {
            reject(new Error("PapaParse (Papa) is not defined. Ensure it's correctly imported or loaded."));
            return;
        }

        Papa.parse<string[]>(csvText, {
            skipEmptyLines: true,
            complete: (results) => {
                if (results.errors.length > 0) {
                     // Log errors but attempt to process valid data
                     results.errors.forEach(err => console.warn(`PapaParse error: ${err.message} on row ${err.row}. Code: ${err.code}. Type: ${err.type}`));
                }
                const csvData = results.data;
                const products: ProductDetail[] = [];

                if (csvData.length <= 1) { // No data rows beyond header
                    resolve(products); // Resolve with empty array if no data
                    return;
                }
                
                // Col 1 (index 0): barcode
                // Col 2 (index 1): description
                // Col 6 (index 5): stock
                // Col 10 (index 9): provider
                // New: Expiration Date (e.g., Col 3, index 2)
                const BARCODE_COLUMN_INDEX = 0;
                const DESCRIPTION_COLUMN_INDEX = 1;
                const STOCK_COLUMN_INDEX = 5;
                const PROVIDER_COLUMN_INDEX = 9;
                // ! IMPORTANT: Adjust this index to match your actual CSV column for expiration dates !
                const EXPIRATION_DATE_COLUMN_INDEX = 2; // Example, adjust this!


                // Skip header row (index 0)
                for (let i = 1; i < csvData.length; i++) {
                    const values = csvData[i];
                    if (!values || values.length === 0) continue; // Skip empty rows

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
            error: (error: any) => { // Catch parsing errors
                reject(new Error(`Error al analizar el archivo CSV: ${error.message}`));
            }
        });
    });
}


 interface ProductDatabaseProps {
  userId: string | null;
  onStartCountByProvider: (products: ProductDetail[]) => void;
  isTransitionPending?: boolean;
  catalogProducts: ProductDetail[];
  setCatalogProducts: React.Dispatch<React.SetStateAction<ProductDetail[]>>;
  onClearCatalogRequest: () => void;
 }


const ProductDatabaseComponent: React.FC<ProductDatabaseProps> = ({
    userId,
    onStartCountByProvider,
    isTransitionPending,
    catalogProducts,
    setCatalogProducts,
    onClearCatalogRequest
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);


  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load products from Firestore when component mounts or userId changes
  useEffect(() => {
    if (!userId) {
        if (isMountedRef.current) {
            setCatalogProducts([]);
            setIsLoading(false);
        }
        return;
    }
    if (!isMountedRef.current) return;
    setIsLoading(true);
    getAllProductsFromCatalog(userId)
        .then(products => {
            if (isMountedRef.current) {
                setCatalogProducts(products);
            }
        })
        .catch(error => {
            console.error("Failed to load catalog from Firestore:", error);
            if (isMountedRef.current) {
                requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Catálogo", description: "No se pudo cargar el catálogo de Firestore." }));
            }
        })
        .finally(() => {
            if (isMountedRef.current) {
                setIsLoading(false);
            }
        });
  }, [userId, setCatalogProducts, toast]);


  const handleGoogleSheetUrlOrIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrlOrId = e.target.value;
    setGoogleSheetUrlOrId(newUrlOrId);
  };


 const handleAddOrUpdateProductSubmit = useCallback(async (data: ProductDetail) => {
    if (!userId) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "ID de usuario no disponible." }));
        return;
    }
    const isUpdating = !!selectedProduct; 
    const productData: ProductDetail = {
        barcode: isUpdating ? selectedProduct!.barcode : data.barcode.trim(),
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
        stock: Number.isFinite(Number(data.stock)) ? Number(data.stock) : 0,
        expirationDate: data.expirationDate || null,
    };

    if (!productData.barcode) {
         requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." }));
        return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        await addOrUpdateProductInCatalog(userId, productData);

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
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        if (isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error de Catálogo", description: errorMessage }));
        }
    } finally {
        if (isMountedRef.current) {
            setIsProcessing(false);
            setProcessingStatus("");
        }
    }
 }, [userId, selectedProduct, toast, setCatalogProducts]);


  const handleDeleteProductRequest = useCallback((product: ProductDetail) => {
    if (!product) return;
    setSelectedProduct(product); 
    setShowClearConfirm(true); 
  }, []);

  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
    if (!userId || !barcode) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error Interno", description: "ID de usuario o código de barras no disponible." }));
        return;
    }
    const productDesc = catalogProducts.find(p => p.barcode === barcode)?.description || barcode;
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus("Eliminando producto...");
    try {
      await deleteProductFromCatalog(userId, barcode);
      if (isMountedRef.current) {
          setCatalogProducts(prev => prev.filter(p => p.barcode !== barcode));
          requestAnimationFrame(() => toast({
            title: "Producto Eliminado",
          }));
      }
    } catch (error: any) {
      if (isMountedRef.current) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar del catálogo: ${error.message}` }));
      }
    } finally {
        if (isMountedRef.current) {
            setIsProcessing(false);
            setProcessingStatus("");
            setIsEditModalOpen(false); 
            setSelectedProduct(null);
        }
    }
  }, [userId, catalogProducts, toast, setCatalogProducts]);


  const handleOpenEditDialog = useCallback((product: ProductDetail | null) => {
    setSelectedProduct(product); 
    setIsEditModalOpen(true);
  }, []);


   const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!userId) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "ID de usuario no disponible." }));
            return;
        }
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
             if (isMountedRef.current) setProcessingStatus(`Cargando ${totalItemsToLoad} productos a Firestore...`);

             await addProductsToCatalog(userId, parsedProducts); 

             
             if (isMountedRef.current) {
                const updatedCatalog = await getAllProductsFromCatalog(userId); 
                setCatalogProducts(updatedCatalog.sort((a, b) => a.description.localeCompare(b.description)));
                setUploadProgress(100); 
                requestAnimationFrame(() => toast({ title: "Carga Completa", description: `Se procesaron y guardaron ${totalItemsToLoad} productos en Firestore.` }));
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
    }, [userId, googleSheetUrlOrId, toast, setCatalogProducts]);


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
    []
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
                            (product.expirationDate && format(parseISO(product.expirationDate), 'dd/MM/yy', {locale: es}).includes(lowerSearchTerm));


      const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;

      return matchesSearch && matchesProvider;
    }).sort((a, b) => {
        
        return a.description.localeCompare(b.description);
    });
  }, [catalogProducts, searchTerm, selectedProviderFilter]);

 const handleConfirmClearCatalog = async () => {
    if (!userId) {
        requestAnimationFrame(() => toast({ variant: "destructive", title: "Error", description: "ID de usuario no disponible." }));
        setShowClearConfirm(false);
        return;
    }
    if (!isMountedRef.current) {
        setShowClearConfirm(false);
        return;
    }
    setIsProcessing(true);
    setProcessingStatus("Borrando catálogo...");
    try {
        await clearProductCatalogInFirestore(userId);
        if(isMountedRef.current) {
            setCatalogProducts([]); 
            requestAnimationFrame(() => toast({ title: "Catálogo Borrado" }));
        }
    } catch (error: any) {
        if(isMountedRef.current) {
            requestAnimationFrame(() => toast({ variant: "destructive", title: "Error al Borrar", description: `No se pudo borrar el catálogo: ${error.message}`}));
        }
    } finally {
        if(isMountedRef.current) {
            setIsProcessing(false);
            setProcessingStatus("");
            setShowClearConfirm(false);
        }
    }
 };


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
             La hoja debe tener permisos de 'cualquiera con el enlace puede ver'. Se espera: Col 1: Código, Col 2: Descripción, Col 6: Stock, Col 10: Proveedor. Col 3 para Fecha de Vencimiento (opcional, YYYY-MM-DD).
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
           onDeleteRequest={handleDeleteProductRequest}
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
          onDelete={handleDeleteProduct} 
          isProcessing={isProcessing || isTransitionPending}
          initialStock={selectedProduct?.stock}
          context="database"
       />

       <ConfirmationDialog
            isOpen={showClearConfirm}
            onOpenChange={(open) => {
                setShowClearConfirm(open);
                if (!open) setSelectedProduct(null); 
            }}
            title={selectedProduct ? "Confirmar Eliminación Producto" : "Confirmar Borrado Catálogo Completo"}
            description={
                selectedProduct ?
                `¿Seguro que deseas eliminar el producto "${selectedProduct.description}" (${selectedProduct.barcode}) del catálogo? Esta acción no se puede deshacer.` :
                (
                 <div className="space-y-2">
                    <div className="flex items-center gap-2 text-destructive">
                         <AlertTriangle className="h-5 w-5"/>
                         <span className="font-semibold">¡Acción Irreversible!</span>
                    </div>
                    <p>Estás a punto de eliminar <span className="font-bold">TODOS</span> los productos del catálogo de Firestore para el usuario actual.</p>
                    <p>Esta acción no se puede deshacer.</p>
                 </div>
                )
            }
            confirmText={selectedProduct ? "Sí, Eliminar Producto" : "Sí, Borrar Catálogo"}
            onConfirm={() => {
                if (selectedProduct && selectedProduct.barcode) {
                    handleDeleteProduct(selectedProduct.barcode);
                } else if (!selectedProduct) {
                    handleConfirmClearCatalog();
                }
                setShowClearConfirm(false);
                setSelectedProduct(null);
            }}
            onCancel={() => {
                setShowClearConfirm(false);
                setSelectedProduct(null);
            }}
            isDestructive={true}
            isProcessing={isProcessing || isTransitionPending || isLoading}
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
            <TableHead className="w-[40%] sm:w-[35%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Descripción</TableHead>
            <TableHead className="w-[20%] sm:w-[20%] px-2 sm:px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">Proveedor</TableHead>
            <TableHead className="w-[10%] sm:w-[10%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Stock</TableHead>
            <TableHead className="hidden sm:table-cell w-[10%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Vencimiento</TableHead>
            <TableHead className="w-[10%] sm:w-[10%] px-2 sm:px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">Acciones</TableHead>
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
                    className={cn("hidden sm:table-cell px-2 sm:px-4 py-3 text-center tabular-nums text-xs",
                        isValidExp && new Date() > expirationDateObj! ? 'text-red-500 font-semibold' : ''
                    )}
                    title={isValidExp ? `Vence: ${format(expirationDateObj!, 'PPP', {locale: es})}` : 'Sin fecha'}
                >
                  {isValidExp ? format(expirationDateObj!, 'dd/MM/yy', {locale: es}) : 'N/A'}
                </TableCell>
                <TableCell className="px-2 sm:px-4 py-3 text-center">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(product)} className="text-primary-foreground hover:text-accent-foreground h-7 w-7" title="Editar Producto">
                        <Edit className="h-4 w-4 text-accent"/>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDeleteRequest(product)} className="text-primary-foreground hover:text-destructive-foreground h-7 w-7" title="Eliminar Producto">
                        <Trash className="h-4 w-4 text-destructive"/>
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
