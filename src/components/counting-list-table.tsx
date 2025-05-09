// src/components/counting-list-table.tsx
import React from 'react';
import type { DisplayProduct } from '@/types/product';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Check, Minus, Plus, Edit, Trash } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isValid } from 'date-fns';

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

export const CountingListTable: React.FC<CountingListTableProps> = ({
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
    <ScrollArea className={cn(tableHeightClass, "border rounded-lg shadow-sm bg-white dark:bg-gray-800")}>
      <Table>
        <TableCaption className="py-3 text-sm text-gray-500 dark:text-gray-400">Inventario para {warehouseName}.</TableCaption>
        <TableHeader className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10 shadow-sm">
          <TableRow>
            <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[35%] sm:w-2/5">Descripción</TableHead>
            <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[15%] sm:w-[15%]">Stock (Click para Editar)</TableHead>
            <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[15%] sm:w-[15%]">Cantidad (Click para Editar)</TableHead>
            <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/5">Última Actualización</TableHead>
            <TableHead className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[5%]">Validación</TableHead>
            <TableHead className="text-center hidden md:table-cell px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[15%]">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {countingList.map((product, index) => {
             const lastUpdatedDate = product.lastUpdated ? new Date(product.lastUpdated) : null;
             const isValidDate = lastUpdatedDate && isValid(lastUpdatedDate);
             const uniqueKey = `${product.barcode}-${product.warehouseId || 'unknown'}-${index}`;
            return (
                <TableRow
                key={uniqueKey}
                  className={cn(
                    "hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150",
                    product.count === product.stock && product.stock !== 0 ? "bg-green-50 dark:bg-green-900/30" : ""
                )}
                aria-rowindex={index + 1}
                >
                <TableCell
                    className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100"
                    aria-label={`Detalles para ${product.description}`}
                >
                    <span
                        onClick={() => onEditDetailRequest(product)}
                        className="cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        title={`Editar detalles de ${product.description}`}
                    >
                        {product.description}
                    </span>
                    <div className="flex items-center gap-1 mt-1 md:hidden"> {/* Container for mobile action icons */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-blue-500 hover:text-blue-600 p-0" // Smaller icon button
                            onClick={() => onEditDetailRequest(product)}
                            title={`Editar detalles de ${product.description}`}
                        >
                            <Edit className="h-3.5 w-3.5" /> {/* Smaller icon */}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-500 hover:text-red-600 p-0" // Smaller icon button
                            onClick={() => onDeleteRequest(product)}
                            title={`Eliminar ${product.description}`}
                        >
                            <Trash className="h-3.5 w-3.5" /> {/* Smaller icon */}
                        </Button>
                    </div>
                </TableCell>
                <TableCell
                    className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 cursor-pointer hover:text-teal-700 dark:hover:text-teal-400 hover:font-semibold tabular-nums"
                    onClick={() => onOpenStockDialog(product)}
                    title={`Editar stock para ${product.description} en ${warehouseName}`}
                    aria-label={`Editar stock para ${product.description}`}
                >
                    {product.stock ?? 0}
                </TableCell>
                <TableCell
                    className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 cursor-pointer hover:text-teal-700 dark:hover:text-teal-400 hover:font-semibold tabular-nums"
                    onClick={() => onOpenQuantityDialog(product)}
                    title={`Editar cantidad para ${product.description} en ${warehouseName}`}
                    aria-label={`Editar cantidad para ${product.description}`}
                >
                    {product.count ?? 0}
                </TableCell>
                 <TableCell className="hidden md:table-cell px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {isValidDate ? format(lastUpdatedDate!, 'PPpp', { timeZone: 'auto' }) : product.lastUpdated || 'N/A'}
                  </TableCell>
                <TableCell className="hidden md:table-cell px-4 py-3 text-center">
                    {product.count === product.stock && product.stock !== 0 ? (
                    <Check className="h-5 w-5 text-green-600 dark:text-green-400 mx-auto" />
                    ) : product.count > (product.stock ?? 0) ? (
                    <span className="text-yellow-600 dark:text-yellow-400 font-semibold">+{product.count - (product.stock ?? 0)}</span>
                    ) : (product.stock ?? 0) > 0 && product.count < (product.stock ?? 0) ? (
                    <span className="text-red-600 dark:text-red-400 font-semibold">{product.count - (product.stock ?? 0)}</span>
                    ) : null}
                </TableCell>
                <TableCell className="text-center hidden md:table-cell px-4 py-3">
                    <div className="flex justify-center items-center space-x-1">
                    <Button
                        onClick={() => onDecrement(product.barcode, 'count')}
                        size="icon"
                        variant="ghost"
                        className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full w-8 h-8"
                        aria-label={`Disminuir cantidad para ${product.description}`}
                    >
                        <Minus className="h-4 w-4" />
                    </Button>
                    <Button
                        onClick={() => onIncrement(product.barcode, 'count')}
                        size="icon"
                        variant="ghost"
                        className="text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 rounded-full w-8 h-8"
                        aria-label={`Aumentar cantidad para ${product.description}`}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                      <Button
                         onClick={() => onEditDetailRequest(product)}
                         size="icon"
                         variant="ghost"
                         className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-full w-8 h-8"
                         aria-label={`Editar detalles para ${product.description}`}
                         title="Editar Detalles (Stock, Proveedor)"
                     >
                         <Edit className="h-4 w-4" />
                     </Button>
                     <Button
                        variant="ghost"
                        size="icon"
                        className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full w-8 h-8"
                        onClick={() => onDeleteRequest(product)}
                        title={`Eliminar ${product.description} de este inventario`}
                        aria-label={`Eliminar ${product.description}`}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                </TableCell>
                </TableRow>
            );})}
          {countingList.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center px-4 py-10 text-gray-500 dark:text-gray-400">
                No hay productos en este inventario. Agrega uno para empezar.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};

