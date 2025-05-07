// src/components/scanner-dialog.tsx
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScannerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  videoRef: React.RefObject<HTMLVideoElement>; // Receive the ref
  isInitializing: boolean;
  hasPermission: boolean | null;
}

export const ScannerDialog: React.FC<ScannerDialogProps> = ({
  isOpen,
  onClose,
  videoRef, // Use the received ref
  isInitializing,
  hasPermission
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md w-full p-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-semibold text-gray-800 dark:text-gray-200">Escanear Código de Barras</DialogTitle>
          <DialogDescription className="text-center text-sm text-gray-600 dark:text-gray-400">
            Apunta la cámara al código de barras.
          </DialogDescription>
        </DialogHeader>
         <div className="my-4 relative aspect-video overflow-hidden rounded-md">
          {/* Video element is passed via ref, but overlay/indicators are here */}

          {/* Centered Red Finder Box Overlay */}
          <div className={cn("absolute inset-0 flex items-center justify-center pointer-events-none")}>
            <div className="w-3/4 h-1/2 border-2 border-red-500 rounded-md opacity-75 animate-pulse"></div>
          </div>

           {/* Video element needs to be present in the DOM for the ref to work */}
           {/* Ensure this video element is correctly passed the ref from the parent */}
           <video
            ref={videoRef} // Use the passed ref
            className={cn(
              "w-full h-full object-cover",
              "transition-opacity duration-300",
              (isInitializing || hasPermission === false) ? "opacity-0" : "opacity-100"
            )}
            autoPlay
            muted
            playsInline
           />


          {/* Loading/Initializing Indicator */}
          {isInitializing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-75 text-white p-4 rounded-md">
              <Loader2 className="mb-2 h-8 w-8 animate-spin" />
              <span className="text-center">Iniciando cámara...</span>
            </div>
          )}

          {/* Permission Denied Message */}
          {hasPermission === false && !isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-85 p-4 rounded-md">
              <Alert variant="destructive" className="w-full text-center">
                <AlertCircle className="h-6 w-6 mx-auto mb-2" />
                <AlertTitle className="mb-1">Acceso a Cámara Requerido</AlertTitle>
                <AlertDescription>
                  Permite el acceso a la cámara en la configuración de tu navegador para usar esta función.
                </AlertDescription>
              </Alert>
            </div>
          )}

            {/* Permission Prompt Helper (Optional, only if hasPermission is null and not initializing) */}
            {hasPermission === null && !isInitializing && isOpen && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 text-white p-4 rounded-md">
                Esperando permiso de cámara...
                </div>
            )}
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
