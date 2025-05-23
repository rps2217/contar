
// src/components/product-database.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { cn, getLocalStorageItem, setLocalStorageItem, debounce } from "@/lib/utils"; 
import {
  addOrUpdateProductToDB,
  getAllProductsFromDB,
  deleteProductFromDB,
  clearProductDatabase as clearProductDatabaseFromDB,
  addProductsToDB,
} from '@/lib/database';
import {
    Filter, Play, Loader2, Save, Trash, Upload, Warehouse as WarehouseIcon, CalendarIcon, PackageSearch, Edit
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
    SelectGroup, SelectLabel, } from "@/components/ui/select";
import {
    Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { format, parse, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { GOOGLE_SHEET_URL_LOCALSTORAGE_KEY } from '@/lib/constants';
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
                
                const headers = csvData[0].map(h => h.toLowerCase().trim());
                
                const headerMapping: Record<keyof Omit<ProductDetail, 'expirationDate'>, string[]> = {
                    barcode: ["codigo", "código", "codigo de barras", "código de barras", "barcode"],
                    description: ["producto", "descripción", "descripcion", "description"],
                    provider: ["laboratorio", "proveedor", "provider"],
                    stock: ["stock final", "stockactual", "stock actual", "stock", "cantidad"]
                };

                const headerIndices: Partial<Record<keyof Omit<ProductDetail, 'expirationDate'>, number>> = {};
                const productDetailKeys = Object.keys(headerMapping) as Array<keyof Omit<ProductDetail, 'expirationDate'>>;

                for (const key of productDetailKeys) {
                    const possibleNames = headerMapping[key];
                    const index = headers.findIndex(h => possibleNames.includes(h.toLowerCase().trim()));
                    if (index !== -1) {
                        headerIndices[key] = index;
                    } else {
                        if (key === 'barcode' || key === 'description') { // Barcode and Description are mandatory
                            console.error(`Required header for "${key}" (e.g., ${possibleNames.join('/')}) not found in CSV headers: [${headers.join(', ')}]. Check Google Sheet headers.`);
                            reject(new Error(`Encabezado requerido para "${key}" (ej. ${possibleNames.join('/')}) no encontrado en el CSV. Verifique los encabezados de la Hoja de Google.`));
                            return;
                        }
                        console.warn(`Optional header for "${key}" (e.g., ${possibleNames.join('/')}) not found. It will be set to default.`);
                    }
                }


                for (let i = 1; i < csvData.length; i++) { 
                    const values = csvData[i];
                    if (!values || values.length === 0) continue;

                    const barcode = headerIndices.barcode !== undefined ? values[headerIndices.barcode]?.trim() : undefined;
                    if (!barcode) {
                        console.warn(`Fila ${i + 1} omitida: Código de barras vacío o faltante.`);
                        continue;
                    }

                    const description = headerIndices.description !== undefined ? values[headerIndices.description]?.trim() : `Producto ${barcode}`;
                    
                    let stock = 0;
                    if (headerIndices.stock !== undefined && values[headerIndices.stock]) {
                        const stockStr = values[headerIndices.stock].trim();
                        const parsedStock = parseInt(stockStr, 10);
                        if (!isNaN(parsedStock) && parsedStock >= 0) {
                            stock = parsedStock;
                        } else {
                             console.warn(`Valor de stock inválido "${stockStr}" para código ${barcode} en fila ${i + 1}. Usando 0.`);
                        }
                    } else {
                        console.warn(`Columna de stock no encontrada o vacía para el código ${barcode} en la fila ${i + 1}. Usando stock 0.`);
                    }
                    
                    const provider = headerIndices.provider !== undefined ? (values[headerIndices.provider]?.trim() || "Desconocido") : "Desconocido";
                    
                    let expirationDate: string | undefined = undefined;

                    products.push({ barcode, description, provider, stock, expirationDate });
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
  const [isLoading, setIsLoading] = useState(true);
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
                toast({ variant: "destructive", title: "Error de Catálogo", description: "No se pudo cargar el catálogo de Firestore." });
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
        toast({ variant: "destructive", title: "Error", description: "ID de usuario no disponible." });
        return;
    }
    const isUpdating = !!selectedProduct;
    const productData: ProductDetail = {
        barcode: isUpdating ? selectedProduct!.barcode : data.barcode.trim(),
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
        stock: Number.isFinite(Number(data.stock)) ? Number(data.stock) : 0,
        expirationDate: data.expirationDate || undefined,
    };

    if (!productData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        await addOrUpdateProductInCatalog(userId, productData);
        
        // Update local catalog state
        if (isMountedRef.current) {
            setCatalogProducts(prev => {
                if (isUpdating) {
                    return prev.map(p => p.barcode === productData.barcode ? productData : p);
                } else {
                    // Avoid duplicates if somehow added again before Firestore listener updates
                    if (prev.some(p => p.barcode === productData.barcode)) {
                        return prev.map(p => p.barcode === productData.barcode ? productData : p);
                    }
                    return [...prev, productData];
                }
            });
            toast({ title: isUpdating ? "Producto Actualizado" : "Producto Agregado" });
            setIsEditModalOpen(false);
            setSelectedProduct(null);
        }
    } catch (error: any) {
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        if (isMountedRef.current) {
            toast({ variant: "destructive", title: "Error de Catálogo", description: errorMessage });
        }
    } finally {
        if (isMountedRef.current) {
            setIsProcessing(false);
            setProcessingStatus("");
        }
    }
 }, [userId, selectedProduct, toast, setCatalogProducts]);


  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
    if (!userId || !barcode) {
        toast({ variant: "destructive", title: "Error Interno", description: "ID de usuario o código de barras no disponible." });
        return;
    }
    const product = catalogProducts.find(p => p.barcode === barcode);
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus("Eliminando producto...");
    try {
      await deleteProductFromCatalog(userId, barcode);
      if (isMountedRef.current) {
          setCatalogProducts(prev => prev.filter(p => p.barcode !== barcode));
          toast({
            title: "Producto Eliminado",
            description: `${product?.description || barcode} ha sido eliminado del catálogo.`,
          });
      }
    } catch (error: any) {
      if (isMountedRef.current) {
        toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar del catálogo: ${error.message}` });
      }
    } finally {
        if (isMountedRef.current) {
            setIsProcessing(false);
            setProcessingStatus("");
            setIsEditModalOpen(false); 
        }
    }
  }, [userId, catalogProducts, toast, setCatalogProducts]);


  const handleOpenEditDialog = useCallback((product: ProductDetail | null) => {
    setSelectedProduct(product);
    setIsEditModalOpen(true);
  }, []);

  const triggerDeleteProductAlert = useCallback((product: ProductDetail | null) => {
      if (!product) {
         toast({ variant: "destructive", title: "Error Interno", description: "Datos del producto no disponibles para eliminar." });
         return;
      }
      handleDeleteProduct(product.barcode); // Direct delete for simplicity, confirmation can be added back if needed
  }, [handleDeleteProduct, toast]);


   const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!userId) {
            toast({ variant: "destructive", title: "Error", description: "ID de usuario no disponible." });
            return;
        }
        if (!googleSheetUrlOrId) {
            toast({ variant: "destructive", title: "URL/ID Requerido", description: "Introduce la URL de la hoja de Google o el ID." });
            return;
        }
        if (!isMountedRef.current) return;
        setIsProcessing(true);
        setUploadProgress(0);
        setProcessingStatus("Obteniendo datos de Google Sheet...");

        try {
            const parsedProducts = await fetchGoogleSheetData(googleSheetUrlOrId);
             const totalItemsToLoad = parsedProducts.length;
             let itemsLoaded = 0;

             if (totalItemsToLoad === 0) {
                 if(isMountedRef.current) toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja.", variant: "default" });
                 setIsProcessing(false);
                 setProcessingStatus("");
                 return;
             }
             if (isMountedRef.current) setProcessingStatus(`Cargando ${totalItemsToLoad} productos a Firestore...`);

             await addProductsToCatalog(userId, parsedProducts); // Batch add to Firestore

             // Update local catalog state
             if (isMountedRef.current) {
                setCatalogProducts(prevCatalog => {
                    const newCatalogMap = new Map(prevCatalog.map(p => [p.barcode, p]));
                    parsedProducts.forEach(p => newCatalogMap.set(p.barcode, p));
                    return Array.from(newCatalogMap.values());
                });
                setUploadProgress(100); // Mark as complete
                toast({ title: "Carga Completa", description: `Se procesaron y guardaron ${totalItemsToLoad} productos en Firestore.` });
             }

        } catch (error: any) {
            if (isMountedRef.current) {
                setProcessingStatus("Error durante la carga.");
                toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet."});
            }
        } finally {
            if (isMountedRef.current) {
                setIsProcessing(false);
                setProcessingStatus("");
                // setUploadProgress(0); // Keep progress at 100 or reset based on UX preference
            }
        }
    }, [userId, googleSheetUrlOrId, toast, setCatalogProducts]);


  const handleExportDatabase = useCallback(() => {
     if (catalogProducts.length === 0) {
       toast({ title: "Catálogo Vacío", description: "No hay productos para exportar." });
       return;
     }
     try {
         const dataToExport = catalogProducts.map(p => ({
             CODIGO_BARRAS: p.barcode,
             DESCRIPCION: p.description,
             PROVEEDOR: p.provider,
             STOCK: p.stock ?? 0,
             FECHA_VENCIMIENTO: p.expirationDate || '',
         }));
         const csv = Papa.unparse(dataToExport, { header: true, quotes: true, skipEmptyLines: true });
         const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
         const link = document.createElement("a");
         link.href = URL.createObjectURL(blob);
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         link.setAttribute("download", `product_catalog_${timestamp}.csv`);
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(link.href);
         toast({ title: "Exportación Iniciada"});
     } catch (error) {
          toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
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
      toast({
        variant: "destructive",
        title: "Seleccionar Proveedor",
        description: "Por favor, selecciona un proveedor específico para iniciar el conteo.",
      });
      return;
    }
    if (!isMountedRef.current) return;
    setIsProcessing(true);
    setProcessingStatus(`Buscando productos de ${selectedProviderFilter}...`);

    try {
      const providerProducts = catalogProducts.filter(product => (product.provider || "Desconocido") === selectedProviderFilter);

      if (providerProducts.length === 0) {
        if (isMountedRef.current) toast({ title: "Vacío", description: `No hay productos registrados para el proveedor ${selectedProviderFilter}.` });
        setIsProcessing(false);
        setProcessingStatus("");
        return;
      }

      onStartCountByProvider(providerProducts);

    } catch (error) {
      if (isMountedRef.current) toast({ variant: "destructive", title: "Error", description: "No se pudo iniciar el conteo por proveedor." });
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
                            (product.expirationDate || '').includes(lowerSearchTerm);

      const matchesProvider = selectedProviderFilter === 'all' || (product.provider || "Desconocido") === selectedProviderFilter;

      return matchesSearch && matchesProvider;
    }).sort((a, b) => {
        if (!a.description && !b.description) return 0;
        if (!a.description) return 1;
        if (!b.description) return -1;
        return a.description.localeCompare(b.description);
    });
  }, [catalogProducts, searchTerm, selectedProviderFilter]);


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
                    onClearCatalogRequest(); // Call prop from parent
                    break;
                }
              }} disabled={isProcessing || isLoading || isTransitionPending}>
              <SelectTrigger className="w-full sm:w-auto md:w-[200px] h-10">
                <SelectValue placeholder="Acciones DB" />
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
                  <SelectItem value="clear" disabled={catalogProducts.length === 0}>Borrar Catálogo</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
         </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <Label htmlFor="search-product" className="sr-only">Buscar Producto</Label>
             <Input
                 id="search-product"
                 type="text"
                 placeholder="Buscar por código, descripción..."
                 onChange={(e) => debouncedSetSearchTerm(e.target.value)}
                 className="h-10 flex-grow min-w-[150px]"
                 disabled={isProcessing || isLoading || isTransitionPending}
             />
             <Select
                 value={selectedProviderFilter}
                 onValueChange={setSelectedProviderFilter}
                 disabled={providerOptions.length <= 1 || isProcessing || isLoading || isTransitionPending}
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
                disabled={selectedProviderFilter === 'all' || isProcessing || isLoading || isTransitionPending}
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
              Cargar/Actualizar Catálogo desde Google Sheet:
           </Label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
             <Input
             id="google-sheet-url"
             type="text"
             placeholder="URL completa de Hoja de Google o ID de Hoja"
             value={googleSheetUrlOrId}
             onChange={handleGoogleSheetUrlOrIdChange}
             className="flex-grow h-10 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
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
         <p id="google-sheet-info" className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
             La hoja debe tener permisos de 'cualquiera con el enlace puede ver'. Se espera: Columna para Código, Descripción, Proveedor, Stock (o variaciones de nombres).
         </p>
         {isProcessing && uploadProgress > 0 && (
             <div className="mt-4 space-y-1">
                 <Progress value={uploadProgress} className="h-2 w-full" />
                 <p className="text-sm text-muted-foreground dark:text-gray-400 text-center">
                     {processingStatus || `Cargando... (${uploadProgress}%)`}
                 </p>
             </div>
         )}
         {isLoading && !isProcessing && (
              <p className="text-sm text-muted-foreground dark:text-gray-400 text-center mt-2">Cargando catálogo de productos...</p>
         )}
       </div>

       <ProductTable
           products={filteredProducts}
           isLoading={isLoading || isTransitionPending}
           onEdit={handleOpenEditDialog}
           onDeleteRequest={triggerDeleteProductAlert}
       />

      <EditProductDialog
          isOpen={isEditModalOpen}
          setIsOpen={setIsEditModalOpen}
          selectedDetail={selectedProduct}
          setSelectedDetail={setSelectedProduct}
          onSubmit={handleAddOrUpdateProductSubmit}
          onDelete={(barcode) => handleDeleteProduct(barcode)}
          isProcessing={isProcessing || isTransitionPending}
          initialStock={selectedProduct?.stock}
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
    <ScrollArea className="h-[calc(100vh-480px)] md:h-[calc(100vh-430px)] border rounded-lg shadow-sm bg-white dark:bg-gray-800">
      <Table>
        <TableCaption className="dark:text-gray-400">Productos en el catálogo. Click en la descripción para editar.</TableCaption>
        <TableHeader className="sticky top-0 bg-gray-50 dark:bg-gray-700 z-10 shadow-sm">
          <TableRow>
            <TableHead className="w-[15%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Código Barras</TableHead>
            <TableHead className="w-[30%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Descripción</TableHead>
            <TableHead className="w-[20%] px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Proveedor</TableHead>
            <TableHead className="w-[10%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock</TableHead>
            <TableHead className="w-[15%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Vencimiento</TableHead>
            <TableHead className="w-[10%] px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-10 text-gray-500 dark:text-gray-400">
                Cargando productos...
              </TableCell>
            </TableRow>
          ) : products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-10 text-gray-500 dark:text-gray-400">
                No hay productos en el catálogo.
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => (
              <TableRow key={product.barcode} className="hover:bg-muted/50 dark:hover:bg-gray-700 text-sm transition-colors duration-150">
                <TableCell className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">{product.barcode}</TableCell>
                <TableCell
                    className="px-4 py-3 text-gray-800 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline font-semibold"
                    onClick={() => onEdit(product)}
                 >
                    {product.description}
                </TableCell>
                 <TableCell className="px-4 py-3 text-gray-600 dark:text-gray-300">{product.provider || 'N/A'}</TableCell>
                <TableCell className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 tabular-nums">
                  {product.stock ?? 0}
                </TableCell>
                <TableCell
                    className={cn("px-4 py-3 text-center text-gray-600 dark:text-gray-300 tabular-nums",
                        product.expirationDate && isValid(parseISO(product.expirationDate)) && new Date(product.expirationDate) < new Date() ? 'text-red-500 dark:text-red-400 font-semibold' : ''
                    )}
                    title={product.expirationDate && isValid(parseISO(product.expirationDate)) ? `Vence: ${format(parseISO(product.expirationDate), 'PPP', {locale: es})}` : 'Sin fecha'}
                >
                  {product.expirationDate && isValid(parseISO(product.expirationDate)) ? format(parseISO(product.expirationDate), 'dd/MM/yy', {locale: es}) : 'N/A'}
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
            ))
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
});
ProductTable.displayName = 'ProductTable';
