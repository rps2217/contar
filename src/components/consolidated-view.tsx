// src/components/consolidated-view.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Warehouse, ProductDetail, DisplayProduct, ConsolidatedProductViewItem } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { getLocalStorageItem, cn } from '@/lib/utils';
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
import { Loader2, AlertCircle, Search, X, Download, Library } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa from 'papaparse';
import { format } from 'date-fns';

interface ConsolidatedViewProps {
  catalogProducts: ProductDetail[];
  warehouses: Warehouse[];
  currentUserId: string | null;
}

export const ConsolidatedView: React.FC<ConsolidatedViewProps> = ({
  catalogProducts,
  warehouses,
  currentUserId,
}) => {
  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedProductViewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");

  const getWarehouseNameById = useCallback((warehouseId: string) => {
    const warehouse = warehouses.find(w => w.id === warehouseId);
    return warehouse ? warehouse.name : warehouseId;
  }, [warehouses]);

  const loadAndProcessData = useCallback(async () => {
    if (!currentUserId || warehouses.length === 0) {
      setConsolidatedData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const productMap = new Map<string, ConsolidatedProductViewItem>();

      // Step 1: Initialize with catalog products
      catalogProducts.forEach(product => {
        productMap.set(product.barcode, {
          barcode: product.barcode,
          description: product.description,
          provider: product.provider,
          masterStock: product.stock ?? 0,
          totalCountedQuantity: 0,
          warehousesPresent: [],
        });
      });

      // Step 2: Aggregate counted quantities from localStorage
      for (const warehouse of warehouses) {
        const savedListKey = `${LOCAL_STORAGE_COUNTING_LIST_KEY_PREFIX}${warehouse.id}_${currentUserId}`;
        const savedList: DisplayProduct[] = getLocalStorageItem<DisplayProduct[]>(savedListKey, []);

        if (Array.isArray(savedList)) {
          savedList.forEach(countedProduct => {
            let consolidatedItem = productMap.get(countedProduct.barcode);
            if (!consolidatedItem) {
              // Product was counted but not in catalog, add it
              consolidatedItem = {
                barcode: countedProduct.barcode,
                description: countedProduct.description || `Producto Desconocido (${countedProduct.barcode})`,
                provider: countedProduct.provider || "Desconocido",
                masterStock: countedProduct.stock ?? 0, // Use stock from counting list if not in catalog
                totalCountedQuantity: 0,
                warehousesPresent: [],
              };
              productMap.set(countedProduct.barcode, consolidatedItem);
            }

            consolidatedItem.totalCountedQuantity += countedProduct.count ?? 0;
            const warehouseName = getWarehouseNameById(warehouse.id);
            if (!consolidatedItem.warehousesPresent.includes(warehouseName)) {
              consolidatedItem.warehousesPresent.push(warehouseName);
            }
          });
        }
      }

      const finalConsolidatedList = Array.from(productMap.values());
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
  }, [currentUserId, warehouses, catalogProducts, getWarehouseNameById, toast]);

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
      toast({ title: "Vacío", description: "No hay datos consolidados para exportar." });
      return;
    }
    try {
      const dataToExport = filteredReportData.map(item => ({
        "Código Barras": item.barcode,
        "Descripción": item.description,
        "Proveedor": item.provider || 'N/A',
        "Stock Catálogo": item.masterStock,
        "Cantidad Contada Total": item.totalCountedQuantity,
        "Almacenes Involucrados": item.warehousesPresent.join(', '),
      }));

      const csv = Papa.unparse(dataToExport, { header: true });
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
      const fileName = `informe_consolidado_stock_${timestamp}.csv`;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast({ title: "Exportado", description: `Informe consolidado exportado.` });
    } catch (error) {
      console.error("Error exporting consolidated report:", error);
      toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV." });
    }
  }, [filteredReportData, toast]);

  return (
    <div className="p-4 md:p-6 space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold flex items-center"><Library className="mr-2 h-6 w-6" />Informe Consolidado de Inventario</h2>
        <Button
          variant="outline"
          onClick={handleExportReport}
          disabled={isLoading || filteredReportData.length === 0}
          className="w-full sm:w-auto"
        >
          <Download className="mr-2 h-4 w-4" />
          Exportar a CSV
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar por código, descripción, proveedor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-8 w-full bg-background border-input"
          aria-label="Buscar en informe consolidado"
        />
        {searchTerm && (
          <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setSearchTerm("")} aria-label="Limpiar búsqueda">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-1 justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando informe consolidado...</span>
        </div>
      )}
      {error && !isLoading && (
        <Alert variant="destructive" className="flex-1">
          <AlertCircle className="h-4 w-4" /> <AlertTitle>Error</AlertTitle> <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!isLoading && !error && consolidatedData.length === 0 && (
        <p className="text-center text-muted-foreground py-10 flex-1">No hay datos de conteo en ningún almacén para generar un informe consolidado.</p>
      )}
      {!isLoading && !error && consolidatedData.length > 0 && filteredReportData.length === 0 && (
        <p className="text-center text-muted-foreground py-10 flex-1">No se encontraron productos que coincidan con la búsqueda.</p>
      )}

      {!isLoading && !error && filteredReportData.length > 0 && (
        <ScrollArea className="flex-1 border rounded-lg shadow-sm bg-card">
          <Table>
            <TableCaption>Vista consolidada del inventario contado en todos los almacenes.</TableCaption>
            <TableHeader className="sticky top-0 bg-muted/50 z-10 shadow-sm">
              <TableRow>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider hidden md:table-cell">Código</TableHead>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider">Descripción</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Stock Catálogo</TableHead>
                <TableHead className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider">Cant. Contada</TableHead>
                <TableHead className="px-3 py-2 text-xs font-medium uppercase tracking-wider hidden md:table-cell">Almacenes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReportData.map((item) => (
                <TableRow key={item.barcode} className="text-sm hover:bg-muted/10 transition-colors">
                  <TableCell className="px-3 py-2 font-mono hidden md:table-cell">{item.barcode}</TableCell>
                  <TableCell className="px-3 py-2">{item.description}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums">{item.masterStock}</TableCell>
                  <TableCell className="px-3 py-2 text-center tabular-nums font-semibold">{item.totalCountedQuantity}</TableCell>
                  <TableCell className="px-3 py-2 text-xs hidden md:table-cell">
                    {item.warehousesPresent.join(', ') || 'N/A'}
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

ConsolidatedView.displayName = 'ConsolidatedView';
