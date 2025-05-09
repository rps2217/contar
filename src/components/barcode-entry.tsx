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
  isLoading: boolean; // General loading (DB, initial list, history saving)
  isRefreshingStock: boolean; // Refresh stock action active
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
    <div className="flex items-center mb-4 gap-2">
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
        className="mr-2 flex-grow bg-yellow-100 dark:bg-yellow-900 border-teal-300 dark:border-teal-700 focus:ring-teal-500 focus:border-teal-500 rounded-md shadow-sm"
        ref={inputRef}
        onKeyDown={handleKeyDown}
        aria-label="Código de barras"
        disabled={isAnyLoadingActive}
      />
       <Button
        onClick={onToggleCameraScanner}
        variant="outline"
        size="icon"
        className={cn(
          "text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900 hover:text-purple-700 dark:hover:text-purple-300",
          isCameraScannerActive && "bg-purple-100 dark:bg-purple-800"
        )}
        disabled={isAnyLoadingActive}
        aria-label={isCameraScannerActive ? "Cerrar Escáner de Cámara" : "Abrir Escáner de Cámara"}
        title={isCameraScannerActive ? "Cerrar Escáner de Cámara" : "Abrir Escáner de Cámara"}
      >
        {isCameraScannerActive ? <XCircle className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
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
        disabled={isAnyLoadingActive}
        aria-label="Actualizar stocks desde la base de datos para este almacén"
        title="Actualizar Stocks"
      >
        <RefreshCw className={`h-5 w-5 ${isRefreshingStock ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
};


    