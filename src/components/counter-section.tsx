
// src/components/counter-section.tsx
"use client";

import React from 'react';
import type { DisplayProduct } from '@/types/product';
import { BarcodeEntry } from '@/components/barcode-entry';
import { CountingListTable } from '@/components/counting-list-table';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Save, Download, Trash, MoreVertical, Camera, Filter, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { debounce, cn } from '@/lib/utils';

interface CounterSectionProps {
  barcode: string;
  setBarcode: (value: string) => void;
  onAddProduct: () => void;
  onRefreshStock: () => void;
  isRefreshingStock: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filteredCountingList: DisplayProduct[]; // This is the list already filtered by warehouse and search
  warehouseName: string;
  onDeleteRequest: (product: DisplayProduct) => void;
  onOpenStockDialog: (product: DisplayProduct) => void;
  onOpenQuantityDialog: (product: DisplayProduct) => void;
  onDecrement: (barcode: string, type: 'count' | 'stock') => void;
  onIncrement: (barcode: string, type: 'count' | 'stock') => void;
  onEditDetailRequest: (product: DisplayProduct) => void;
  onExport: () => void;
  onSetIsDeleteListDialogOpen: (isOpen: boolean) => void;
  isMobile: boolean;
  toast: (options: any) => void;
  isDbLoading: boolean;
  isTransitionPending: boolean;
  toggleShowOnlyDiscrepancies: () => void;
  showOnlyDiscrepancies: boolean;
}

const CounterSectionComponent: React.FC<CounterSectionProps> = ({
  barcode,
  setBarcode,
  onAddProduct,
  onRefreshStock,
  isRefreshingStock,
  inputRef,
  searchTerm,
  setSearchTerm,
  filteredCountingList, // Use this directly
  warehouseName,
  onDeleteRequest,
  onOpenStockDialog,
  onOpenQuantityDialog,
  onDecrement,
  onIncrement,
  onEditDetailRequest,
  onExport,
  onSetIsDeleteListDialogOpen,
  isMobile,
  toast,
  isDbLoading,
  isTransitionPending,
  toggleShowOnlyDiscrepancies,
  showOnlyDiscrepancies,
}) => {
  // No need for currentListForWarehouse, use filteredCountingList.length directly
  // const currentListForWarehouse = React.useMemo(() =>
  //   countingList.filter(p => p.warehouseId === currentWarehouseId),
  //   [countingList, currentWarehouseId]
  // );

  const isMountedRef = React.useRef(false);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const debouncedSetSearchTerm = React.useMemo(
    () => debounce((term: string) => { if (isMountedRef.current) setSearchTerm(term); }, 300),
    [setSearchTerm]
  );
  React.useEffect(() => () => debouncedSetSearchTerm.clear?.(), [debouncedSetSearchTerm]);


  return (
    <div id="contador-content" className="space-y-4 h-full flex flex-col">
        {/* Barcode Entry and Search are now rendered directly in page.tsx when camera is off */}
        {/* This component will now primarily be the table and its actions */}

        <div className="flex-1 overflow-hidden">
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
                            onSelect={toggleShowOnlyDiscrepancies}
                            disabled={isDbLoading || isTransitionPending}
                        >
                            <Filter className="h-4 w-4 mr-2" /> {showOnlyDiscrepancies ? "Mostrar Todo" : "Solo Diferencias"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={onExport}
                            disabled={filteredCountingList.length === 0 || isDbLoading || isTransitionPending}
                        >
                            <Download className="h-4 w-4 mr-2" /> Exportar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onSelect={() => {
                                if (filteredCountingList.length > 0) {
                                    onSetIsDeleteListDialogOpen(true);
                                } else {
                                    requestAnimationFrame(() => {
                                        if(isMountedRef.current) {
                                            toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                                        }
                                    });
                                }
                            }}
                            disabled={filteredCountingList.length === 0 || isDbLoading || isTransitionPending}
                            className="text-destructive focus:text-destructive dark:focus:text-red-400"
                        >
                            <Trash className="h-4 w-4 mr-2" /> Borrar Lista
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : (
                <>
                    <Button
                        onClick={toggleShowOnlyDiscrepancies}
                        variant="outline"
                        className="flex items-center gap-1 w-full sm:w-auto"
                        disabled={isDbLoading || isTransitionPending}
                        title={showOnlyDiscrepancies ? "Mostrar todos los productos" : "Mostrar solo productos con diferencias"}
                    >
                        <Filter className="h-4 w-4" /> {showOnlyDiscrepancies ? "Mostrar Todo" : "Solo Diferencias"}
                    </Button>
                    <Button
                        onClick={onExport}
                        disabled={filteredCountingList.length === 0 || isDbLoading || isTransitionPending}
                        variant="outline"
                        className="flex items-center gap-1 w-full sm:w-auto"
                    >
                        <Download className="h-4 w-4" /> Exportar
                    </Button>
                    <Button
                        onClick={() => {
                            if (filteredCountingList.length > 0) {
                                onSetIsDeleteListDialogOpen(true);
                            } else {
                                requestAnimationFrame(() => {
                                    if(isMountedRef.current) {
                                        toast({ title: "Vacío", description: "La lista actual ya está vacía." });
                                    }
                                });
                            }
                        }}
                        disabled={filteredCountingList.length === 0 || isDbLoading || isTransitionPending}
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
