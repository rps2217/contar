// src/components/counting-list-table.tsx
import React from 'react';
import { DisplayProduct } from '@/types/product';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Check, Minus, Plus, Edit, Trash } from "lucide-react"; // Import Edit and Trash icons
import { cn } from "@/lib/utils";
import { format, isValid } from 'date-fns'; // Import isValid

interface CountingListTableProps {
  countingList: DisplayProduct[];
  warehouseName: string;
  isLoading: boolean;
  onDeleteRequest: (product: DisplayProduct) => void;
  onOpenStockDialog: (product: DisplayProduct) => void;
  onOpenQuantityDialog: (product: DisplayProduct) => void;
  onDecrement: (barcode: string, type: 'count' | 'stock') => void;
  onIncrement: (barcode: string, type: 'count' | 'stock') => void;
  onEditDetailRequest: (product: DisplayProduct) => void; // Add prop for editing details
  tableHeightClass?: string; // Allow custom height
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
  onEditDetailRequest, // Destructure the new prop
  tableHeightClass = "h-[calc(100vh-360px)] md:h-[calc(100vh-330px)]" // Default height
}) => {
  return (
    <ScrollArea className={cn(tableHeightClass, "border rounded-lg shadow-sm bg-white dark:bg-gray-800")}>
      <Table>
        <TableCaption className="py-3 text-sm text-gray-500 dark:text-gray-400">Inventario para {warehouseName}.</TableCaption>
        <TableHeader className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10 shadow-sm">
          <TableRow>
            <TableHead className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[35%] sm:w-2/5">Descripción (Click para Borrar)</TableHead>
            {/* <TableHead className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/5">
              Proveedor
            </TableHead> */}
             <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[15%] sm:w-[15%]">Stock (Click para Editar)</TableHead>
            <TableHead className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[15%] sm:w-[15%]">Cantidad (Click para Editar)</TableHead>
            <TableHead className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-1/5">Última Actualización</TableHead>
            <TableHead className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[5%]">Validación</TableHead>
            <TableHead className="text-center hidden md:table-cell px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider w-[15%]">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {countingList.map((product, index) => {
             // Attempt to parse the date and check validity
             const lastUpdatedDate = product.lastUpdated ? new Date(product.lastUpdated) : null;
             const isValidDate = lastUpdatedDate && isValid(lastUpdatedDate);
             // Ensure a unique key, combining barcode and warehouseId
             const uniqueKey = `${product.barcode}-${product.warehouseId || 'unknown'}`;
            return (
                <TableRow
                key={uniqueKey} // Use the generated unique key
                className={cn(
                    "hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150",
                    product.count === product.stock && product.stock !== 0 ? "bg-green-50 dark:bg-green-900/30" : ""
                )}
                aria-rowindex={index + 1}
                >
                <TableCell
                    className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:text-red-600 dark:hover:text-red-400 hover:underline"
                    onClick={() => onDeleteRequest(product)}
                    title={`Eliminar ${product.description} de este inventario`}
                    aria-label={`Eliminar ${product.description}`}
                >
                    {product.description}
                     <Trash className="inline-block h-4 w-4 ml-2 text-red-500 md:hidden" /> {/* Inline delete icon for mobile */}
                </TableCell>
                {/* <TableCell className="hidden sm:table-cell px-4 py-3 text-gray-600 dark:text-gray-300">
                    {product.provider || 'N/A'}
                </TableCell> */}
                <TableCell
                    className="px-4 py-3 text-center text-gray-600 dark:text-gray-300 cursor-pointer hover:text-teal-700 dark:hover:text-teal-400 hover:font-semibold tabular-nums"
                    onClick={() => onOpenStockDialog(product)} // Use dialog for stock edit
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
                     {/* Button to open the product detail edit dialog (for stock etc) */}
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
                    </div>
                </TableCell>
                </TableRow>
            )})}
          {countingList.length === 0 && !isLoading && (
            <TableRow>
              <TableCell colSpan={7} className="text-center px-4 py-10 text-gray-500 dark:text-gray-400">
                No hay productos en este inventario. Escanea un código de barras para empezar.
              </TableCell>
            </TableRow>
          )}
          {isLoading && (
            <TableRow>
              <TableCell colSpan={7} className="text-center px-4 py-10 text-gray-500 dark:text-gray-400">
                Cargando datos del almacén...
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </ScrollArea>
  );
};