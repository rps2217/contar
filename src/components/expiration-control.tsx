// src/components/expiration-control.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllProductsFromDB, addOrUpdateProductToDB } from '@/lib/database';
import type { ProductDetail } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, differenceInDays, addDays, isValid } from 'date-fns';
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
import { Loader2, AlertCircle, Search, Edit, CalendarIcon, Filter, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EditProductDialog } from '@/components/edit-product-dialog';
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

const EXPIRATION_THRESHOLD_SOON_DAYS = 30; // Products expiring in 30 days or less are "soon"
const EXPIRATION_THRESHOLD_VERY_SOON_DAYS = 7; // Products expiring in 7 days or less are "very soon"

export const ExpirationControl: React.FC = () => {
  const [products, setProducts] = useState<ProductDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "expired" | "soon" | "valid" | "no_date">("all");
  const [selectedProduct, setSelectedProduct] = useState<ProductDetail | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [dateFilter, setDateFilter] = useState<{ from?: Date; to?: Date } | undefined>(undefined);


  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const dbProducts = await getAllProductsFromDB();
      setProducts(dbProducts);
    } catch (err: any) {
      console.error("Error loading products for expiration control:", err);
      setError("No se pudo cargar la información de productos.");
      toast({
        variant: "destructive",
        title: "Error al Cargar Productos",
        description: err.message || "Ocurrió un error desconocido.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const getExpirationStatus = useCallback((expirationDate?: string): { status: "expired" | "very_soon" | "soon" | "valid" | "no_date"; daysLeft?: number; label: string; colorClass: string } => {
    if (!expirationDate) {
      return { status: "no_date", label: "Sin Fecha", colorClass: "text-gray-500 dark:text-gray-400" };
    }
    const today = new Date();
    today.setHours(0,0,0,0); // Normalize today to start of day
    
    let expDate: Date;
    try {
        expDate = parseISO(expirationDate); // Assumes YYYY-MM-DD
         if (!isValid(expDate)) {
            console.warn(`Invalid date string encountered: ${expirationDate}`);
            return { status: "no_date", label: "Fecha Inválida", colorClass: "text-orange-500 dark:text-orange-400" };
        }
    } catch(e) {
        console.warn(`Error parsing date string: ${expirationDate}`, e);
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

  const filteredAndSortedProducts = useMemo(() => {
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
            if (!isValid(expDate)) { // If date is invalid, don't match range
                matchesDateRange = p.expirationInfo.status === "no_date"; // only show if filter is no_date
            } else {
                matchesDateRange = expDate >= dateFilter.from;
                if (dateFilter.to && matchesDateRange) {
                    matchesDateRange = expDate <= endOfDay(dateFilter.to);
                }
            }
        } else if (dateFilter?.from && !p.expirationDate) { // Product has no date, but filter is active
            matchesDateRange = false;
        }


        return matchesSearch && matchesStatus && matchesDateRange;
      })
      .sort((a, b) => {
        // Primary sort: by days left (soonest first, then valid, then no_date)
        if (a.expirationInfo.status === "no_date" && b.expirationInfo.status !== "no_date") return 1;
        if (a.expirationInfo.status !== "no_date" && b.expirationInfo.status === "no_date") return -1;
        if (a.expirationInfo.status === "no_date" && b.expirationInfo.status === "no_date") return 0;

        // Both have dates
        const daysA = a.expirationInfo.daysLeft ?? Infinity; // Treat undefined days (valid far out) as very large
        const daysB = b.expirationInfo.daysLeft ?? Infinity;
        
        if (daysA !== daysB) {
            return daysA - daysB; // Sort by days left, ascending (expired first)
        }
        // Secondary sort: by description if days are equal
        return a.description.localeCompare(b.description);
      });
  }, [products, searchTerm, filterStatus, getExpirationStatus, dateFilter]);

  const handleEditProduct = useCallback((product: ProductDetail) => {
    setSelectedProduct(product);
    setIsEditModalOpen(true);
  }, []);

  const handleEditSubmit = useCallback(async (data: ProductDetail) => {
    setIsProcessing(true);
    try {
      await addOrUpdateProductToDB(data);
      toast({ title: "Producto Actualizado", description: `Se actualizó la fecha de vencimiento para ${data.description}.` });
      setIsEditModalOpen(false);
      setSelectedProduct(null);
      await loadProducts(); // Reload products to reflect changes
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error al Actualizar", description: error.message });
    } finally {
      setIsProcessing(false);
    }
  }, [toast, loadProducts]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">Control de Vencimientos</h2>
        {/* Add any high-level actions here if needed, e.g., export report */}
      </div>

      <div className="flex flex-col md:flex-row gap-4 p-4 border rounded-lg bg-card dark:bg-gray-800 shadow-sm items-center">
        <div className="relative flex-grow w-full md:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por producto, código, proveedor, fecha..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 w-full h-10"
              aria-label="Buscar productos por vencimiento"
            />
             {searchTerm && (
              <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setSearchTerm("")}>
                <X className="h-4 w-4" />
              </Button>
            )}
        </div>
        <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as any)}>
          <SelectTrigger className="w-full md:w-[180px] h-10">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Filtrar estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
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
      {!isLoading && !error && products.length === 0 && (
        <p className="text-center text-muted-foreground py-10">No hay productos en la base de datos.</p>
      )}
      {!isLoading && !error && products.length > 0 && filteredAndSortedProducts.length === 0 && (
          <p className="text-center text-muted-foreground py-10">No se encontraron productos con los filtros aplicados.</p>
      )}

      {!isLoading && !error && filteredAndSortedProducts.length > 0 && (
        <ScrollArea className="h-[calc(100vh-350px)] border rounded-lg shadow-sm bg-card dark:bg-gray-800">
          <Table>
            <TableCaption>Lista de productos y sus fechas de vencimiento.</TableCaption>
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
                <TableRow key={item.barcode} className="text-sm hover:bg-muted/10 transition-colors">
                  <TableCell className="px-3 py-2 font-mono">{item.barcode}</TableCell>
                  <TableCell className="px-3 py-2">{item.description}</TableCell>
                  <TableCell className="px-3 py-2">{item.provider || 'N/A'}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums">{item.stock ?? 0}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums">
                    {item.expirationDate ? format(parseISO(item.expirationDate), 'dd/MM/yyyy', {locale: es}) : 'N/A'}
                  </TableCell>
                  <TableCell className={cn("px-3 py-2 text-center tabular-nums", item.expirationInfo.colorClass)}>
                    {item.expirationInfo.label}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditProduct(item)}
                      title="Editar Fecha de Vencimiento"
                      className="h-8 w-8"
                    >
                      <Edit className="h-4 w-4" />
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
            context="expiration" // Specific context for expiration editing
            />
        )}
    </div>
  );
};
