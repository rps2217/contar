
// src/components/counter-section.tsx
"use client";

import React from 'react';
import type { DisplayProduct } from '@/types/product';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Save, Download, Trash, MoreVertical, Camera } from "lucide-react"; // Added Camera icon
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { debounce, cn } from '@/lib/utils';

interface CounterSectionProps {
  filteredCountingList: DisplayProduct[];
  warehouseName: string;
  onDeleteRequest: (product: DisplayProduct) => void;
  onOpenStockDialog: (product: DisplayProduct) => void;
  onOpenQuantityDialog: (product: DisplayProduct) => void;
  onDecrement: (barcode: string, type: 'count' | 'stock') => void;
  onIncrement: (barcode: string, type: 'count' | 'stock') => void;
  onEditDetailRequest: (product: DisplayProduct) => void;
  countingList: DisplayProduct[];
  currentWarehouseId: string;
  onExport: () => void;
  onSetIsDeleteListDialogOpen: (isOpen: boolean) => void;
  isMobile: boolean;
  toast: (options: any) => void;
  isDbLoading: boolean;
  isTransitionPending: boolean;
}

const CounterSectionComponent: React.FC<CounterSectionProps> = ({
  filteredCountingList,
  warehouseName,
  onDeleteRequest,
  onOpenStockDialog,
  onOpenQuantityDialog,
  onDecrement,
  onIncrement,
  onEditDetailRequest,
  countingList,
  currentWarehouseId,
  onExport,
  onSetIsDeleteListDialogOpen,
  isMobile,
  toast,
  isDbLoading,
  isTransitionPending,
}) => {
  const currentListForWarehouse = React.useMemo(() =>
    countingList.filter(p => p.warehouseId === currentWarehouseId),
    [countingList, currentWarehouseId]
  );

  return (
    <div id="contador-content" className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden h-full">
        <CountingListTable
          countingList={filteredCountingList}
          warehouseName={warehouseName}
          isLoading={isDbLoading || isTransitionPending}
          onDeleteRequest={onDeleteRequest}
          onOpenStockDialog={onOpenStockDialog}
          onOpenQuantityDialog={onOpenQuantityDialog}
          onDecrement={onDecrement}
          onIncrement={onIncrement}
          onEditDetailRequest={onEditDetailRequest}
          tableHeightClass="h-full"
        />
      </div>

      <div className="mt-auto flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2 pt-4">
        {isMobile ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full">
                <MoreVertical className="h-4 w-4 mr-2" />
                <span>Acciones</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[calc(100vw-4rem)] sm:w-56">
              <DropdownMenuItem
                onSelect={onExport}
                disabled={currentListForWarehouse.length === 0 || isDbLoading || isTransitionPending}
              >
                <Download className="h-4 w-4 mr-2" /> Exportar
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (currentListForWarehouse.length > 0) {
                    onSetIsDeleteListDialogOpen(true);
                  } else {
                    requestAnimationFrame(() => {
                      toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                    });
                  }
                }}
                disabled={currentListForWarehouse.length === 0 || isDbLoading || isTransitionPending}
                className="text-destructive focus:text-destructive dark:focus:text-red-400"
              >
                <Trash className="h-4 w-4 mr-2" /> Borrar Lista
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            <Button
              onClick={onExport}
              disabled={currentListForWarehouse.length === 0 || isDbLoading || isTransitionPending}
              variant="outline"
              className="flex items-center gap-1 w-full sm:w-auto"
            >
              <Download className="h-4 w-4" /> Exportar
            </Button>
            <Button
              onClick={() => {
                if (currentListForWarehouse.length > 0) {
                  onSetIsDeleteListDialogOpen(true);
                } else {
                   requestAnimationFrame(() => {
                     toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                   });
                }
              }}
              disabled={currentListForWarehouse.length === 0 || isDbLoading || isTransitionPending}
              variant="destructive"
              className="flex items-center gap-1 w-full sm:w-auto"
            >
              <Trash className="h-4 w-4" /> Borrar Lista
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export const CounterSection = React.memo(CounterSectionComponent);
