
"use client";

import type { ProductDetail, InventoryItem, DisplayProduct } from '@/types/product';
import { zodResolver } from "@hookform/resolvers/zod";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
    addOrUpdateProductDetail,
    getAllProductDetails,
    deleteProductCompletely,
    clearDatabaseCompletely,
    addOrUpdateInventoryItem,
    getInventoryItem,
    getAllInventoryItems,
    addInventoryItemsInBulk,
    addProductDetailsInBulk,
    getInventoryItemsForWarehouse, // Import needed function
} from '@/lib/indexeddb-helpers';
import {
    Edit, FileDown, Filter, Save, Trash, Upload, AlertCircle, Warehouse as WarehouseIcon, Play
} from "lucide-react";
import Papa from 'papaparse'; // Using PapaParse for robust CSV parsing
import * as React from "react"; // Import React
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
    Form, FormControl, FormDescription as FormDescUi, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
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
import { format } from 'date-fns';

// --- Zod Schema ---
const productDetailSchema = z.object({
  barcode: z.string().min(1, { message: "El código de barras es requerido." }),
  description: z.string().min(1, { message: "La descripción es requerida." }),
  provider: z.string().optional(),
  stock: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? 0 : Number(val)),
    z.number().min(0, { message: "El stock debe ser mayor o igual a 0." })
  ),
});
type ProductDetailValues = z.infer<typeof productDetailSchema>;

const GOOGLE_SHEET_URL_LOCALSTORAGE_KEY = 'stockCounterPro_googleSheetUrl';

// --- Helper Components ---

interface ProductTableProps {
  productDetails: ProductDetail[];
  inventoryItems: InventoryItem[];
  isLoading: boolean;
  searchTerm: string;
  selectedProviderFilter: string;
  onEdit: (detail: ProductDetail) => void;
}

const ProductTable: React.FC<ProductTableProps> = ({
  productDetails,
  inventoryItems,
  isLoading,
  searchTerm,
  selectedProviderFilter,
  onEdit,
}) => {
    const filteredDetails = React.useMemo(() => {
        return productDetails.filter(detail => {
            const searchTermLower = searchTerm.toLowerCase();
            const matchesSearch = searchTerm === "" ||
                                (detail.barcode || '').toLowerCase().includes(searchTermLower) ||
                                (detail.description || '').toLowerCase().includes(searchTermLower) ||
                                (detail.provider || '').toLowerCase().includes(searchTermLower);
            const matchesProvider = selectedProviderFilter === 'all' || (detail.provider || "Desconocido") === selectedProviderFilter;
            return matchesSearch && matchesProvider;
        });
    }, [productDetails, searchTerm, selectedProviderFilter]);

  return (
     <ScrollArea className="border rounded-lg shadow-sm h-[calc(100vh-480px)] md:h-[calc(100vh-420px)] bg-white dark:bg-gray-800">
         <Table>
            <TableCaption className="dark:text-gray-400">
               {isLoading ? "Cargando..." :
               filteredDetails.length === 0
                 ? (productDetails.length > 0 ? 'No hay productos que coincidan con la búsqueda/filtro.' : 'La base de datos está vacía.')
                 : `Mostrando ${filteredDetails.length} de ${productDetails.length} productos.`
               }
           </TableCaption>
            <TableHeader className="sticky top-0 bg-background dark:bg-gray-700 z-10 shadow-sm">
             <TableRow>
               <TableHead className="w-[25%] px-3 py-3 dark:text-gray-300">Código Barras</TableHead>
               <TableHead className="w-[40%] px-3 py-3 dark:text-gray-300">Descripción (Click para editar)</TableHead>
               <TableHead className="w-[20%] px-3 py-3 hidden md:table-cell dark:text-gray-300">Proveedor</TableHead>
               <TableHead className="w-[15%] px-3 py-3 text-right dark:text-gray-300">Stock Total</TableHead>
             </TableRow>
           </TableHeader>
           <TableBody>
             {isLoading ? (
                 <TableRow>
                     <TableCell colSpan={4} className="text-center py-10 text-muted-foreground dark:text-gray-400">
                         Cargando datos...
                     </TableCell>
                 </TableRow>
             ) : filteredDetails.length === 0 ? (
                   <TableRow>
                       <TableCell colSpan={4} className="text-center py-10 text-muted-foreground dark:text-gray-400">
                           {productDetails.length > 0 ? "No hay productos que coincidan." : "La base de datos está vacía."}
                       </TableCell>
                   </TableRow>
               ) : (
                   filteredDetails.map((detail) => {
                       const totalStock = inventoryItems
                           .filter(item => item.barcode === detail.barcode)
                           .reduce((sum, item) => sum + (item.stock || 0), 0);

                       return (
                           <TableRow key={detail.barcode} className="hover:bg-muted/50 dark:hover:bg-gray-700 text-sm transition-colors duration-150">
                               <TableCell className="px-3 py-2 font-medium dark:text-gray-100" aria-label={`Código ${detail.barcode}`}>
                                   {detail.barcode}
                               </TableCell>
                               <TableCell
                                   className="px-3 py-2 cursor-pointer hover:text-primary dark:hover:text-teal-400 hover:underline dark:text-gray-100"
                                   onClick={() => onEdit(detail)}
                                   aria-label={`Editar producto ${detail.description}`}
                                   title={`Editar ${detail.description}`}
                               >
                                   {detail.description}
                               </TableCell>
                               <TableCell className="px-3 py-2 hidden md:table-cell text-muted-foreground dark:text-gray-300" aria-label={`Proveedor ${detail.provider}`}>
                                   {detail.provider || 'N/A'}
                               </TableCell>
                                <TableCell className="px-3 py-2 text-right font-medium tabular-nums text-muted-foreground dark:text-gray-300" aria-label={`Stock total ${totalStock}`}>
                                  {totalStock}
                                </TableCell>
                           </TableRow>
                       );
                   })
               )}
           </TableBody>
         </Table>
       </ScrollArea>
  );
};

interface EditProductDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  selectedDetail: ProductDetail | null;
  setSelectedDetail: (detail: ProductDetail | null) => void;
  onSubmit: (data: ProductDetailValues) => void;
  onDelete: (barcode: string | null) => void;
  isProcessing: boolean;
  initialStock: number;
}

const EditProductDialog: React.FC<EditProductDialogProps> = ({
  isOpen,
  setIsOpen,
  selectedDetail,
  setSelectedDetail,
  onSubmit,
  onDelete,
  isProcessing,
  initialStock
}) => {
  const productDetailForm = useForm<ProductDetailValues>({
    resolver: zodResolver(productDetailSchema),
    defaultValues: { barcode: "", description: "", provider: "Desconocido", stock: 0 },
  });
  const { handleSubmit: handleDetailSubmit, reset: resetDetailForm, control: detailControl, setValue } = productDetailForm;

   // Effect to update form values when selectedDetail changes or dialog opens
   useEffect(() => {
    if (isOpen && selectedDetail) {
        resetDetailForm({
            barcode: selectedDetail.barcode || "",
            description: selectedDetail.description || "",
            provider: selectedDetail.provider || "Desconocido",
            stock: initialStock, // Use initialStock passed as prop
        });
    } else if (!isOpen) {
         resetDetailForm({ barcode: "", description: "", provider: "Desconocido", stock: 0 });
         setSelectedDetail(null); // Ensure selectedDetail is cleared when dialog closes
    }
   }, [isOpen, selectedDetail, resetDetailForm, initialStock, setSelectedDetail]); // Added initialStock and setSelectedDetail

  const handleClose = () => {
    setIsOpen(false);
    // Resetting form and selectedDetail is handled by the useEffect above
  };

  return (
    <Dialog open={isOpen} onOpenChange={(openState) => { if (!openState) handleClose(); else setIsOpen(true); }}>
        <DialogContent className="sm:max-w-lg dark:bg-gray-800 dark:text-white">
          <DialogHeader>
            <DialogTitle className="dark:text-gray-100">{selectedDetail ? "Editar Producto" : "Agregar Nuevo Producto"}</DialogTitle>
            <DialogDescription className="dark:text-gray-400">
              {selectedDetail ? "Modifica los detalles del producto y su stock en el almacén principal." : "Añade un nuevo producto (detalle general) y su stock inicial para el almacén principal."}
            </DialogDescription>
          </DialogHeader>
          <Form {...productDetailForm}>
            <form onSubmit={handleDetailSubmit(onSubmit)} className="space-y-4 p-2">
              <FormField
                control={detailControl}
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Código de Barras *</FormLabel>
                    <FormControl>
                       <Input type="text" {...field} readOnly={!!selectedDetail} aria-required="true" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={detailControl}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Descripción *</FormLabel>
                    <FormControl>
                       <Input type="text" {...field} aria-required="true" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={detailControl}
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="dark:text-gray-200">Proveedor</FormLabel>
                    <FormControl>
                      <Input type="text" {...field} placeholder="Opcional" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                  control={detailControl}
                  name="stock"
                  render={({ field }) => (
                  <FormItem>
                      <FormLabel className="dark:text-gray-200">Stock (Almacén Principal) *</FormLabel>
                      <FormControl>
                      <Input type="number" {...field} aria-required="true" disabled={isProcessing} className="dark:bg-gray-700 dark:border-gray-600"/>
                      </FormControl>
                       <FormDescUi className="text-xs dark:text-gray-400">Este stock se aplica al almacén 'Principal'.</FormDescUi>
                      <FormMessage />
                  </FormItem>
                  )}
              />
               <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between w-full pt-6 gap-2">
                    {selectedDetail && (
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => onDelete(selectedDetail.barcode)}
                            className="sm:mr-auto"
                            disabled={isProcessing}
                        >
                            <Trash className="mr-2 h-4 w-4" /> Eliminar Producto
                        </Button>
                    )}
                    {!selectedDetail && <div className="sm:mr-auto"></div>}
                    <div className="flex gap-2 justify-end">
                         <Button type="button" variant="outline" onClick={handleClose} disabled={isProcessing} className="dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700">Cancelar</Button>
                         <Button type="submit" disabled={isProcessing} className="dark:bg-teal-600 dark:hover:bg-teal-700">
                             {isProcessing ? "Guardando..." : (selectedDetail ? <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</> : "Agregar Producto")}
                         </Button>
                    </div>
                </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
  );
};

// --- Google Sheet Parsing Logic (Position-Based) ---
const parseGoogleSheetUrl = (sheetUrl: string): { spreadsheetId: string | null; gid: string } => {
    try {
        new URL(sheetUrl);
    } catch (error) {
        console.error("Invalid Google Sheet URL provided:", sheetUrl, error);
        throw new Error("URL de Hoja de Google inválida.");
    }
    const spreadsheetIdMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);

    const spreadsheetId = spreadsheetIdMatch ? spreadsheetIdMatch[1] : null;
    const gid = gidMatch ? gidMatch[1] : '0';

    if (!spreadsheetId) {
         console.warn("Could not extract spreadsheet ID from URL:", sheetUrl);
         throw new Error("No se pudo extraer el ID de la hoja de cálculo de la URL.");
    }
    return { spreadsheetId, gid };
};

// Updated function to parse both details and inventory (position-based)
async function fetchAndParseGoogleSheetData(sheetUrl: string): Promise<{ details: ProductDetail[], inventory: InventoryItem[] }> {
    const { spreadsheetId, gid } = parseGoogleSheetUrl(sheetUrl);
    const csvExportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log("Fetching Google Sheet CSV from:", csvExportUrl);

    let response: Response;
    try {
        const urlWithCacheBust = `${csvExportUrl}&_=${new Date().getTime()}`;
        response = await fetch(urlWithCacheBust, { cache: "no-store" });
    } catch (error: any) {
        console.error("Network error fetching Google Sheet:", error);
        let userMessage = "Error de red al obtener la hoja. Verifique su conexión y la URL.";
        if (error.message?.includes('Failed to fetch')) {
            userMessage += " Posible problema de CORS o conectividad, o la URL es incorrecta.";
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
        if (status === 400) userMessage += "Verifique la URL y asegúrese de que el ID de la hoja (gid=...) sea correcto.";
        else if (status === 403 || errorBody.toLowerCase().includes("google accounts sign in")) userMessage = "Error de Acceso: La hoja no es pública. Cambie la configuración de compartir a 'Cualquier persona con el enlace puede ver'.";
        else if (status === 404) userMessage += "Hoja no encontrada. Verifique la URL y el ID de la hoja.";
        else userMessage += ` ${statusText}. Revise los permisos de la hoja o la URL.`;

        throw new Error(userMessage);
    }

    const csvText = await response.text();
    console.log(`Successfully fetched CSV data (length: ${csvText.length}). Parsing...`);

     // --- Robust CSV Parsing Logic - Rely on Column Position ---
     const lines = csvText.split(/\r?\n/);
     if (lines.length < 1) {
         console.warn("CSV data is empty or contains only empty lines.");
         return { details: [], inventory: [] };
     }

     const productDetails: ProductDetail[] = [];
     const inventoryItems: InventoryItem[] = [];
     const defaultWarehouseId = 'main';

      // Skip header row - Data starts from the second row (index 1)
     const startDataRow = 1;

     if (startDataRow >= lines.length) {
         console.warn("CSV contains only a header row or is empty.");
         return { details: [], inventory: [] };
     }

     console.log(`Processing data starting from row ${startDataRow + 1} (1-based index).`);

     for (let i = startDataRow; i < lines.length; i++) {
         const line = lines[i].trim();
         if (!line) continue; // Skip empty lines

         const result = Papa.parse<string[]>(line, { delimiter: ',', skipEmptyLines: true });

         if (result.errors.length > 0) {
             console.warn(`Skipping row ${i + 1} due to parsing errors: ${result.errors[0].message}. Line: "${line}"`);
             continue;
         }
         if (!result.data || result.data.length === 0 || !result.data[0] || result.data[0].length < 4) { // Check if at least 4 columns exist
             console.warn(`Skipping row ${i + 1}: Insufficient columns or no data parsed. Line: "${line}"`);
             continue;
         }

         const values = result.data[0];

         // --- Column Position Mapping (0-based index) ---
         // Column 0: Barcode (Required)
         // Column 1: Description
         // Column 2: Provider
         // Column 3: Stock (for 'main' warehouse)

         const barcode = values[0]?.trim();
         if (!barcode) {
             console.warn(`Skipping row ${i + 1}: Missing or empty barcode (Column 1). Line: "${line}"`);
             continue;
         }
          if (barcode.length > 100) {
             console.warn(`Skipping row ${i + 1}: Barcode too long (${barcode.length} chars). Line: "${line}"`);
             continue;
          }

         const description = values[1]?.trim() || `Producto ${barcode}`;
         const provider = values[2]?.trim() || "Desconocido";
         const stockStr = values[3]?.trim() || '0';
         let stockMain = parseInt(stockStr, 10);
         if (isNaN(stockMain) || stockMain < 0) {
            console.warn(`Invalid stock value "${stockStr}" for barcode ${barcode} in row ${i + 1}. Defaulting to 0.`);
            stockMain = 0;
         }

         productDetails.push({
             barcode: barcode,
             description: description,
             provider: provider,
         });

         inventoryItems.push({
             barcode: barcode,
             warehouseId: defaultWarehouseId,
             stock: stockMain,
             count: 0, // Initialize count to 0 during import
             lastUpdated: new Date().toISOString(),
         });
     }
     console.log(`Parsed ${productDetails.length} product details and ${inventoryItems.length} inventory items from CSV.`);
     return { details: productDetails, inventory: inventoryItems };
 }

 // --- Props Interface for ProductDatabase ---
 interface ProductDatabaseProps {
    currentWarehouseId: string;
    onStartCountByProvider: (products: DisplayProduct[]) => void;
 }


// --- React Component ---

export const ProductDatabase: React.FC<ProductDatabaseProps> = ({ currentWarehouseId, onStartCountByProvider }) => {
  const { toast } = useToast();
  const [productDetails, setProductDetails] = useState<ProductDetail[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<ProductDetail | null>(null);
  const [initialStockForEdit, setInitialStockForEdit] = useState<number>(0); // State to hold stock for the edit dialog
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertAction, setAlertAction] = useState<'deleteProduct' | 'clearDatabase' | null>(null);
  const [productToDeleteBarcode, setProductToDeleteBarcode] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const isMobile = useIsMobile(); // Use hook if needed for responsiveness

  // Load initial data from IndexedDB on mount
  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    console.log("ProductDatabase: Loading initial data...");
    try {
        const [details, inventory] = await Promise.all([
            getAllProductDetails(),
            getAllInventoryItems()
        ]);
        setProductDetails(details);
        setInventoryItems(inventory);
        console.log(`ProductDatabase: Loaded ${details.length} details and ${inventory.length} inventory items.`);
    } catch (error) {
        console.error("ProductDatabase: Failed to load initial data:", error);
        toast({ variant: "destructive", title: "Error de Base de Datos", description: "No se pudo cargar la información de productos." });
    } finally {
        setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Load and save Google Sheet URL from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUrl = localStorage.getItem(GOOGLE_SHEET_URL_LOCALSTORAGE_KEY);
      if (savedUrl) {
        setGoogleSheetUrl(savedUrl);
      }
    }
  }, []);

  const handleGoogleSheetUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setGoogleSheetUrl(newUrl);
    if (typeof window !== 'undefined') {
      localStorage.setItem(GOOGLE_SHEET_URL_LOCALSTORAGE_KEY, newUrl);
    }
  };


  // --- CRUD Handlers ---

 const handleAddOrUpdateDetailSubmit = useCallback(async (data: ProductDetailValues) => {
    const isUpdating = !!selectedDetail;
    const detailData: ProductDetail = {
        barcode: isUpdating ? selectedDetail.barcode : data.barcode.trim(),
        description: data.description.trim() || `Producto ${data.barcode.trim()}`,
        provider: data.provider?.trim() || "Desconocido",
    };

    if (!detailData.barcode) {
        toast({ variant: "destructive", title: "Error", description: "El código de barras no puede estar vacío." });
        return;
    }

    setIsProcessing(true);
    setProcessingStatus(isUpdating ? "Actualizando producto..." : "Agregando producto...");
    try {
        await addOrUpdateProductDetail(detailData);

        let currentCount = 0;
        if (isUpdating) {
            const existingItem = await getInventoryItem(detailData.barcode, 'main');
            currentCount = existingItem?.count ?? 0;
        }

        const inventoryItemData: InventoryItem = {
            barcode: detailData.barcode,
            warehouseId: 'main',
            stock: data.stock ?? 0,
            count: currentCount,
            lastUpdated: new Date().toISOString(),
        };
        await addOrUpdateInventoryItem(inventoryItemData);

        // Update local states
        setProductDetails(prevDetails => {
            const existingIndex = prevDetails.findIndex(d => d.barcode === detailData.barcode);
            if (existingIndex > -1) {
                const newDetails = [...prevDetails];
                newDetails[existingIndex] = detailData;
                return newDetails;
            } else {
                return [detailData, ...prevDetails];
            }
        });
         setInventoryItems(prevItems => {
             const existingInvIndex = prevItems.findIndex(i => i.barcode === inventoryItemData.barcode && i.warehouseId === inventoryItemData.warehouseId);
             if (existingInvIndex > -1) {
                 const newItems = [...prevItems];
                 newItems[existingInvIndex] = inventoryItemData;
                 return newItems;
             } else {
                 return [...prevItems, inventoryItemData];
             }
         });

        toast({
            title: isUpdating ? "Producto Actualizado" : "Producto Agregado",
            description: `${detailData.description} (${detailData.barcode}) ha sido ${isUpdating ? 'actualizado (incluyendo stock en almacén principal)' : 'agregado con stock inicial'}.`,
        });
        setIsEditModalOpen(false); // Close dialog on success
    } catch (error: any) {
        console.error("Detail/Inventory operation failed", error);
        let errorMessage = `Error al ${isUpdating ? 'actualizar' : 'guardar'} el producto.`;
        if (error.message?.includes('ConstraintError')) {
            errorMessage = `El producto con código de barras ${detailData.barcode} ya existe.`;
        } else if (error.message) {
             errorMessage += ` Detalle: ${error.message}`;
        }
        toast({ variant: "destructive", title: "Error de Base de Datos", description: errorMessage });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
    }
 }, [selectedDetail, toast]); // Dependencies


  const handleDeleteProduct = useCallback(async (barcode: string | null) => {
      if (!barcode) {
          toast({ variant: "destructive", title: "Error Interno", description: "No se puede eliminar el producto sin código de barras." });
          return;
      }
      setIsProcessing(true);
      setProcessingStatus("Eliminando producto...");
      try {
        await deleteProductCompletely(barcode);
        // Update local states
        setProductDetails(prev => prev.filter(d => d.barcode !== barcode));
        setInventoryItems(prev => prev.filter(i => i.barcode !== barcode));
        toast({
          title: "Producto Eliminado",
          description: `El producto ${barcode} y todo su inventario asociado han sido eliminados.`,
        });
        setIsEditModalOpen(false); // Close edit dialog if open for deleted product
        setIsAlertOpen(false); // Close confirmation dialog
        setProductToDeleteBarcode(null);
        setAlertAction(null);
      } catch (error: any) {
        console.error("Failed to delete product completely", error);
        toast({ variant: "destructive", title: "Error al Eliminar", description: `No se pudo eliminar: ${error.message}` });
      } finally {
            setIsProcessing(false);
            setProcessingStatus("");
      }
      // No finally needed here as it's handled within the try/catch now
  }, [toast]);


  const handleClearDatabase = useCallback(async () => {
    setIsProcessing(true);
    setProcessingStatus("Borrando base de datos...");
    try {
      await clearDatabaseCompletely();
      setProductDetails([]);
      setInventoryItems([]);
      toast({ title: "Base de Datos Borrada", description: "Todos los productos y el inventario han sido eliminados." });
    } catch (error: any) {
      console.error("Failed to clear database", error);
      toast({ variant: "destructive", title: "Error al Borrar DB", description: `No se pudo borrar la base de datos: ${error.message}` });
    } finally {
        setIsProcessing(false);
        setProcessingStatus("");
        setIsAlertOpen(false);
        setAlertAction(null);
    }
  }, [toast]);


  // --- Dialog and Alert Triggers ---

  const handleOpenEditDialog = useCallback(async (detail: ProductDetail | null) => {
    if (detail) {
         const mainInventory = await getInventoryItem(detail.barcode, 'main');
         setInitialStockForEdit(mainInventory?.stock ?? 0); // Set initial stock for the dialog
         setSelectedDetail(detail);
    } else {
        setInitialStockForEdit(0); // Default stock for new product
        setSelectedDetail(null);
    }
    setIsEditModalOpen(true);
  }, []);

  const triggerDeleteProductAlert = useCallback((barcode: string | null) => {
      if (!barcode) {
         toast({ variant: "destructive", title: "Error Interno", description: "Datos del producto no disponibles para eliminar." });
         return;
      }
      setProductToDeleteBarcode(barcode);
      setAlertAction('deleteProduct');
      setIsAlertOpen(true);
  }, [toast]);

  const triggerClearDatabaseAlert = useCallback(() => {
      if (productDetails.length === 0 && inventoryItems.length === 0) {
           toast({ title: "Base de Datos Vacía", description: "La base de datos ya está vacía." });
           return;
      }
      setAlertAction('clearDatabase');
      setIsAlertOpen(true);
  }, [productDetails, inventoryItems, toast]);

   const handleDeleteConfirmation = useCallback(() => {
        console.log(`Confirming action: ${alertAction}`);
        if (alertAction === 'deleteProduct' && productToDeleteBarcode) {
            handleDeleteProduct(productToDeleteBarcode);
        } else if (alertAction === 'clearDatabase') {
            handleClearDatabase();
        } else {
            console.warn("Delete confirmation called with invalid state:", { alertAction, productToDeleteBarcode });
            setIsAlertOpen(false);
            setProductToDeleteBarcode(null);
            setAlertAction(null);
        }
    }, [alertAction, productToDeleteBarcode, handleDeleteProduct, handleClearDatabase]);



   // --- Google Sheet Loading ---
   const handleLoadFromGoogleSheet = useCallback(async () => {
        if (!googleSheetUrl) {
            toast({ variant: "destructive", title: "URL Requerida", description: "Introduce la URL de la hoja de Google." });
            return;
        }

        console.log("Starting Google Sheet load process...");
        setIsProcessing(true);
        setUploadProgress(0);
        setProcessingStatus("Obteniendo datos de Google Sheet...");

        try {
            const { details, inventory } = await fetchAndParseGoogleSheetData(googleSheetUrl);
            const totalItemsToLoad = details.length + inventory.length;
             let itemsLoaded = 0;
             const batchSize = 100; // Process in batches

             if (totalItemsToLoad === 0) {
                 toast({ title: "Hoja Vacía o Sin Datos Válidos", description: "No se encontraron productos válidos en la hoja.", variant: "default" });
             } else {
                 // --- Incremental Database Update in Batches ---
                 setProcessingStatus(`Actualizando detalles (${details.length})...`);
                 for (let i = 0; i < details.length; i += batchSize) {
                     const batch = details.slice(i, i + batchSize);
                     await addProductDetailsInBulk(batch);
                     itemsLoaded += batch.length;
                     setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));
                     await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to prevent blocking UI thread
                 }

                 setProcessingStatus(`Actualizando inventario (${inventory.length})...`);
                 for (let i = 0; i < inventory.length; i += batchSize) {
                     const batch = inventory.slice(i, i + batchSize);
                     await addInventoryItemsInBulk(batch);
                     itemsLoaded += batch.length;
                     setUploadProgress(Math.round((itemsLoaded / totalItemsToLoad) * 100));
                      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
                 }

                 console.log("Bulk add/update to IndexedDB completed.");
                 await loadInitialData(); // Reload data to reflect changes
                 toast({ title: "Carga Completa", description: `Se procesaron ${details.length} detalles y ${inventory.length} registros de inventario desde la Hoja de Google.` });
             }

        } catch (error: any) {
            console.error("Error during Google Sheet load process:", error);
            setProcessingStatus("Error durante la carga.");
            toast({ variant: "destructive", title: "Error de Carga", description: error.message || "Error desconocido al cargar desde Google Sheet.", duration: 9000 });
        } finally {
            setIsProcessing(false);
            setProcessingStatus("");
            setUploadProgress(0);
            console.log("Google Sheet load process finished.");
        }
    }, [googleSheetUrl, toast, loadInitialData]);


  // --- Export and Filtering ---

  const handleExportDatabase = useCallback(() => {
     if (productDetails.length === 0) {
       toast({ title: "Base de Datos Vacía", description: "No hay detalles de producto para exportar." });
       return;
     }
     try {
         const csvData = convertDetailsToCSV(productDetails);
         const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" });
         const link = document.createElement("a");
         link.href = URL.createObjectURL(blob);
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         link.setAttribute("download", `product_database_details_${timestamp}.csv`);
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         toast({ title: "Exportación Iniciada", description: "Se ha iniciado la descarga del archivo CSV de detalles." });
     } catch (error) {
          console.error("Error exporting database details:", error);
          toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
     }
   }, [productDetails, toast]);

    // Converts product details data to CSV format string
    const convertDetailsToCSV = useCallback((data: ProductDetail[]) => {
        if (!data || data.length === 0) return "";
        const headers = ["barcode", "description", "provider"];
        const safeQuote = (field: any): string => {
            const str = String(field ?? '');
            const escapedStr = str.replace(/"/g, '""');
            return `"${escapedStr}"`;
        };
        const rows = data.map((detail) => [
            safeQuote(detail.barcode),
            safeQuote(detail.description),
            safeQuote(detail.provider),
        ]);
        return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    }, []);

    // Generate unique provider options from productDetails
    const providerOptions = React.useMemo(() => {
        const providers = new Set(productDetails.map(p => p.provider || "Desconocido").filter(Boolean));
        return ["all", ...Array.from(providers)].sort((a, b) => {
            if (a === 'all') return -1;
            if (b === 'all') return 1;
            return (a as string).localeCompare(b as string);
        });
    }, [productDetails]);

 // --- Count by Provider ---
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
    setProcessingStatus(`Buscando productos de ${selectedProviderFilter} en almacén ${currentWarehouseId}...`);

    try {
      // 1. Filter productDetails by selected provider
      const providerDetails = productDetails.filter(detail => (detail.provider || "Desconocido") === selectedProviderFilter);
      if (providerDetails.length === 0) {
        toast({ title: "Vacío", description: `No hay productos registrados para el proveedor ${selectedProviderFilter}.` });
        return;
      }

      // 2. Get inventory for the current warehouse
      const warehouseInventory = await getInventoryItemsForWarehouse(currentWarehouseId);
      const inventoryMap = new Map<string, InventoryItem>();
      warehouseInventory.forEach(item => inventoryMap.set(item.barcode, item));

      // 3. Create DisplayProduct list for the provider in the current warehouse
      const productsToCount: DisplayProduct[] = providerDetails.map(detail => {
        const inventory = inventoryMap.get(detail.barcode);
        return {
          ...detail,
          warehouseId: currentWarehouseId,
          stock: inventory?.stock ?? 0,
          count: 0, // Reset count for the new session
          lastUpdated: inventory?.lastUpdated,
        };
      });

      // 4. Call the callback function passed from Home to update the counting list
      onStartCountByProvider(productsToCount);

    } catch (error) {
      console.error("Error starting count by provider:", error);
      toast({ variant: "destructive", title: "Error", description: "No se pudo iniciar el conteo por proveedor." });
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  }, [selectedProviderFilter, productDetails, currentWarehouseId, onStartCountByProvider, toast]);


  // --- Render ---

  return (
    <div className="p-4 md:p-6 space-y-6">
       {/* --- Toolbar --- */}
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
                <SelectValue placeholder="Acciones" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Acciones</SelectLabel>
                  <SelectItem value="add">
                    Agregar Producto
                  </SelectItem>
                  <SelectItem value="export" disabled={productDetails.length === 0}>
                    Exportar Detalles
                  </SelectItem>
                  <SelectItem value="clear" disabled={(productDetails.length === 0 && inventoryItems.length === 0)}>Borrar Todo</SelectItem>
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
             {/* Add Count by Provider Button */}
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
              Cargar/Actualizar desde Google Sheet:
           </Label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
             <Input
             id="google-sheet-url"
             type="url"
             placeholder="URL de Hoja de Google (pública y compartida)"
             value={googleSheetUrl}
             onChange={handleGoogleSheetUrlChange}
             className="flex-grow h-10 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
             disabled={isProcessing || isLoading}
             aria-describedby="google-sheet-info"
             />
             <Button variant="secondary" disabled={isProcessing || isLoading || !googleSheetUrl} onClick={handleLoadFromGoogleSheet}>
                 <Upload className="mr-2 h-4 w-4" />
                 {isProcessing && processingStatus.includes("Google") ? 'Cargando...' : 'Cargar Datos'}
             </Button>
         </div>
         <p id="google-sheet-info" className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
               Asegúrese de que la hoja sea pública ('Cualquier persona con el enlace puede ver'). Se leerán las 4 primeras columnas por posición: 1:Código Barras, 2:Descripción, 3:Proveedor, 4:Stock (para almacén 'main').
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
              <p className="text-sm text-muted-foreground dark:text-gray-400 text-center mt-2">Cargando datos iniciales...</p>
         )}
          {typeof window !== 'undefined' && !window.indexedDB && (
              <Alert variant="destructive" className="my-4">
                  <AlertCircle className="h-4 w-4" />
                 <AlertTitle>Error Crítico</AlertTitle>
                 <AlertDescription>
                     Este navegador no soporta IndexedDB. La funcionalidad de base de datos local no está disponible.
                 </AlertDescription>
              </Alert>
          )}
       </div>

       {/* Confirmation Dialog */}
       <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
           <AlertDialogContent>
               <AlertDialogHeader>
                   <AlertDialogTitle>¿Estás realmente seguro?</AlertDialogTitle>
                   <AlertDialogDescription>
                       {alertAction === 'deleteProduct' && productToDeleteBarcode ?
                           `Estás a punto de eliminar permanentemente el producto con código "${productToDeleteBarcode}" y todo su inventario asociado. Esta acción no se puede deshacer.`
                           : alertAction === 'clearDatabase' ?
                               "Estás a punto de eliminar TODOS los productos y el inventario de la base de datos local permanentemente. Esta acción no se puede deshacer."
                               : "Esta acción no se puede deshacer."
                       }
                   </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                   <AlertDialogCancel onClick={() => setIsAlertOpen(false)}>Cancelar</AlertDialogCancel>
                   <AlertDialogAction
                       onClick={handleDeleteConfirmation}
                       className={cn(alertAction === 'clearDatabase' && "bg-red-600 hover:bg-red-700")}
                   >
                       {alertAction === 'deleteProduct' ? "Sí, Eliminar Producto" : alertAction === 'clearDatabase' ? "Sí, Borrar Todo" : "Confirmar"}
                   </AlertDialogAction>
               </AlertDialogFooter>
           </AlertDialogContent>
       </AlertDialog>

      {/* Products Table */}
       <ProductTable
           productDetails={productDetails}
           inventoryItems={inventoryItems}
           isLoading={isLoading}
           searchTerm={searchTerm}
           selectedProviderFilter={selectedProviderFilter}
           onEdit={handleOpenEditDialog}
       />

      {/* Add/Edit Product Dialog */}
      <EditProductDialog
          isOpen={isEditModalOpen}
          setIsOpen={setIsEditModalOpen}
          selectedDetail={selectedDetail}
          setSelectedDetail={setSelectedDetail}
          onSubmit={handleAddOrUpdateDetailSubmit}
          onDelete={triggerDeleteProductAlert} // Pass the trigger function
          isProcessing={isProcessing}
          initialStock={initialStockForEdit}
       />
    </div>
  );
};
