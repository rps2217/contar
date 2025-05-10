// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException, DecodeHintType, BarcodeFormat } from '@zxing/library';
import { XCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface BarcodeScannerCameraProps {
  onScanSuccess: (barcode: string) => void;
  onScanError: (error: Error) => void;
  onClose: () => void;
  className?: string;
}

const BarcodeScannerCamera: React.FC<BarcodeScannerCameraProps> = ({
  onScanSuccess,
  onScanError,
  onClose,
  className,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isComponentMountedRef = useRef(true); // Tracks if the component is mounted

  const stopScannerAndStream = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current.stopContinuousDecode(); // Ensure continuous decoding is stopped
      console.log("ZXing Reader reset and stopped.");
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      console.log("Camera stream stopped.");
    }
  }, []);


  useEffect(() => {
    isComponentMountedRef.current = true;
    let localStream: MediaStream | null = null;

    const initializeAndStartScanner = async () => {
      if (!isComponentMountedRef.current) return;
      
      if (!videoRef.current) {
        console.error("Video element ref not available during initialization attempt.");
        if (isComponentMountedRef.current) {
            setIsLoading(false);
            setHasPermission(false);
            setErrorMessage("Error interno: Referencia del elemento de video no disponible.");
        }
        return;
      }

      if (isComponentMountedRef.current) {
        setIsLoading(true);
        setHasPermission(false);
        setErrorMessage(null);
      }

      // Initialize the code reader
      if (!readerRef.current) {
        const hints = new Map();
        const formats = [
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, 
            BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E
        ];
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(DecodeHintType.TRY_HARDER, true);
        readerRef.current = new BrowserMultiFormatReader(hints);
        console.log("ZXing Reader initialized.");
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment', // Prefer rear camera
            width: { ideal: 640 },    // Request a reasonable resolution
            height: { ideal: 480 },
          }
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        if (!isComponentMountedRef.current) { // Check again after await
          if (localStream) localStream.getTracks().forEach(track => track.stop());
          return;
        }

        setHasPermission(true);
        videoRef.current.srcObject = localStream;

        videoRef.current.onloadedmetadata = async () => {
          if (!isComponentMountedRef.current || !videoRef.current) return;
          try {
            await videoRef.current.play();
            console.log("Video stream playing, attempting to decode.");

            if (readerRef.current && videoRef.current && isComponentMountedRef.current) {
               // Ensure to use decodeFromVideoElement for continuous scanning from a video element
              readerRef.current.decodeFromVideoElement(videoRef.current, (result, error) => {
                if (!isComponentMountedRef.current) return; // Check mount status within callback

                if (result) {
                  console.log("Barcode scanned:", result.getText());
                  onScanSuccess(result.getText());
                } else if (error) {
                  // These errors are common during scanning and don't always mean a problem.
                  if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
                    // console.warn("Scan error:", error.message); // Log less critical scan errors
                  }
                }
              }).catch(decodeErr => {
                 if (isComponentMountedRef.current) {
                    console.error("Error during decodeFromVideoElement:", decodeErr);
                    // setErrorMessage(`Error de decodificación: ${decodeErr.message}`); // Potentially too noisy
                 }
              });
            }
          } catch (playError: any) {
            if (isComponentMountedRef.current) {
              console.error("Error playing video:", playError);
              setHasPermission(false);
              setErrorMessage(`Error al reproducir video: ${playError.message}. Asegúrese de que los permisos de cámara están concedidos.`);
            }
          } finally {
             if (isComponentMountedRef.current) {
                setIsLoading(false);
             }
          }
        };
        // Handle cases where metadata might already be loaded
         if (videoRef.current.readyState >= videoRef.current.HAVE_METADATA) {
            const event = new Event('loadedmetadata');
            videoRef.current.dispatchEvent(event);
        }

      } catch (err: any) {
        if (isComponentMountedRef.current) {
          console.error("Error initializing camera:", err);
          setHasPermission(false);
           if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            setErrorMessage("Permiso de cámara denegado. Por favor, habilítalo en la configuración de tu navegador y recarga la página.");
          } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            setErrorMessage("No se encontró una cámara compatible. Asegúrate de que esté conectada y no esté en uso por otra aplicación.");
          } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
             setErrorMessage("La cámara está en uso por otra aplicación, no es accesible o hay un problema de hardware.");
          } else {
            setErrorMessage(`Error al acceder a la cámara: ${err.name} - ${err.message}`);
          }
          setIsLoading(false);
        }
      }
    };

    initializeAndStartScanner();

    return () => {
      isComponentMountedRef.current = false; // Mark as unmounted
      stopScannerAndStream();
      if (videoRef.current) {
        videoRef.current.onloadedmetadata = null; // Clean up event handler
      }
      console.log("BarcodeScannerCamera unmounted and cleaned up.");
    };
  }, [onScanSuccess, onScanError, stopScannerAndStream]); // onClose removed as cleanup is handled by stopScannerAndStream

  const handleRetry = () => {
     if (isComponentMountedRef.current) {
        setIsLoading(true);
        setHasPermission(false);
        setErrorMessage(null);
        // Re-initialize by forcing useEffect to re-run could be one way,
        // but direct call to initialize is better if useEffect deps are stable.
        // For now, just re-setting state should trigger re-attempt if deps are right
        // Or, a more explicit re-init function could be called.
        // Let's try re-triggering the effect by changing a dummy state or calling init directly if deps allow.
        // This effect will re-run if `onScanSuccess` or `onScanError` identity changes, which they shouldn't often.
        // For simplicity, we'll rely on the parent component re-mounting or the initial effect for now.
        // A better solution might involve a dedicated re-init function.
        // For now, inform the user to retry manually or re-open.
         onScanError(new Error("Retry requested. Closing and reopening scanner might be necessary.")); // Notify parent
         onClose(); // Close the scanner, user can reopen
     }
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-85 z-50 flex flex-col justify-center items-center p-2 sm:p-4">
      <div className={cn("relative w-full max-w-lg mx-auto bg-background dark:bg-gray-800 p-3 sm:p-4 rounded-lg shadow-xl flex flex-col", className)}>
        <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold text-foreground">Escáner de Código de Barras</h3>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar escáner">
                <XCircle className="h-6 w-6" />
            </Button>
        </div>

        {/* Video Preview Area */}
        <div className="aspect-[4/3] w-full bg-gray-900 rounded-md overflow-hidden relative mb-3">
            <video
            ref={videoRef}
            className="w-full h-full object-cover" // Ensure video fills the container
            playsInline // Essential for iOS
            muted // Autoplay often requires muted
            autoPlay // Try to autoplay
            />
            {/* Focusing rectangle (optional visual aid) */}
            <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
                <div className="w-3/4 h-1/2 border-2 border-dashed border-green-500 opacity-75 rounded-md"></div>
            </div>
        </div>


        {isLoading && (
            <div className="flex flex-col justify-center items-center text-center p-4 min-h-[100px]">
                <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                <p className="text-muted-foreground">Solicitando permiso y activando cámara...</p>
            </div>
        )}

        {!isLoading && !hasPermission && (
             <Alert variant="destructive" className="mt-2">
                 <AlertTriangle className="h-5 w-5" />
                 <AlertTitle>Problema con la Cámara</AlertTitle>
                 <AlertDescription>
                    {errorMessage || "No se pudo acceder a la cámara. Verifica los permisos y que no esté en uso."}
                    <Button onClick={handleRetry} variant="link" className="p-0 h-auto mt-1 text-destructive-foreground">Intentar de nuevo</Button>
                 </AlertDescription>
             </Alert>
        )}
        
        {!isLoading && hasPermission && errorMessage && (
             <Alert variant="destructive" className="mt-2">
                 <AlertTriangle className="h-5 w-5" />
                 <AlertTitle>Error del Escáner</AlertTitle>
                 <AlertDescription>
                    {errorMessage}
                    <Button onClick={handleRetry} variant="link" className="p-0 h-auto mt-1 text-destructive-foreground">Intentar de nuevo</Button>
                 </AlertDescription>
             </Alert>
        )}
        
        <p className="text-xs text-muted-foreground text-center mt-2">
            Apunta la cámara al código de barras.
        </p>
      </div>
    </div>
  );
};

export default BarcodeScannerCamera;
