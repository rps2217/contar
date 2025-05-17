// src/components/barcode-entry.tsx
import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface BarcodeEntryProps {
  barcode: string;
  setBarcode: (value: string) => void;
  onAddProduct: () => void;
  onRefreshStock: () => void;
  isLoading: boolean; 
  isRefreshingStock: boolean; 
  inputRef: React.RefObject<HTMLInputElement>;
}

const BarcodeEntryComponent: React.FC<BarcodeEntryProps> = ({
  barcode,
  setBarcode,
  onAddProduct,
  onRefreshStock,
  isLoading, 
  isRefreshingStock,
  inputRef,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!isLoading) { 
        onAddProduct();
      }
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center mb-4 gap-2">
      <Input
        type="number"
        pattern="\d*"
        inputMode="numeric"
        placeholder="Escanear o ingresar código de barras"
        value={barcode}
        onChange={(e) => {
          const numericValue = e.target.value.replace(/\D/g, '');
          setBarcode(numericValue);
        }}
        className="sm:mr-2 flex-grow bg-yellow-50 dark:bg-yellow-900/30 border-teal-300 dark:border-teal-700 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm h-10"
        ref={inputRef}
        onKeyDown={handleKeyDown}
        aria-label="Código de barras"
        disabled={isLoading} 
      />
      <div className="flex w-full sm:w-auto items-center gap-2 mt-2 sm:mt-0">
        <Button
          onClick={() => {
            if (!isLoading) { 
              onAddProduct();
            }
          }}
          variant="outline"
          className={cn(
            "flex-grow sm:flex-none h-10 px-5 py-2", 
            "text-teal-600 border-teal-500 hover:bg-teal-50 dark:text-teal-400 dark:border-teal-600 dark:hover:bg-teal-900/50"
          )}
          aria-label="Agregar producto al almacén actual"
          disabled={isLoading || !barcode.trim()} 
        >
          Agregar
        </Button>
        <Button
          onClick={onRefreshStock}
          variant="outline"
          size="icon"
          className="h-10 w-10 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
          disabled={isLoading} 
          aria-label="Actualizar stocks desde la base de datos para este almacén"
          title="Actualizar Stocks"
        >
          <RefreshCw className={`h-5 w-5 ${isRefreshingStock ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </div>
  );
};

export const BarcodeEntry = React.memo(BarcodeEntryComponent);
