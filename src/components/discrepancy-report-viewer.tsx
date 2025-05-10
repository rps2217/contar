// src/components/discrepancy-report-viewer.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getCountingHistory, getAllProductsFromDB } from '@/lib/database';
import type { CountingHistoryEntry, ProductDetail } from '@/types/product'; // DisplayProduct might not be directly needed here for the final report structure
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isValid as isValidDate, startOfDay, endOfDay, min, max } from 'date-fns';
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
import { Loader2, AlertCircle, Search, X, Download, CalendarIcon, Users, Warehouse, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa from 'papaparse';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";


interface DiscrepancyReportViewerProps {
  getWarehouseName: (warehouseId: string | null | undefined) => string;
}

interface ConsolidatedDiscrepancyItem {
  barcode: string;
  description: string;
  provider: string;
  totalHistoricStock: number;
  totalHistoricCounted: number;
  totalConsolidatedDifference: number;
  warehousesInvolved: string[];
  usersInvolved: string[];
  firstOccurrenceDate?: string;
  lastOccurrenceDate?: string;
  occurrenceCount: number; // How many times this product showed a discrepancy
}

export const DiscrepancyReportViewer: React.FC<DiscrepancyReportViewerProps> = ({ getWarehouseName }) => {
  const [historyEntries, setHistoryEntries] = useState<CountingHistoryEntry[]>([]);
  const [productDetailsMap, setProductDetailsMap] = useState<Map<string, ProductDetail>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedDateRange, setSelectedDateRange] = useState<{ from?: Date; to?: Date } | undefined>(undefined);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [history, dbProducts] = await Promise.all([
        getCountingHistory(), // Fetches all history; user filtering could be added here or client-side
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

  const consolidatedReportData = useMemo(() => {
    if (historyEntries.length === 0 || productDetailsMap.size === 0) {
      return [];
    }

    const dateFilteredHistory = historyEntries.filter(entry => {
      if (!selectedDateRange?.from) return true;
      const entryDate = parseISO(entry.timestamp);
      if (!isValidDate(entryDate)) return false;
      let matches = entryDate >= startOfDay(selectedDateRange.from);
      if (matches && selectedDateRange.to) {
        matches = entryDate <= endOfDay(selectedDateRange.to);
      }
      return matches;
    });

    const consolidationMap = new Map<string, {
      sumStock: number;
      sumCount: number;
      warehouses: Set<string>;
      users: Set<string>;
      dates: Date[];
      occurrences: number;
    }>();

    dateFilteredHistory.forEach(entry => {
      entry.products.forEach(product => {
        if ((product.count ?? 0) !== (product.stock ?? 0)) { // Only consider discrepancies
          const barcode = product.barcode;
          if (!consolidationMap.has(barcode)) {
            consolidationMap.set(barcode, {
              sumStock: 0,
              sumCount: 0,
              warehouses: new Set(),
              users: new Set(),
              dates: [],
              occurrences: 0,
            });
          }
          const item = consolidationMap.get(barcode)!;
          item.sumStock += product.stock ?? 0;
          item.sumCount += product.count ?? 0;
          item.warehouses.add(getWarehouseName(entry.warehouseId));
          if (entry.userId) item.users.add(entry.userId);
          if (isValidDate(parseISO(entry.timestamp))) {
            item.dates.push(parseISO(entry.timestamp));
          }
          item.occurrences += 1;
        }
      });
    });

    const result: ConsolidatedDiscrepancyItem[] = [];
    consolidationMap.forEach((value, barcode) => {
      const detail = productDetailsMap.get(barcode);
      if (detail) {
        const sortedDates = value.dates.sort((a,b) => a.getTime() - b.getTime());
        result.push({
          barcode: barcode,
          description: detail.description || `Producto ${barcode}`,
          provider: detail.provider || 'Desconocido',
          totalHistoricStock: value.sumStock,
          totalHistoricCounted: value.sumCount,
          totalConsolidatedDifference: value.sumCount - value.sumStock,
          warehousesInvolved: Array.from(value.warehouses),
          usersInvolved: Array.from(value.users),
          firstOccurrenceDate: sortedDates.length > 0 ? format(sortedDates[0], 'yyyy-MM-dd', { locale: es }) : undefined,
          lastOccurrenceDate: sortedDates.length > 0 ? format(sortedDates[sortedDates.length - 1], 'yyyy-MM-dd', { locale: es }) : undefined,
          occurrenceCount: value.occurrences,
        });
      }
    });
    // Sort by largest absolute difference, then by description
    return result.sort((a,b) => Math.abs(b.totalConsolidatedDifference) - Math.abs(a.totalConsolidatedDifference) || a.description.localeCompare(b.description));
  }, [historyEntries, productDetailsMap, selectedDateRange, getWarehouseName]);

  const filteredConsolidatedReport = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    return consolidatedReportData.filter(item => {
      const matchesProvider = selectedProvider === 'all' || item.provider === selectedProvider;
      const matchesSearch = !searchTerm ||
                            item.description.toLowerCase().includes(lowerSearchTerm) ||
                            item.barcode.includes(lowerSearchTerm) ||
                            (item.provider || '').toLowerCase().includes(lowerSearchTerm);
      return matchesProvider && matchesSearch;
    });
  }, [consolidatedReportData, searchTerm, selectedProvider]);

  const providerOptions = useMemo(() => {
    const providers = new Set(productDetailsMap.values().map(p => p.provider || "Desconocido"));
    const sortedProviders = Array.from(providers).sort((a, b) => a.localeCompare(b));
    return ["all", ...sortedProviders];
  }, [productDetailsMap]);

  const handleExportReport = useCallback(() => {
    if (filteredConsolidatedReport.length === 0) {
      toast({ title: "Vacío", description: "No hay discrepancias consolidadas para exportar con los filtros actuales." });
      return;
    }
    try {
      const dataToExport = filteredConsolidatedReport.map(item => ({
        "Código Barras": item.barcode,
        "Descripción": item.description,
        "Proveedor": item.provider,
        "Stock Histórico Total": item.totalHistoricStock,
        "Cantidad Contada Total": item.totalHistoricCounted,
        "Diferencia Consolidada Total": item.totalConsolidatedDifference,
        "Nº Ocurrencias": item.occurrenceCount,
        "Almacenes Involucrados": item.warehousesInvolved.join(', '),
        "Usuarios Involucrados": item.usersInvolved.join(', '),
        "Primera Ocurrencia": item.firstOccurrenceDate || 'N/A',
        "Última Ocurrencia": item.lastOccurrenceDate || 'N/A',
      }));

      const csv = Papa.unparse(dataToExport, { header: true });
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
      const fileName = `informe_discrepancias_consolidadas_${timestamp}.csv`;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast({ title: "Exportado", description: `Informe consolidado exportado a ${fileName}.` });
    } catch (error) {
      console.error("Error exporting consolidated discrepancy report:", error);
      toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV del informe consolidado." });
    }
  }, [filteredConsolidatedReport, toast]);

  return (
    <TooltipProvider>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-2xl font-bold">Informe Consolidado de Discrepancias</h2>
          <Button
            variant="outline"
            onClick={handleExportReport}
            disabled={isLoading || filteredConsolidatedReport.length === 0}
            className="w-full sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />
            Descargar Informe
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 p-4 border rounded-lg bg-card dark:bg-gray-800 shadow-sm">
          <div className="relative flex-grow">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por código, descripción, proveedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 w-full"
              aria-label="Buscar discrepancias consolidadas"
            />
            {searchTerm && (
              <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7" onClick={() => setSearchTerm("")}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
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
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date-consolidated"
                variant={"outline"}
                className={cn("w-full md:w-[260px] justify-start text-left font-normal", !selectedDateRange && "text-muted-foreground")}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {selectedDateRange?.from ? (
                  selectedDateRange.to ? (
                    <>{format(selectedDateRange.from, "LLL dd, y", { locale: es })} - {format(selectedDateRange.to, "LLL dd, y", { locale: es })}</>
                  ) : (format(selectedDateRange.from, "LLL dd, y", { locale: es }))
                ) : (<span>Seleccionar Rango</span>)}
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
                locale={es}
              />
              <div className="p-2 border-t"><Button variant="ghost" size="sm" onClick={() => setSelectedDateRange(undefined)}>Limpiar</Button></div>
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
            <AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle> <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && consolidatedReportData.length === 0 && (
          <p className="text-center text-muted-foreground py-10">No hay discrepancias registradas en el historial que coincidan con el rango de fechas seleccionado.</p>
        )}
        {!isLoading && !error && consolidatedReportData.length > 0 && filteredConsolidatedReport.length === 0 && (
          <p className="text-center text-muted-foreground py-10">No se encontraron discrepancias consolidadas con los filtros aplicados.</p>
        )}

        {!isLoading && !error && filteredConsolidatedReport.length > 0 && (
          <ScrollArea className="h-[calc(100vh-400px)] border rounded-lg shadow-sm bg-card dark:bg-gray-800">
            <Table>
              <TableCaption>Informe consolidado de discrepancias de productos.</TableCaption>
              <TableHeader className="sticky top-0 bg-muted/50 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Código</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Descripción</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Proveedor</TableHead>
                  <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">
                     <Tooltip>
                        <TooltipTrigger className="cursor-help inline-flex items-center">Stock Hist. <Info className="ml-1 h-3 w-3" /></TooltipTrigger>
                        <TooltipContent><p>Suma del stock registrado en cada<br/>conteo donde hubo discrepancia.</p></TooltipContent>
                     </Tooltip>
                  </TableHead>
                  <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">
                     <Tooltip>
                        <TooltipTrigger className="cursor-help inline-flex items-center">Contado Hist. <Info className="ml-1 h-3 w-3" /></TooltipTrigger>
                        <TooltipContent><p>Suma de lo contado en cada<br/>conteo donde hubo discrepancia.</p></TooltipContent>
                     </Tooltip>
                  </TableHead>
                  <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Diferencia</TableHead>
                  <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Ocurrencias</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Almacenes</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Usuarios</TableHead>
                  <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Fechas (Primera-Última)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConsolidatedReport.map((item) => (
                  <TableRow key={item.barcode} className="text-sm hover:bg-muted/10 transition-colors">
                    <TableCell className="px-3 py-2 font-mono">{item.barcode}</TableCell>
                    <TableCell className="px-3 py-2">{item.description}</TableCell>
                    <TableCell className="px-3 py-2">{item.provider}</TableCell>
                    <TableCell className="px-3 py-2 text-center tabular-nums">{item.totalHistoricStock}</TableCell>
                    <TableCell className="px-3 py-2 text-center tabular-nums">{item.totalHistoricCounted}</TableCell>
                    <TableCell className={`px-3 py-2 text-center tabular-nums font-semibold ${item.totalConsolidatedDifference > 0 ? 'text-yellow-600 dark:text-yellow-400' : item.totalConsolidatedDifference < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {item.totalConsolidatedDifference > 0 ? `+${item.totalConsolidatedDifference}` : item.totalConsolidatedDifference}
                    </TableCell>
                     <TableCell className="px-3 py-2 text-center tabular-nums">{item.occurrenceCount}</TableCell>
                    <TableCell className="px-3 py-2 text-xs">
                      {item.warehousesInvolved.length > 2 ? (
                        <Tooltip>
                          <TooltipTrigger>{item.warehousesInvolved.slice(0,2).join(', ')}... ({item.warehousesInvolved.length})</TooltipTrigger>
                          <TooltipContent className="max-w-xs break-words"><p>{item.warehousesInvolved.join(', ')}</p></TooltipContent>
                        </Tooltip>
                      ) : (item.warehousesInvolved.join(', ') || 'N/A')}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-xs">
                       {item.usersInvolved.length > 1 ? (
                        <Tooltip>
                          <TooltipTrigger>{item.usersInvolved.slice(0,1).join(', ')}... ({item.usersInvolved.length})</TooltipTrigger>
                          <TooltipContent className="max-w-xs break-words"><p>{item.usersInvolved.join(', ')}</p></TooltipContent>
                        </Tooltip>
                      ) : (item.usersInvolved.join(', ') || 'N/A')}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-xs whitespace-nowrap">
                      {item.firstOccurrenceDate}{item.lastOccurrenceDate && item.firstOccurrenceDate !== item.lastOccurrenceDate ? ` - ${item.lastOccurrenceDate}` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </div>
    </TooltipProvider>
  );
};