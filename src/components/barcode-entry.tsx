// src/components/barcode-entry.tsx
import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Camera, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface BarcodeEntryProps {
  barcode: string;
  setBarcode: (value: string) => void;
  onAddProduct: () => void;
  onScanClick: () => void;
  onRefreshStock: () => void;
  isLoading: boolean; // General loading (DB, initial list)
  isScanning: boolean; // Camera scanning active
  isRefreshingStock: boolean; // Refresh stock action active
  inputRef: React.RefObject<HTMLInputElement>;
}

export const BarcodeEntry: React.FC<BarcodeEntryProps> = ({
  barcode,
  setBarcode,
  onAddProduct,
  onScanClick,
  onRefreshStock,
  isLoading, // This prop now covers general DB loading, backup, history saving
  isScanning,
  isRefreshingStock,
  inputRef
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAddProduct();
    }
  };

  // isLoading prop now also indicates if backing up or saving to history
  const isAnyLoadingActive = isLoading || isScanning || isRefreshingStock;


  return (
    <div className="flex items-center mb-4 gap-2">
      <Input
        type="number"
        pattern="\d*" // Ensures numeric keyboard on mobile if supported
        inputMode="numeric" // Better semantic for numeric input
        placeholder="Escanear o ingresar código de barras"
        value={barcode}
        onChange={(e) => {
          // Ensure only digits are entered
          const numericValue = e.target.value.replace(/\D/g, '');
          setBarcode(numericValue);
        }}
        className="mr-2 flex-grow bg-yellow-100 dark:bg-yellow-900 border-teal-300 dark:border-teal-700 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm"
        ref={inputRef}
        onKeyDown={handleKeyDown}
        aria-label="Código de barras"
        disabled={isAnyLoadingActive}
      />
      <Button
        onClick={onScanClick}
        variant="outline"
        size="icon"
        className={cn(
          "text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
        )}
        aria-label="Escanear código de barras con la cámara"
        title="Escanear con Cámara"
        disabled={isAnyLoadingActive}
      >
        <Camera className="h-5 w-5" />
      </Button>
      <Button
        onClick={onAddProduct}
        className="bg-teal-600 hover:bg-teal-700 text-white rounded-md shadow-sm px-5 py-2 transition-colors duration-200"
        aria-label="Agregar producto al almacén actual"
        disabled={isAnyLoadingActive || !barcode.trim()}
      >
        Agregar
      </Button>
      <Button
        onClick={onRefreshStock}
        variant="outline"
        size="icon"
        className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
        disabled={isAnyLoadingActive} // Also disable if saving to history or backing up
        aria-label="Actualizar stocks desde la base de datos para este almacén"
        title="Actualizar Stocks"
      >
        <RefreshCw className={`h-5 w-5 ${isRefreshingStock ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
};
