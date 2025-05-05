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
  videoRef: React.RefObject<HTMLVideoElement>;
  isInitializing: boolean;
  hasPermission: boolean | null;
}

export const ScannerDialog: React.FC<ScannerDialogProps> = ({
  isOpen,
  onClose,
  videoRef,
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
        <div className="my-4 relative aspect-video">
          {/* Video element always rendered to prevent ref issues */}
          <video ref={videoRef} className={cn("w-full aspect-video rounded-md bg-black")} autoPlay muted playsInline />
          {/* Overlay elements */}
          {isOpen && (
            <div className={cn("absolute inset-0 flex items-center justify-center pointer-events-none")}>
              <div className="w-3/4 h-1/2 border-2 border-red-500 rounded-md opacity-75"></div>
            </div>
          )}
          {/* Loading/Initializing Indicator */}
          {isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" />
              Iniciando cámara...
            </div>
          )}
          {hasPermission === null && !isInitializing && isOpen && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">Solicitando permiso...</div>
          )}
          {hasPermission === false && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 p-4 rounded-md">
              <Alert variant="destructive" className="w-full">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Acceso a Cámara Requerido</AlertTitle>
                <AlertDescription>
                  Permite el acceso a la cámara en la configuración de tu navegador.
                </AlertDescription>
              </Alert>
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
