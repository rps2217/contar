// src/components/expiration-control.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getAllProductsFromDB, addOrUpdateProductToDB } from '@/lib/database'; // Removed deleteProductFromDB
import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, differenceInDays, isValid as isValidDate, endOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertCircle, Search, Edit, CalendarIcon, Filter, X, PackageSearch, Trash } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EditProductDialog } from '@/components/edit-product-dialog';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

const EXPIRATION_THRESHOLD_SOON_DAYS = 30; // Products expiring in 30 days or less are "soon"
const EXPIRATION_THRESHOLD_VERY_SOON_DAYS = 7; // Products expiring in 7 days or less are "very soon"

export const ExpirationControl: React.FC = () => {
  const [products, setProducts] = useState<ProductDetail[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "expired" | "soon" | "valid" | "no_date">("all");
  const [selectedProduct, setSelectedProduct] = useState<ProductDetail | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dateFilter, setDateFilter] = useState<{ from?: Date; to?: Date } | undefined>(undefined);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<ProductDetail | null>(null);


  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const dbProducts = await getAllProductsFromDB();
      setProducts(dbProducts);
    } catch (err: any) {
      console.error("Error loading products for expiration control:", err);
      setError("No se pudo cargar la información de productos.");
      if (typeof window !== 'undefined') {
        toast({
          variant: "destructive",
          title: "Error al Cargar Productos",
          description: err.message || "Ocurrió un error desconocido.",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (hasUserInteracted || searchTerm || filterStatus !== "all" || dateFilter) {
      loadProducts();
    }
  }, [loadProducts, hasUserInteracted, searchTerm, filterStatus, dateFilter]);

  useEffect(() => {
    if (barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, []);


  const getExpirationStatus = useCallback((expirationDate?: string): { status: "expired" | "very_soon" | "soon" | "valid" | "no_date"; daysLeft?: number; label: string; colorClass: string } => {
    if (!expirationDate) {
      return { status: "no_date", label: "Sin Fecha", colorClass: "text-muted-foreground" };
    }
    const today = new Date();
    today.setHours(0,0,0,0);

    let expDate: Date;
    try {
        expDate = parseISO(expirationDate);
         if (!isValidDate(expDate)) {
            return { status: "no_date", label: "Fecha Inválida", colorClass: "text-orange-500 dark:text-orange-400" };
        }
    } catch(e) {
        return { status: "no_date", label: "Error Fecha", colorClass: "text-orange-500 dark:text-orange-400" };
    }

    const days = differenceInDays(expDate, today);

    if (days < 0) {
      return { status: "expired", daysLeft: days, label: `Vencido (hace ${Math.abs(days)} días)`, colorClass: "text-red-600 dark:text-red-400 font-semibold" };
    }
    if (days <= EXPIRATION_THRESHOLD_VERY_SOON_DAYS) {
      return { status: "very_soon", daysLeft: days, label: `Vence Muy Pronto (${days} días)`, colorClass: "text-yellow-600 dark:text-yellow-400 font-medium" };
    }
    if (days <= EXPIRATION_THRESHOLD_SOON_DAYS) {
      return { status: "soon", daysLeft: days, label: `Vence Pronto (${days} días)`, colorClass: "text-amber-600 dark:text-amber-400" };
    }
    return { status: "valid", daysLeft: days, label: `Válido (${days} días)`, colorClass: "text-green-600 dark:text-green-400" };
  }, []);

  const handleBarcodeSubmit = useCallback(() => {
    if (!barcodeInput.trim()) {
      toast({ title: "Código Vacío", description: "Por favor, ingrese un código de barras." });
      return;
    }
    if (!hasUserInteracted) setHasUserInteracted(true); 

    const foundProduct = products.find(p => p.barcode === barcodeInput.trim());
    if (foundProduct) {
      setSelectedProduct(foundProduct);
      setIsEditModalOpen(true);
    } else {
      toast({ variant: "default", title: "Producto no encontrado", description: `El producto con código ${barcodeInput.trim()} no existe en la base de datos.` });
    }
    setBarcodeInput("");
    barcodeInputRef.current?.focus();
  }, [barcodeInput, products, toast, hasUserInteracted]);

  const filteredAndSortedProducts = useMemo(() => {
    if (!hasUserInteracted && products.length === 0 && searchTerm === "" && filterStatus === "all" && !dateFilter) {
        return [];
    }

    const lowerSearchTerm = searchTerm.toLowerCase();
    
    return products
      .map(p => ({ ...p, expirationInfo: getExpirationStatus(p.expirationDate) }))
      .filter(p => {
        const matchesSearch = !searchTerm ||
                              p.description.toLowerCase().includes(lowerSearchTerm) ||
                              p.barcode.includes(lowerSearchTerm) ||
                              (p.provider || '').toLowerCase().includes(lowerSearchTerm) ||
                              (p.expirationDate || '').includes(lowerSearchTerm) ||
                              p.expirationInfo.label.toLowerCase().includes(lowerSearchTerm);

        const matchesStatus = filterStatus === "all" ||
                              (filterStatus === "expired" && p.expirationInfo.status === "expired") ||
                              (filterStatus === "soon" && (p.expirationInfo.status === "soon" || p.expirationInfo.status === "very_soon")) ||
                              (filterStatus === "valid" && p.expirationInfo.status === "valid") ||
                              (filterStatus === "no_date" && (p.expirationInfo.status === "no_date"));
        
        let matchesDateRange = true;
        if (dateFilter?.from && p.expirationDate) {
            const expDate = parseISO(p.expirationDate);
            if (!isValidDate(expDate)) {
                matchesDateRange = p.expirationInfo.status === "no_date"; 
            } else {
                matchesDateRange = expDate >= dateFilter.from;
                if (dateFilter.to && matchesDateRange) {
                    matchesDateRange = expDate <= endOfDay(dateFilter.to);
                }
            }
        } else if (dateFilter?.from && !p.expirationDate && filterStatus !== 'no_date') { 
            matchesDateRange = false;
        }


        return matchesSearch && matchesStatus && matchesDateRange;
      })
      .sort((a, b) => {
        if (a.expirationInfo.status === "no_date" && b.expirationInfo.status !== "no_date") return 1;
        if (a.expirationInfo.status !== "no_date" && b.expirationInfo.status === "no_date") return -1;
        if (a.expirationInfo.status === "no_date" && b.expirationInfo.status === "no_date") {
             return a.description.localeCompare(b.description);
        }
        
        const daysA = a.expirationInfo.daysLeft ?? Infinity;
        const daysB = b.expirationInfo.daysLeft ?? Infinity;
        
        if (daysA !== daysB) {
            return daysA - daysB;
        }
        return a.description.localeCompare(b.description);
      });
  }, [products, searchTerm, filterStatus, getExpirationStatus, dateFilter, hasUserInteracted]);

  const handleEditProduct = useCallback((product: ProductDetail) => {
    setSelectedProduct(product);
    setIsEditModalOpen(true);
  }, []);

  const handleEditSubmit = useCallback(async (data: ProductDetail) => {
    setIsProcessing(true);
    try {
      await addOrUpdateProductToDB(data);
       if (typeof window !== 'undefined') {
        toast({ title: "Producto Actualizado", description: `Se actualizó la información para ${data.description}.` });
      }
      setIsEditModalOpen(false);
      setSelectedProduct(null);
      await loadProducts(); 
    } catch (error: any) {
       if (typeof window !== 'undefined') {
        toast({ variant: "destructive", title: "Error al Actualizar", description: error.message });
      }
    } finally {
      setIsProcessing(false);
      barcodeInputRef.current?.focus();
    }
  }, [toast, loadProducts]);

  const handleDeleteRequest = useCallback((product: ProductDetail) => {
    setProductToDelete(product);
    setIsDeleteDialogOpen(true);
  }, []);

  const confirmProductDelete = useCallback(async () => {
    if (!productToDelete) return;
    setIsProcessing(true);
    try {
      // Only remove from the local list in this module
      setProducts(prev => prev.filter(p => p.barcode !== productToDelete.barcode));
      toast({
        title: 'Producto Eliminado (Gestión Vencimientos)',
        description: `El producto "${productToDelete.description}" ha sido eliminado de esta lista de gestión. No se ha eliminado de la base de datos principal.`,
      });
      setIsDeleteDialogOpen(false);
      setProductToDelete(null);
    } catch (error: any) { // Should not error if only updating local state
      toast({
        variant: 'destructive',
        title: 'Error al Eliminar de la Lista',
        description: `No se pudo eliminar el producto de esta lista: ${error.message}`,
      });
    } finally {
      setIsProcessing(false);
      barcodeInputRef.current?.focus();
    }
  }, [productToDelete, toast]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">Control de Vencimientos</h2>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <Input
          ref={barcodeInputRef}
          type="text" 
          placeholder="Ingresar código de barras para buscar/editar..."
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleBarcodeSubmit(); }}
          className="sm:mr-2 flex-grow bg-yellow-100 dark:bg-yellow-900 border-teal-300 dark:border-teal-700 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm h-10"
          aria-label="Ingresar código de barras"
        />
        <Button
          onClick={handleBarcodeSubmit}
          variant="outline"
          className={cn(
            "h-10 px-5 py-2", 
            "text-teal-600 border-teal-500 hover:bg-teal-50 dark:text-teal-400 dark:border-teal-600 dark:hover:bg-teal-900/50"
          )}
          aria-label="Buscar producto por código"
          disabled={!barcodeInput.trim()}
        >
          Buscar/Editar
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 p-4 border rounded-lg bg-card dark:bg-gray-800 shadow-sm items-center">
        <div className="relative flex-grow w-full md:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por producto, código, proveedor, fecha..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); if (!hasUserInteracted) setHasUserInteracted(true); }}
              className="pl-8 w-full h-10"
              aria-label="Buscar productos por vencimiento"
            />
             {searchTerm && (
              <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setSearchTerm("")}>
                <X className="h-4 w-4" />
              </Button>
            )}
        </div>
        <Select value={filterStatus} onValueChange={(value) => { setFilterStatus(value as any); if (!hasUserInteracted) setHasUserInteracted(true); }}>
          <SelectTrigger className="w-full md:w-[180px] h-10">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Filtrar estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los Estados</SelectItem>
            <SelectItem value="expired">Vencidos</SelectItem>
            <SelectItem value="soon">Próximos a Vencer</SelectItem>
            <SelectItem value="valid">Válidos</SelectItem>
            <SelectItem value="no_date">Sin Fecha</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date-filter-popover"
                variant={"outline"}
                className={cn("w-full md:w-[260px] h-10 justify-start text-left font-normal", !dateFilter && "text-muted-foreground")}
                onClick={() => { if (!hasUserInteracted) setHasUserInteracted(true); }}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFilter?.from ? (
                  dateFilter.to ? (
                    <>{format(dateFilter.from, "LLL dd, y", { locale: es })} - {format(dateFilter.to, "LLL dd, y", { locale: es })}</>
                  ) : (format(dateFilter.from, "LLL dd, y", { locale: es }))
                ) : (<span>Rango de Vencimiento</span>)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateFilter?.from}
                selected={dateFilter}
                onSelect={setDateFilter}
                numberOfMonths={2}
                locale={es}
              />
               <div className="p-2 border-t flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setDateFilter(undefined)}>Limpiar</Button>
              </div>
            </PopoverContent>
          </Popover>
         <Button onClick={() => loadProducts()} variant="outline" className="h-10" title="Forzar recarga de productos">
            <PackageSearch className="mr-2 h-4 w-4" /> Recargar
         </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando productos...</span>
        </div>
      )}
      {error && !isLoading && (
         <Alert variant="destructive">
           <AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle> <AlertDescription>{error}</AlertDescription>
         </Alert>
      )}
      
      {!isLoading && !error && !hasUserInteracted && products.length === 0 && (
         <p className="text-center text-muted-foreground py-10">Utilice los filtros o ingrese un código para buscar productos y ver su estado de vencimiento.</p>
      )}
      {!isLoading && !error && hasUserInteracted && products.length === 0 && (
          <p className="text-center text-muted-foreground py-10">No hay productos en la base de datos que coincidan con su búsqueda o la base de datos está vacía.</p>
      )}
       {!isLoading && !error && hasUserInteracted && products.length > 0 && filteredAndSortedProducts.length === 0 && (
          <p className="text-center text-muted-foreground py-10">No se encontraron productos con los filtros aplicados.</p>
      )}


      {!isLoading && !error && filteredAndSortedProducts.length > 0 && (
        <ScrollArea className="h-[calc(100vh-450px)] md:h-[calc(100vh-420px)] border rounded-lg shadow-sm bg-card dark:bg-gray-800">
          <Table>
            <TableCaption>Lista de productos y sus fechas de vencimiento. Haga clic en un producto para editar.</TableCaption>
            <TableHeader className="sticky top-0 bg-muted/50 z-10 shadow-sm">
              <TableRow>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Código</TableHead>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Descripción</TableHead>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Proveedor</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Stock (DB)</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Fecha Vencimiento</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Estado</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedProducts.map((item) => (
                <TableRow 
                  key={item.barcode} 
                  className="text-sm hover:bg-muted/10 transition-colors cursor-pointer"
                  onClick={() => handleEditProduct(item)}
                >
                  <TableCell className="px-3 py-2 font-mono">{item.barcode}</TableCell>
                  <TableCell className="px-3 py-2">{item.description}</TableCell>
                  <TableCell className="px-3 py-2">{item.provider || 'N/A'}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums">{item.stock ?? 0}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums">
                    {item.expirationDate && isValidDate(parseISO(item.expirationDate)) ? format(parseISO(item.expirationDate), 'dd/MM/yyyy', {locale: es}) : 'N/A'}
                  </TableCell>
                  <TableCell className={cn("px-3 py-2 text-center tabular-nums", item.expirationInfo.colorClass)}>
                    {item.expirationInfo.label}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleEditProduct(item);}} 
                      title="Editar Fecha de Vencimiento"
                      className="h-8 w-8 text-blue-600 hover:text-blue-700"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleDeleteRequest(item); }}
                      title="Eliminar Producto de esta Lista"
                      className="h-8 w-8 text-red-600 hover:text-red-700"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
       {selectedProduct && (
            <EditProductDialog
            isOpen={isEditModalOpen}
            setIsOpen={setIsEditModalOpen}
            selectedDetail={selectedProduct}
            setSelectedDetail={setSelectedProduct}
            onSubmit={handleEditSubmit}
            isProcessing={isProcessing}
            context="expiration"
            initialStock={selectedProduct.stock} 
            // onDelete is not passed here, so the dialog won't show DB delete for expiration context
            />
        )}
         <ConfirmationDialog
            isOpen={isDeleteDialogOpen}
            onOpenChange={setIsDeleteDialogOpen}
            title="Confirmar Eliminación de Lista"
            description={
              productToDelete ? (
                <>
                  ¿Estás seguro de que deseas eliminar el producto
                  <span className="font-semibold"> "{productToDelete.description}" (Código: {productToDelete.barcode})</span>
                  de la lista de gestión de vencimientos? Esto no lo eliminará de la base de datos principal.
                </>
              ) : (
                '¿Estás seguro de que deseas eliminar este producto de la lista?'
              )
            }
            confirmText="Sí, Eliminar de Lista"
            onConfirm={confirmProductDelete}
            onCancel={() => {
              setIsDeleteDialogOpen(false);
              setProductToDelete(null);
            }}
            isDestructive={true}
            isProcessing={isProcessing}
        />
    </div>
  );
};
