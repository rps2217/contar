// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, XCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface BarcodeScannerCameraProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError: (error: Error) => void;
  onClose: () => void;
}

export const BarcodeScannerCamera: React.FC<BarcodeScannerCameraProps> = ({
  onScanSuccess,
  onScanError,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // const { toast } = useToast(); // Toast not used directly in this version of useEffect logic
  const streamRef = useRef<MediaStream | null>(null); // To hold the stream for cleanup

  useEffect(() => {
    let isCancelled = false;

    const initializeScanner = async () => {
      if (isCancelled) return;

      if (!videoRef.current) {
        console.warn("Video ref not available during init. Scanner will not start.");
        if (!isCancelled) setIsLoading(false); // Stop loading if ref is missing
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader(undefined, 500); // Added hints and increased scan interval
      }

      try {
        // Ensure any previous stream is stopped
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        // Reset the reader to clear any previous state or video associations.
        // This is important if initializeScanner can be called multiple times.
        if (readerRef.current && typeof readerRef.current.reset === 'function') {
            try {
                 readerRef.current.reset();
            } catch(e) {
                // console.warn("Error resetting reader (might be harmless):", e);
            }
        }


        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (isCancelled) { // Check cancellation immediately after async operation
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        setHasPermission(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Wait for video to be ready to play to avoid issues with play()
          videoRef.current.onloadedmetadata = async () => {
            if (isCancelled || !videoRef.current) return;
            try {
              await videoRef.current.play();
              // At this point, video should be playing or ready to play.
              // Call decodeFromVideoDevice. The library handles waiting for 'canplay'.
              if (readerRef.current && videoRef.current && !isCancelled) {
                 readerRef.current.decodeFromVideoDevice(undefined, videoRef.current, (result, error) => {
                    if (isCancelled) return;

                    if (result) {
                        onScanSuccess(result.getText());
                    } else if (error) {
                        if (
                        !(error instanceof NotFoundException) &&
                        !(error instanceof ChecksumException) &&
                        !(error instanceof FormatException)
                        ) {
                         // console.warn("Barcode scan error (other than not found):", error.message);
                         // onScanError(error); // Optionally report other errors
                        }
                    }
                 });
               } else if (!isCancelled) {
                  console.warn("Scanner or video element became unavailable after loadedmetadata.");
               }

            } catch (playError: any) {
              if (isCancelled) return;
              console.warn("Video play was prevented or failed:", playError);
              setErrorMessage("No se pudo iniciar el video. Asegúrate de que los permisos estén concedidos y no haya otra aplicación usando la cámara.");
              onScanError(new Error("Video play failed: " + playError.message));
            } finally {
                if(!isCancelled) setIsLoading(false);
            }
          };
          videoRef.current.onerror = (e) => {
            if(isCancelled) return;
            console.error("Video element error:", e);
            setErrorMessage("Error con el elemento de video.");
            setIsLoading(false);
            onScanError(new Error("Video element error"));
          }
        } else if (!isCancelled) {
            console.warn("Video ref became null after permission grant.");
            setIsLoading(false);
        }
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Error al acceder a la cámara o iniciar escáner:', err);
        setHasPermission(false);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setErrorMessage("Permiso de cámara denegado. Por favor, habilita el acceso a la cámara en la configuración de tu navegador.");
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setErrorMessage("No se encontró ninguna cámara. Asegúrate de que tienes una cámara conectada y habilitada.");
        } else if (err.name === "NotReadableError" || err.message?.includes("Device already in use")) {
            setErrorMessage("La cámara ya está en uso por otra aplicación o pestaña. Cierra otras aplicaciones que puedan estar usando la cámara y reintenta.");
        }
        else {
          setErrorMessage(`Error al iniciar la cámara: ${err.message}`);
        }
        onScanError(err);
        setIsLoading(false);
      }
      // setIsLoading(false) is now handled in onloadedmetadata or catch blocks to ensure it's set after async ops.
    };

    initializeScanner();

    return () => {
      isCancelled = true;
      if (readerRef.current) {
        try {
            // Check if methods exist before calling, typical for defensive programming
            if (typeof readerRef.current.stopContinuousDecode === 'function') {
                 readerRef.current.stopContinuousDecode();
            }
            if (typeof readerRef.current.reset === 'function') {
                readerRef.current.reset();
            }
        } catch(e) {
            // console.warn("Error during reader cleanup:", e);
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
       if (videoRef.current) {
         videoRef.current.srcObject = null;
         videoRef.current.onloadedmetadata = null; // Clean up event listener
         videoRef.current.onerror = null; // Clean up error listener
       }
    };
  }, [onScanSuccess, onScanError]); // Dependencies for useEffect

  return (
    <div className="relative border rounded-lg p-4 my-4 bg-card shadow-md">
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute top-2 right-2 z-10 bg-background/50 hover:bg-background/80"
        aria-label="Cerrar escáner de cámara"
      >
        <XCircle className="h-5 w-5" />
      </Button>

      {isLoading && (
        <div className="flex flex-col items-center justify-center min-h-[200px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-2 text-muted-foreground">Iniciando cámara...</p>
        </div>
      )}

      {hasPermission === false && !isLoading && (
        <Alert variant="destructive" className="min-h-[200px] flex flex-col items-center justify-center">
          <AlertTriangle className="h-6 w-6" />
          <AlertTitle className="mt-2">Error de Cámara</AlertTitle>
          <AlertDescription>
            {errorMessage || "No se pudo acceder a la cámara. Revisa los permisos."}
          </AlertDescription>
        </Alert>
      )}

      <div className={cn("aspect-video overflow-hidden rounded-md", { 'hidden': !hasPermission || isLoading })}>
          <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          playsInline 
          muted 
          />
      </div>


      {!isLoading && hasPermission && !errorMessage && (
        <p className="text-sm text-center text-muted-foreground mt-2">
          Apunte la cámara al código de barras.
        </p>
      )}
    </div>
  );
};
