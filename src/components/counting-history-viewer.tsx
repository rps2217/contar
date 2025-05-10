// src/components/counting-history-viewer.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { getCountingHistory, clearCountingHistory } from '@/lib/database';
import type { CountingHistoryEntry } from '@/types/product';
import { useToast } from "@/hooks/use-toast";
import { format } from 'date-fns';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Trash, Loader2, CalendarIcon, Download, AlertCircle, User } from "lucide-react";
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Papa from 'papaparse';

interface CountingHistoryViewerProps {
  getWarehouseName: (warehouseId: string | null | undefined) => string;
  currentUserId?: string; // Optional: to filter history for current user
}

export const CountingHistoryViewer: React.FC<CountingHistoryViewerProps> = ({ getWarehouseName, currentUserId }) => {
  const [historyEntries, setHistoryEntries] = useState<CountingHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const { toast } = useToast();

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Pass currentUserId to getCountingHistory if you want to filter by user
      // For now, it fetches all history, and we can show the userId.
      // If strict filtering is needed, getCountingHistory needs to be adapted.
      const history = await getCountingHistory(currentUserId); // Pass userId to potentially filter
      setHistoryEntries(history);
    } catch (err: any) {
      console.error("Error loading counting history:", err);
      setError("No se pudo cargar el historial de conteos.");
      toast({
        variant: "destructive",
        title: "Error al Cargar Historial",
        description: err.message || "Ocurrió un error desconocido.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentUserId]); // Add currentUserId as dependency

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleClearHistory = async () => {
    setIsClearing(true);
    try {
      await clearCountingHistory(); // This clears all history.
      // If user-specific clearing is needed, clearCountingHistory would need adaptation.
      setHistoryEntries([]);
      toast({ title: "Historial Borrado", description: "Se ha borrado todo el historial de conteos." });
    } catch (err: any) {
      console.error("Error clearing counting history:", err);
      toast({
        variant: "destructive",
        title: "Error al Borrar",
        description: `No se pudo borrar el historial: ${err.message}`,
      });
    } finally {
      setIsClearing(false);
      setIsClearConfirmOpen(false);
    }
  };

  const handleExportHistory = useCallback(() => {
    if (historyEntries.length === 0) {
      toast({ title: "Vacío", description: "No hay historial para exportar." });
      return;
    }

    try {
      const dataToExport: any[] = [];
      historyEntries.forEach(entry => {
        const historyTimestamp = format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm:ss');
        const warehouseName = getWarehouseName(entry.warehouseId);

        entry.products.forEach(product => {
          dataToExport.push({
            "ID Historial": entry.id,
            "ID Usuario": entry.userId || 'N/A', // Include userId
            "Fecha Historial": historyTimestamp,
            "Almacén": warehouseName,
            "Código Barras": product.barcode,
            "Descripción": product.description,
            "Proveedor": product.provider || 'N/A',
            "Stock Sistema": product.stock ?? 0,
            "Cantidad Contada": product.count ?? 0,
            "Diferencia": (product.count ?? 0) - (product.stock ?? 0),
            "Última Actualización Producto": product.lastUpdated ? format(new Date(product.lastUpdated), 'yyyy-MM-dd HH:mm:ss') : 'N/A',
          });
        });
      });

      if (dataToExport.length === 0) {
          toast({ title: "Vacío", description: "No hay datos de productos en el historial para exportar." });
          return;
      }

      const csv = Papa.unparse(dataToExport, { header: true });
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const timestamp = format(new Date(), 'yyyyMMdd', { locale: es });
      const userPart = currentUserId ? `_usuario-${currentUserId.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
      const fileName = `historial_conteos${userPart}_${timestamp}.csv`;

      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast({ title: "Exportado", description: `Historial de conteos exportado a ${fileName}.` });

    } catch (error) {
      console.error("Error exporting history:", error);
      toast({ variant: "destructive", title: "Error de Exportación", description: "No se pudo generar el archivo CSV del historial." });
    }
  }, [historyEntries, getWarehouseName, toast, currentUserId]);


  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">Historial de Conteos {currentUserId && <span className="text-base font-normal text-muted-foreground">(Usuario: {currentUserId})</span>}</h2>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
           <Button
            variant="outline"
            onClick={handleExportHistory}
            disabled={isLoading || isClearing || historyEntries.length === 0}
            className="w-full sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />
            Descargar Historial
          </Button>
          <Button
            variant="destructive"
            onClick={() => setIsClearConfirmOpen(true)}
            disabled={isLoading || isClearing || historyEntries.length === 0}
            className="w-full sm:w-auto"
          >
            {isClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash className="mr-2 h-4 w-4" />}
            Borrar Historial
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Cargando historial...</span>
        </div>
      )}

      {error && !isLoading && (
         <Alert variant="destructive">
           <AlertCircle className="h-4 w-4" />
           <AlertTitle>Error</AlertTitle>
           <AlertDescription>{error}</AlertDescription>
         </Alert>
      )}

      {!isLoading && !error && historyEntries.length === 0 && (
        <p className="text-center text-muted-foreground py-10">
            {currentUserId ? `No hay historial de conteos para el usuario ${currentUserId}.` : "No hay historial de conteos guardado."}
        </p>
      )}

      {!isLoading && !error && historyEntries.length > 0 && (
        <ScrollArea className="h-[calc(100vh-250px)] border rounded-lg shadow-sm bg-white dark:bg-gray-800">
          <Accordion type="single" collapsible className="w-full">
            {historyEntries.map((entry) => (
              <AccordionItem value={entry.id} key={entry.id}>
                <AccordionTrigger className="px-4 py-3 text-left hover:bg-muted/50 dark:hover:bg-gray-700 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 w-full">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium text-foreground">
                            {format(new Date(entry.timestamp), 'PPP p', { locale: es })}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-xs sm:text-sm text-muted-foreground ml-7 sm:ml-0">
                        <span>({getWarehouseName(entry.warehouseId)})</span>
                        <span>{entry.products.length} productos</span>
                        {entry.userId && (
                            <span className="flex items-center gap-1">
                                <User className="h-3 w-3"/> {entry.userId}
                            </span>
                        )}
                      </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-0 py-0">
                  <div className="overflow-x-auto">
                    <Table className="min-w-full">
                      <TableHeader className="bg-gray-100 dark:bg-gray-700">
                        <TableRow>
                          <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Código Barras</TableHead>
                          <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Descripción</TableHead>
                          <TableHead className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Proveedor</TableHead>
                          <TableHead className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock</TableHead>
                          <TableHead className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Contado</TableHead>
                          <TableHead className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Diferencia</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entry.products.map((product, index) => {
                           const difference = (product.count ?? 0) - (product.stock ?? 0);
                           return (
                              <TableRow key={`${entry.id}-${product.barcode}-${index}`} className="text-sm hover:bg-muted/10 dark:hover:bg-gray-700/50 transition-colors">
                                <TableCell className="px-4 py-2 font-mono text-gray-700 dark:text-gray-200">{product.barcode}</TableCell>
                                <TableCell className="px-4 py-2 text-gray-800 dark:text-gray-100">{product.description}</TableCell>
                                <TableCell className="px-4 py-2 text-gray-600 dark:text-gray-300">{product.provider || 'N/A'}</TableCell>
                                <TableCell className="px-4 py-2 text-center tabular-nums text-gray-600 dark:text-gray-300">{product.stock ?? 0}</TableCell>
                                <TableCell className="px-4 py-2 text-center tabular-nums text-gray-600 dark:text-gray-300">{product.count ?? 0}</TableCell>
                                 <TableCell
                                      className={`px-4 py-2 text-center tabular-nums font-semibold ${
                                        difference === 0 ? 'text-green-600 dark:text-green-400' :
                                        difference > 0 ? 'text-yellow-600 dark:text-yellow-400' :
                                        'text-red-600 dark:text-red-400'
                                      }`}
                                    >
                                      {difference === 0 ? 'OK' : (difference > 0 ? `+${difference}` : difference)}
                                    </TableCell>
                              </TableRow>
                           );
                         })}
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollArea>
      )}

       {/* Confirmation Dialog for Clearing History */}
        <ConfirmationDialog
            isOpen={isClearConfirmOpen}
            onOpenChange={setIsClearConfirmOpen}
            title="Confirmar Borrado del Historial"
            description="¿Estás seguro de que deseas borrar todo el historial de conteos? Esta acción no se puede deshacer."
            confirmText="Sí, Borrar Historial"
            onConfirm={handleClearHistory}
            isDestructive={true}
            isProcessing={isClearing}
        />
    </div>
  );
};
