// src/components/barcode-entry.tsx
import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, Camera, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BarcodeEntryProps {
  barcode: string;
  setBarcode: (value: string) => void;
  onAddProduct: () => void;
  onRefreshStock: () => void;
  isLoading: boolean; 
  isRefreshingStock: boolean; 
  inputRef: React.RefObject<HTMLInputElement>;
  onToggleCameraScanner: () => void;
  isCameraScannerActive: boolean;
}

export const BarcodeEntry: React.FC<BarcodeEntryProps> = ({
  barcode,
  setBarcode,
  onAddProduct,
  onRefreshStock,
  isLoading,
  isRefreshingStock,
  inputRef,
  onToggleCameraScanner,
  isCameraScannerActive,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAddProduct();
    }
  };

  const isAnyLoadingActive = isLoading || isRefreshingStock;

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
        className="sm:mr-2 flex-grow bg-yellow-100 dark:bg-yellow-900 border-teal-300 dark:border-teal-700 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm h-10" // Ensure consistent height
        ref={inputRef}
        onKeyDown={handleKeyDown}
        aria-label="Código de barras"
        disabled={isAnyLoadingActive || isCameraScannerActive} // Disable input if camera is active
      />
      <div className="flex w-full sm:w-auto items-center gap-2 mt-2 sm:mt-0"> {/* Button group */}
        <Button
          onClick={onToggleCameraScanner}
          variant={isCameraScannerActive ? "destructive" : "default"} // Primary when inactive, destructive when active
          size="icon"
          className={cn(
            "h-10 w-10", // Standard icon button size
            !isCameraScannerActive && "bg-purple-600 hover:bg-purple-700 text-white", // Purple for open camera
            isCameraScannerActive && "bg-red-600 hover:bg-red-700 text-white" // Red for close camera (XCircle)
          )}
          disabled={isAnyLoadingActive}
          aria-label={isCameraScannerActive ? "Cerrar Escáner de Cámara" : "Abrir Escáner de Cámara"}
          title={isCameraScannerActive ? "Cerrar Escáner de Cámara" : "Abrir Escáner de Cámara"}
        >
          {isCameraScannerActive ? <XCircle className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        </Button>
        <Button
          onClick={onAddProduct}
          variant="outline" // Make "Add" button secondary
          className={cn(
            "flex-grow sm:flex-none h-10 px-5 py-2", 
            "text-teal-600 border-teal-500 hover:bg-teal-50 dark:text-teal-400 dark:border-teal-600 dark:hover:bg-teal-900/50"
          )}
          aria-label="Agregar producto al almacén actual"
          disabled={isAnyLoadingActive || !barcode.trim() || isCameraScannerActive} // Disable if camera active
        >
          Agregar
        </Button>
        <Button
          onClick={onRefreshStock}
          variant="outline"
          size="icon"
          className="h-10 w-10 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900 hover:text-blue-700 dark:hover:text-blue-300"
          disabled={isAnyLoadingActive}
          aria-label="Actualizar stocks desde la base de datos para este almacén"
          title="Actualizar Stocks"
        >
          <RefreshCw className={`h-5 w-5 ${isRefreshingStock ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </div>
  );
};
