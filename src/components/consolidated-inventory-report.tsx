
// src/components/consolidated-inventory-report.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Warehouse, DisplayProduct, ConsolidatedInventoryItem } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { getLocalStorageItem } from '@/lib/utils';
import { LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX } from '@/lib/constants';
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
import { Loader2, AlertCircle, Search, X, Download, Warehouse as WarehouseIconLucide } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa from 'papaparse';
import { format, parseISO, isValid as isValidDate } from 'date-fns';
import { es } from 'date-fns/locale';

interface ConsolidatedInventoryReportProps {
  warehouses: Warehouse[];
  currentUserId: string | null;
  getWarehouseName: (warehouseId: string | null | undefined) => string;
}

export const ConsolidatedInventoryReport: React.FC<ConsolidatedInventoryReportProps> = ({
  warehouses,
  currentUserId,
  getWarehouseName,
}) => {
  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedInventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");

  const loadAndProcessData = useCallback(async () => {
    if (!currentUserId || warehouses.length === 0) {
      setConsolidatedData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const productMap = new Map<string, ConsolidatedInventoryItem>();

      for (const warehouse of warehouses) {
        const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouse.id}_${currentUserId}`;
        const savedList: DisplayProduct[] = getLocalStorageItem<DisplayProduct[]>(savedListKey, []);

        if (Array.isArray(savedList)) {
          savedList.forEach(product => {
            if (!productMap.has(product.barcode)) {
              productMap.set(product.barcode, {
                barcode: product.barcode,
                description: product.description,
                provider: product.provider,
                totalSystemStock: 0,
                totalCountedQuantity: 0,
                consolidatedDifference: 0,
                warehousesPresent: [],
              });
            }
            const consolidatedItem = productMap.get(product.barcode)!;
            consolidatedItem.totalSystemStock += product.stock ?? 0;
            consolidatedItem.totalCountedQuantity += product.count ?? 0;
            if (!consolidatedItem.warehousesPresent.includes(getWarehouseName(warehouse.id))) {
              consolidatedItem.warehousesPresent.push(getWarehouseName(warehouse.id));
            }
          });
        }
      }

      const finalConsolidatedList = Array.from(productMap.values()).map(item => ({
        ...item,
        consolidatedDifference: item.totalCountedQuantity - item.totalSystemStock,
      }));

      setConsolidatedData(finalConsolidatedList);
    } catch (err: any) {
      console.error("Error processing consolidated inventory data:", err);
      setError("No se pudieron procesar los datos consolidados del inventario.");
      toast({
        variant: "destructive",
        title: "Error al Procesar Datos",
        description: err.message || "Ocurrió un error desconocido.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId, warehouses, getWarehouseName, toast]);

  useEffect(() => {
    loadAndProcessData();
  }, [loadAndProcessData]);

  const filteredReportData = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();
    if (!lowerSearchTerm) return consolidatedData;
    return consolidatedData.filter(item =>
      item.description.toLowerCase().includes(lowerSearchTerm) ||
      item.barcode.includes(lowerSearchTerm) ||
      (item.provider || '').toLowerCase().includes(lowerSearchTerm)
    );
  }, [consolidatedData, searchTerm]);

  const handleExportReport = useCallback(() => {
    if (filteredReportData.length === 0) {
      toast({ title: "Vacío", description: "No hay datos consolidados para exportar con los filtros actuales." });
      return;
    }
    try {
      const dataToExport = filteredReportData.map(item => ({
        "Código Barras": item.barcode,
        "Descripción": item.description,
        "Proveedor": item.provider,
        "Stock Sistema Total": item.totalSystemStock,
        "Cantidad Contada Total": item.totalCountedQuantity,
        "Diferencia Consolidada": item.consolidatedDifference,
        "Almacenes Involucrados": item.warehousesPresent.join(', '),
      }));

      const csv = Papa.unparse(dataToExport, { header: true });
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
      const fileName = `informe_consolidado_inventario_${timestamp}.csv`;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast({ title: "Exportado", description: `Informe consolidado exportado a ${fileName}.` });
    } catch (error) {
      console.error("Error exporting consolidated report:", error);
      toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
    }
  }, [filteredReportData, toast]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">Informe Consolidado de Inventario</h2>
        <Button
          variant="outline"
          onClick={handleExportReport}
          disabled={isLoading || filteredReportData.length === 0}
          className="w-full sm:w-auto"
        >
          <Download className="mr-2 h-4 w-4" />
          Descargar Informe
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar por código, descripción, proveedor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-8 w-full bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600"
          aria-label="Buscar en informe consolidado"
        />
        {searchTerm && (
          <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setSearchTerm("")}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando informe consolidado...</span>
        </div>
      )}
      {error && !isLoading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle> <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!isLoading && !error && consolidatedData.length === 0 && (
        <p className="text-center text-muted-foreground py-10">No hay datos de conteo en ningún almacén para generar un informe consolidado.</p>
      )}
      {!isLoading && !error && consolidatedData.length > 0 && filteredReportData.length === 0 && (
        <p className="text-center text-muted-foreground py-10">No se encontraron productos que coincidan con los filtros aplicados.</p>
      )}

      {!isLoading && !error && filteredReportData.length > 0 && (
        <ScrollArea className="h-[calc(100vh-350px)] border rounded-lg shadow-sm bg-card dark:bg-gray-800">
          <Table>
            <TableCaption>Informe consolidado del inventario contado en todos los almacenes.</TableCaption>
            <TableHeader className="sticky top-0 bg-muted/50 z-10 shadow-sm">
              <TableRow>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Código</TableHead>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Descripción</TableHead>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Proveedor</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Stock Sistema Total</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Cant. Contada Total</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Diferencia</TableHead>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Almacenes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReportData.map((item) => (
                <TableRow key={item.barcode} className="text-sm hover:bg-muted/10 transition-colors">
                  <TableCell className="px-3 py-2 font-mono">{item.barcode}</TableCell>
                  <TableCell className="px-3 py-2">{item.description}</TableCell>
                  <TableCell className="px-3 py-2">{item.provider}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums">{item.totalSystemStock}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums">{item.totalCountedQuantity}</TableCell>
                  <TableCell className={`px-3 py-2 text-center tabular-nums font-semibold ${item.consolidatedDifference > 0 ? 'text-yellow-600 dark:text-yellow-400' : item.consolidatedDifference < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {item.consolidatedDifference > 0 ? `+${item.consolidatedDifference}` : item.consolidatedDifference === 0 ? 'OK' : item.consolidatedDifference}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-xs">
                    {item.warehousesPresent.join(', ')}
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
