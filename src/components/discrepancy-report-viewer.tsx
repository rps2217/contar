// src/components/discrepancy-report-viewer.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getCountingHistory, getAllProductsFromDB } from '@/lib/database';
import type { CountingHistoryEntry, ProductDetail, DisplayProduct } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isValid as isValidDate, startOfDay, endOfDay } from 'date-fns';
import { es } from 'date-fns/locale'; // Import Spanish locale
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
import { Loader2, AlertCircle, Search, X, Download, CalendarIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa from 'papaparse';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DiscrepancyReportViewerProps {
  getWarehouseName: (warehouseId: string | null | undefined) => string;
}

interface DiscrepancyItem extends DisplayProduct {
  historyTimestamp: string;
  historyWarehouseName: string;
  difference: number;
}

export const DiscrepancyReportViewer: React.FC<DiscrepancyReportViewerProps> = ({ getWarehouseName }) => {
  const [historyEntries, setHistoryEntries] = useState<CountingHistoryEntry[]>([]);
  const [productDetailsMap, setProductDetailsMap] = useState<Map<string, ProductDetail>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedDateRange, setSelectedDateRange] = useState<{ from?: Date; to?: Date } | undefined>(undefined);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [history, dbProducts] = await Promise.all([
        getCountingHistory(),
        getAllProductsFromDB()
      ]);
      setHistoryEntries(history);
      const productMap = new Map(dbProducts.map(p => [p.barcode, p]));
      setProductDetailsMap(productMap);
    } catch (err: any) {
      console.error("Error loading data for discrepancy report:", err);
      setError("No se pudieron cargar los datos necesarios para el informe.");
      toast({
        variant: "destructive",
        title: "Error al Cargar Datos",
        description: err.message || "Ocurrió un error desconocido.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Process history entries to get discrepancy items
  const allDiscrepancyItems: DiscrepancyItem[] = useMemo(() => {
    return historyEntries.flatMap(entry =>
      entry.products
        .filter(product => (product.count ?? 0) !== (product.stock ?? 0)) // Only include discrepancies
        .map(product => {
          const detail = productDetailsMap.get(product.barcode);
          const difference = (product.count ?? 0) - (product.stock ?? 0);
          return {
            ...product,
            provider: detail?.provider || product.provider || 'Desconocido', // Ensure provider comes from DB if available
            description: detail?.description || product.description || `Producto ${product.barcode}`, // Ensure description comes from DB
            historyTimestamp: entry.timestamp,
            historyWarehouseName: getWarehouseName(entry.warehouseId),
            difference: difference,
          };
        })
    );
  }, [historyEntries, productDetailsMap, getWarehouseName]);

  // Filtered and sorted discrepancy items
  const filteredDiscrepancyItems = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();

    let filtered = allDiscrepancyItems.filter(item => {
      const matchesSearch = !searchTerm ||
                            item.description.toLowerCase().includes(lowerSearchTerm) ||
                            item.barcode.includes(lowerSearchTerm) ||
                            (item.provider || '').toLowerCase().includes(lowerSearchTerm);

      const matchesProvider = selectedProvider === 'all' || item.provider === selectedProvider;

      let matchesDate = true;
      if (selectedDateRange?.from) {
        const itemDate = parseISO(item.historyTimestamp);
        if (!isValidDate(itemDate)) {
           matchesDate = false; // Skip invalid dates
        } else {
           matchesDate = itemDate >= startOfDay(selectedDateRange.from);
           if (matchesDate && selectedDateRange.to) {
               matchesDate = itemDate <= endOfDay(selectedDateRange.to);
           }
        }
      }

      return matchesSearch && matchesProvider && matchesDate;
    });

    // Sort by history timestamp descending (newest first)
    filtered.sort((a, b) => new Date(b.historyTimestamp).getTime() - new Date(a.historyTimestamp).getTime());

    return filtered;
  }, [allDiscrepancyItems, searchTerm, selectedProvider, selectedDateRange]);


  // Get unique providers for the filter dropdown
  const providerOptions = useMemo(() => {
    const providers = new Set(allDiscrepancyItems.map(item => item.provider || "Desconocido"));
    const sortedProviders = Array.from(providers).sort((a, b) => a.localeCompare(b));
    return ["all", ...sortedProviders];
  }, [allDiscrepancyItems]);


  const handleExportReport = useCallback(() => {
    if (filteredDiscrepancyItems.length === 0) {
      toast({ title: "Vacío", description: "No hay discrepancias para exportar con los filtros actuales." });
      return;
    }

    try {
      const dataToExport = filteredDiscrepancyItems.map(item => ({
        "Fecha Informe": format(parseISO(item.historyTimestamp), 'yyyy-MM-dd HH:mm:ss', { locale: es }),
        "Almacén": item.historyWarehouseName,
        "Código Barras": item.barcode,
        "Descripción": item.description,
        "Proveedor": item.provider || 'N/A',
        "Stock Sistema": item.stock ?? 0,
        "Cantidad Contada": item.count ?? 0,
        "Diferencia": item.difference,
      }));

      const csv = Papa.unparse(dataToExport, { header: true });
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
      const fileName = `informe_discrepancias_${timestamp}.csv`;

      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast({ title: "Exportado", description: `Informe de discrepancias exportado a ${fileName}.` });

    } catch (error) {
      console.error("Error exporting discrepancy report:", error);
      toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV del informe." });
    }
  }, [filteredDiscrepancyItems, toast, es]);


  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">Informe de Discrepancias</h2>
        <Button
          variant="outline"
          onClick={handleExportReport}
          disabled={isLoading || filteredDiscrepancyItems.length === 0}
          className="w-full sm:w-auto"
        >
          <Download className="mr-2 h-4 w-4" />
          Descargar Informe Filtrado
        </Button>
      </div>

       {/* Filter Controls */}
       <div className="flex flex-col md:flex-row gap-4 p-4 border rounded-lg bg-card dark:bg-gray-800 shadow-sm">
           {/* Search Input */}
           <div className="relative flex-grow">
               <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
               <Input
                   type="search"
                   placeholder="Buscar por código, descripción, proveedor..."
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="pl-8 w-full"
                   aria-label="Buscar discrepancias"
               />
               {searchTerm && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7"
                        onClick={() => setSearchTerm("")}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
           </div>

           {/* Provider Filter */}
           <Select value={selectedProvider} onValueChange={setSelectedProvider}>
               <SelectTrigger className="w-full md:w-[200px]">
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

           {/* Date Range Filter */}
           <Popover>
                <PopoverTrigger asChild>
                    <Button
                        id="date"
                        variant={"outline"}
                        className={cn(
                            "w-full md:w-[260px] justify-start text-left font-normal",
                            !selectedDateRange && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {selectedDateRange?.from ? (
                            selectedDateRange.to ? (
                                <>
                                    {format(selectedDateRange.from, "LLL dd, y", { locale: es })} -{" "}
                                    {format(selectedDateRange.to, "LLL dd, y", { locale: es })}
                                </>
                            ) : (
                                format(selectedDateRange.from, "LLL dd, y", { locale: es })
                            )
                        ) : (
                            <span>Seleccionar Rango</span>
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={selectedDateRange?.from}
                        selected={selectedDateRange}
                        onSelect={setSelectedDateRange}
                        numberOfMonths={2}
                        locale={es} // Use Spanish locale for calendar
                    />
                    <div className="p-2 border-t">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedDateRange(undefined)}>Limpiar</Button>
                    </div>
                </PopoverContent>
            </Popover>
       </div>


      {isLoading && (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando informe...</span>
        </div>
      )}

      {error && !isLoading && (
         <Alert variant="destructive">
           <AlertCircle className="h-4 w-4" />
           <AlertTitle>Error</AlertTitle>
           <AlertDescription>{error}</AlertDescription>
         </Alert>
      )}

      {!isLoading && !error && allDiscrepancyItems.length === 0 && (
        <p className="text-center text-muted-foreground py-10">No hay discrepancias registradas en el historial.</p>
      )}

       {!isLoading && !error && allDiscrepancyItems.length > 0 && filteredDiscrepancyItems.length === 0 && (
         <p className="text-center text-muted-foreground py-10">No se encontraron discrepancias con los filtros aplicados.</p>
      )}

      {!isLoading && !error && filteredDiscrepancyItems.length > 0 && (
        <ScrollArea className="h-[calc(100vh-350px)] border rounded-lg shadow-sm bg-white dark:bg-gray-800">
          <Table>
             <TableCaption>Informe de discrepancias registradas.</TableCaption>
            <TableHeader className="sticky top-0 bg-gray-100 dark:bg-gray-700 z-10 shadow-sm">
              <TableRow>
                <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Fecha</TableHead>
                <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Almacén</TableHead>
                <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Código</TableHead>
                <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Descripción</TableHead>
                <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Proveedor</TableHead>
                <TableHead className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock</TableHead>
                <TableHead className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Contado</TableHead>
                <TableHead className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDiscrepancyItems.map((item, index) => (
                <TableRow key={`${item.historyTimestamp}-${item.barcode}-${index}`} className="text-sm hover:bg-muted/10 dark:hover:bg-gray-700/50 transition-colors">
                  <TableCell className="px-4 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                     {format(parseISO(item.historyTimestamp), 'PP p', { locale: es })}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-gray-600 dark:text-gray-300">{item.historyWarehouseName}</TableCell>
                  <TableCell className="px-4 py-2 font-mono text-gray-700 dark:text-gray-200">{item.barcode}</TableCell>
                  <TableCell className="px-4 py-2 text-gray-800 dark:text-gray-100">{item.description}</TableCell>
                  <TableCell className="px-4 py-2 text-gray-600 dark:text-gray-300">{item.provider}</TableCell>
                  <TableCell className="px-4 py-2 text-center tabular-nums text-gray-600 dark:text-gray-300">{item.stock ?? 0}</TableCell>
                  <TableCell className="px-4 py-2 text-center tabular-nums text-gray-600 dark:text-gray-300">{item.count ?? 0}</TableCell>
                  <TableCell
                      className={`px-4 py-2 text-center tabular-nums font-semibold ${
                        item.difference > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'
                      }`}
                  >
                    {item.difference > 0 ? `+${item.difference}` : item.difference}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  );
};
