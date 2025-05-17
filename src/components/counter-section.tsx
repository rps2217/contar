// src/components/counter-section.tsx
"use client";

import React from 'react';
import type { DisplayProduct } from '@/types/product';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Save, Download, Trash, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CounterSectionProps {
  barcode: string;
  setBarcode: (value: string) => void;
  onAddProduct: () => void;
  onRefreshStock: () => void;
  isLoading: boolean;
  isRefreshingStock: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
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
  isSavingToHistory: boolean;
  onSaveToHistory: () => Promise<void>;
  onExport: () => void;
  onSetIsDeleteListDialogOpen: (isOpen: boolean) => void;
  isMobile: boolean;
  toast: (options: any) => void; // Consider using a more specific type for toast options
  isDbLoading: boolean;
  isTransitionPending: boolean;
}

export const CounterSection: React.FC<CounterSectionProps> = ({
  barcode,
  setBarcode,
  onAddProduct,
  onRefreshStock,
  isLoading,
  isRefreshingStock,
  inputRef,
  searchTerm,
  setSearchTerm,
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
  isSavingToHistory,
  onSaveToHistory,
  onExport,
  onSetIsDeleteListDialogOpen,
  isMobile,
  toast,
  isDbLoading,
  isTransitionPending,
}) => {
  const currentListForWarehouse = countingList.filter(p => p.warehouseId === currentWarehouseId);

  return (
    <div id="contador-content" className="flex flex-col h-full">
      <BarcodeEntry
        barcode={barcode}
        setBarcode={setBarcode}
        onAddProduct={onAddProduct}
        onRefreshStock={onRefreshStock}
        isLoading={isLoading || isDbLoading || isRefreshingStock || isTransitionPending}
        isRefreshingStock={isRefreshingStock}
        inputRef={inputRef}
      />
      <div className="relative mb-4">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar en inventario actual..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-8 w-full bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600"
          aria-label="Buscar en lista de conteo"
          disabled={isLoading || isDbLoading || isRefreshingStock || isTransitionPending}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        <CountingListTable
          countingList={filteredCountingList}
          warehouseName={warehouseName}
          isLoading={isLoading || isDbLoading || isTransitionPending}
          onDeleteRequest={onDeleteRequest}
          onOpenStockDialog={onOpenStockDialog}
          onOpenQuantityDialog={onOpenQuantityDialog}
          onDecrement={onDecrement}
          onIncrement={onIncrement}
          onEditDetailRequest={onEditDetailRequest}
          tableHeightClass="h-full"
        />
      </div>

      <div className="mt-4 flex flex-col sm:flex-row sm:justify-end items-stretch sm:items-center gap-2">
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
                onSelect={onSaveToHistory}
                disabled={currentListForWarehouse.length === 0 || isDbLoading || isSavingToHistory || isTransitionPending}
              >
                {isSavingToHistory ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {isSavingToHistory ? "Guardando..." : "Guardar Historial"}
              </DropdownMenuItem>
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
              onClick={onSaveToHistory}
              disabled={currentListForWarehouse.length === 0 || isDbLoading || isSavingToHistory || isTransitionPending}
              variant="outline"
              className="flex items-center gap-1 w-full sm:w-auto"
            >
              {isSavingToHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSavingToHistory ? "Guardando..." : "Guardar Historial"}
            </Button>
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
