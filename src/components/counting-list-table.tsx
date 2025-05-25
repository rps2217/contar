
// src/components/counting-list-table.tsx
import React from 'react';
import type { DisplayProduct } from '@/types/product';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Check, Edit, Minus, Plus, Trash, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isValid, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

interface CountingListTableProps {
  countingList: DisplayProduct[];
  warehouseName: string;
  isLoading: boolean;
  onDeleteRequest: (product: DisplayProduct) => void;
  onOpenStockDialog: (product: DisplayProduct) => void;
  onOpenQuantityDialog: (product: DisplayProduct) => void;
  onDecrement: (barcode: string, type: 'count' | 'stock') => void;
  onIncrement: (barcode: string, type: 'count' | 'stock') => void;
  onEditDetailRequest: (product: DisplayProduct) => void;
  tableHeightClass?: string;
}

const CountingListTableComponent: React.FC<CountingListTableProps> = ({
  countingList,
  warehouseName,
  isLoading,
  onDeleteRequest,
  onOpenStockDialog,
  onOpenQuantityDialog,
  onDecrement,
  onIncrement,
  onEditDetailRequest,
  tableHeightClass = "h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]"
}) => {
  return (
    <ScrollArea className={cn(tableHeightClass, "border rounded-lg shadow-sm bg-card dark:bg-gray-800")}>
      <Table>
        <TableCaption className="py-3 text-sm text-muted-foreground dark:text-gray-400">Inventario para {warehouseName}.</TableCaption>
        <TableHeader className="bg-muted/50 dark:bg-gray-700 sticky top-0 z-10 shadow-sm">
          <TableRow>
            <TableHead className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground dark:text-gray-300 uppercase tracking-wider w-[25%] sm:w-[25%]">Descripción</TableHead>
            <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground dark:text-gray-300 uppercase tracking-wider w-[10%] sm:w-[10%]">Stock</TableHead>
            <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground dark:text-gray-300 uppercase tracking-wider w-[10%] sm:w-[10%]">Cantidad</TableHead>
            <TableHead className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground dark:text-gray-300 uppercase tracking-wider w-[10%] sm:w-[10%]">Diferencia</TableHead>
            <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-semibold text-muted-foreground dark:text-gray-300 uppercase tracking-wider w-[15%]">Vencimiento</TableHead>
            <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-semibold text-muted-foreground dark:text-gray-300 uppercase tracking-wider w-[15%]">Últ. Act.</TableHead>
            <TableHead className="hidden md:table-cell px-4 py-3 text-center text-xs font-semibold text-muted-foreground dark:text-gray-300 uppercase tracking-wider w-[5%]">Validación</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {countingList.map((product, index) => {
             const lastUpdatedDate = product.lastUpdated ? new Date(product.lastUpdated) : null;
             const isValidLastUpdate = lastUpdatedDate && isValid(lastUpdatedDate);
             const expirationDate = product.expirationDate ? parseISO(product.expirationDate) : null;
             const isValidExpiration = expirationDate && isValid(expirationDate);
             const uniqueKey = product.barcode;
             const isUnknownProduct = product.description.startsWith('Producto desconocido');
            return (
                <TableRow
                  key={uniqueKey}
                  className={cn(
                    "hover:bg-muted/10 dark:hover:bg-gray-700/50 transition-colors duration-150",
                    isUnknownProduct ? "bg-yellow-50 dark:bg-yellow-900/20" :
                    (product.count ?? 0) > (product.stock ?? 0) ? "bg-rose-100 dark:bg-rose-900/30" :
                    ((product.count ?? 0) === (product.stock ?? 0) && (product.stock ?? 0) !== 0 ? "bg-green-500/10 dark:bg-green-700/20" : "")
                  )}
                  aria-rowindex={index + 1}
                >
                <TableCell
                    className="px-4 py-3 font-semibold text-foreground"
                    aria-label={`Detalles para ${product.description}`}
                >
                    <span
                        onClick={() => onDeleteRequest(product)}
                        className="cursor-pointer hover:text-destructive dark:hover:text-red-400 hover:underline"
                        title={`Eliminar ${product.description} de la lista actual`}
                    >
                        {product.description}
                    </span>
                    <div className="flex items-center gap-1 mt-1 md:hidden">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-accent hover:text-accent/80 p-0"
                            onClick={() => onEditDetailRequest(product)}
                            title={`Editar detalles de ${product.description}`}
                        >
                            <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive/80 p-0"
                            onClick={() => onDeleteRequest(product)}
                            title={`Eliminar ${product.description}`}
                        >
                            <Trash className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                     <div className="text-xs text-muted-foreground md:hidden">
                        {isValidExpiration ? (
                            <span className={cn(new Date() > expirationDate! && 'text-red-500 font-semibold')}>
                                Vence: {format(expirationDate!, 'dd/MM/yy', {locale: es})}
                            </span>
                        ) : product.expirationDate === undefined || product.expirationDate === null ? 'Venc: N/A' : 'Venc: Inválido'}
                    </div>
                </TableCell>
                <TableCell
                    className="px-4 py-3 text-center text-foreground cursor-pointer hover:text-primary dark:hover:text-primary hover:font-semibold tabular-nums text-lg md:text-base"
                    onClick={() => onOpenStockDialog(product)}
                    title={`Editar stock para ${product.description} en ${warehouseName}`}
                    aria-label={`Editar stock para ${product.description}`}
                >
                    {product.stock ?? 0}
                </TableCell>
                <TableCell
                    className="px-4 py-3 text-center text-foreground cursor-pointer hover:text-primary dark:hover:text-primary hover:font-semibold tabular-nums text-lg md:text-base"
                    onClick={() => onOpenQuantityDialog(product)}
                    title={`Editar cantidad para ${product.description} en ${warehouseName}`}
                    aria-label={`Editar cantidad para ${product.description}`}
                >
                    {product.count ?? 0}
                </TableCell>
                <TableCell
                    className={cn(
                        "px-4 py-3 text-center tabular-nums font-semibold",
                        (product.count ?? 0) - (product.stock ?? 0) > 0 ? "text-yellow-600 dark:text-yellow-400" :
                        (product.count ?? 0) - (product.stock ?? 0) < 0 ? "text-red-600 dark:text-red-400" :
                        "text-green-600 dark:text-green-400"
                    )}
                >
                    {(() => {
                        const diff = (product.count ?? 0) - (product.stock ?? 0);
                        if (diff > 0) return `+${diff}`;
                        // Muestra OK si la diferencia es 0 Y (el stock no es 0 O la cantidad no es 0)
                        // Esto evita mostrar OK si ambos son 0 por defecto.
                        if (diff === 0 && ((product.stock ?? 0) !== 0 || (product.count ?? 0) !== 0) ) return 'OK';
                        // Muestra 0 si la diferencia es 0 y ambos (stock y count) son 0 o no están definidos.
                        if (diff === 0 && (product.stock === 0 || product.stock === undefined) && (product.count === 0 || product.count === undefined )) return '0';
                        return diff;
                    })()}
                </TableCell>
                <TableCell className="hidden md:table-cell px-4 py-3 text-muted-foreground text-xs">
                     {isValidExpiration ? (
                        <span className={cn(new Date() > expirationDate! && 'text-red-500 font-semibold')}>
                             {format(expirationDate!, 'PP', {locale: es})}
                        </span>
                     ) : product.expirationDate === undefined || product.expirationDate === null ? 'N/A' : 'Fecha Inválida'}
                 </TableCell>
                 <TableCell className="hidden md:table-cell px-4 py-3 text-muted-foreground text-xs">
                      {isValidLastUpdate ? format(lastUpdatedDate!, 'PPpp', { locale: es }) : product.lastUpdated || 'N/A'}
                  </TableCell>
                <TableCell className="hidden md:table-cell px-4 py-3 text-center">
                    {(product.count ?? 0) === (product.stock ?? 0) && (product.stock ?? 0) !== 0 ? (
                    <Check className="h-5 w-5 text-green-600 dark:text-green-400 mx-auto" />
                    ) : (product.count ?? 0) > (product.stock ?? 0) ? (
                    <span className="text-yellow-600 dark:text-yellow-400 font-semibold">+{ (product.count ?? 0) - (product.stock ?? 0)}</span>
                    ) : (product.stock ?? 0) > 0 && (product.count ?? 0) < (product.stock ?? 0) ? (
                    <span className="text-red-600 dark:text-red-400 font-semibold">{(product.count ?? 0) - (product.stock ?? 0)}</span>
                    ) : null}
                </TableCell>
                </TableRow>
            );})}
          {countingList.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center px-4 py-10 text-muted-foreground">
                No hay productos en este inventario. Agrega uno para empezar.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};

export const CountingListTable = React.memo(CountingListTableComponent);
