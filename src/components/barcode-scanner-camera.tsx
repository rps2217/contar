// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException, DecodeHintType, BarcodeFormat, Exception } from '@zxing/library';
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
  const isComponentMountedRef = useRef(true); 

  const stopScannerAndStream = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.reset(); 
        console.log("ZXing Reader reset.");
      } catch (e) {
        console.error("Error resetting ZXing Reader:", e);
      }
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
            setHasPermission(false); // Explicitly set no permission if ref is missing
            const refError = new Error("Error interno: Referencia del elemento de video no disponible.");
            setErrorMessage(refError.message);
            onScanError(refError); 
        }
        return;
      }

      if (isComponentMountedRef.current) {
        setIsLoading(true);
        setHasPermission(false); // Reset permission status on each attempt
        setErrorMessage(null);
      }

      if (!readerRef.current) {
        const hints = new Map();
        const formats = [
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, 
            BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
            BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR,
        ];
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(DecodeHintType.TRY_HARDER, true);
        readerRef.current = new BrowserMultiFormatReader(hints, 500); // 500ms scan interval
        console.log("ZXing Reader initialized.");
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment', 
            width: { ideal: 640 },    
            height: { ideal: 480 },
          }
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        if (!isComponentMountedRef.current) { 
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

            if (readerRef.current && videoRef.current && videoRef.current.srcObject && (videoRef.current.srcObject as MediaStream).active && isComponentMountedRef.current) {
              readerRef.current.decodeFromVideoElement(videoRef.current, (result, error) => {
                if (!isComponentMountedRef.current) return; 

                if (result) {
                  console.log("Barcode scanned:", result.getText());
                  onScanSuccess(result.getText());
                } else if (error) {
                  if (isComponentMountedRef.current) {
                    if (error.name === 'SourceDataEndedException' || (error.message && error.message.toLowerCase().includes("stream has ended"))) {
                      console.warn("ZXing: Video stream ended during scan attempt. This might be normal if closing.");
                    } else if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
                      console.error("ZXing scan error:", error);
                    }
                  }
                }
              }).catch(decodeErr => {
                 if (!isComponentMountedRef.current) {
                    console.log("decodeFromVideoElement error caught during component unmount (ignored):", (decodeErr as Error).message);
                    return; 
                 }
                 console.error("Error from decodeFromVideoElement promise (component mounted):", decodeErr);
                 
                 let specificErrorMessage = `Error de decodificación: ${(decodeErr as Error).message}`;
                 if ((decodeErr as Exception).name === 'SourceDataEndedException' || ((decodeErr as Error).message && (decodeErr as Error).message.toLowerCase().includes("stream has ended"))){
                     specificErrorMessage = "El flujo de video terminó inesperadamente. La cámara podría haberse desconectado o cerrado. Intenta de nuevo.";
                 }
                 
                 setErrorMessage(specificErrorMessage);
                 if (isLoading) setIsLoading(false);
                 onScanError(new Error(specificErrorMessage)); // Propagate error to parent
              });
            } else if (isComponentMountedRef.current) {
                console.warn("Video stream not active or component unmounted before decoding could start.");
                if (isLoading) setIsLoading(false);
                if (videoRef.current && videoRef.current.srcObject && !(videoRef.current.srcObject as MediaStream).active) {
                   const streamNotActiveError = new Error("El flujo de video de la cámara no está activo.");
                   setErrorMessage(streamNotActiveError.message);
                   onScanError(streamNotActiveError);
                }
            }
          } catch (playError: any) {
            if (isComponentMountedRef.current) {
              console.error("Error playing video:", playError);
              setHasPermission(false);
              const videoPlayError = new Error(`Error al reproducir video: ${playError.message}. Asegúrese de que los permisos de cámara están concedidos.`);
              setErrorMessage(videoPlayError.message);
              onScanError(videoPlayError);
            }
          } finally {
             if (isComponentMountedRef.current) {
                setIsLoading(false);
             }
          }
        };
         if (videoRef.current.readyState >= videoRef.current.HAVE_METADATA) {
            const event = new Event('loadedmetadata');
            videoRef.current.dispatchEvent(event);
        }

      } catch (err: any) {
        if (isComponentMountedRef.current) {
          console.error("Error initializing camera:", err);
          setHasPermission(false);
          let userFriendlyMessage = `Error al acceder a la cámara: ${err.name} - ${err.message}`;
           if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            userFriendlyMessage = "Permiso de cámara denegado. Por favor, habilítalo en la configuración de tu navegador y recarga la página.";
          } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            userFriendlyMessage = "No se encontró una cámara compatible. Asegúrate de que esté conectada y no esté en uso por otra aplicación.";
          } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
             userFriendlyMessage = "La cámara está en uso por otra aplicación, no es accesible o hay un problema de hardware.";
          }
          setErrorMessage(userFriendlyMessage);
          onScanError(new Error(userFriendlyMessage));
          setIsLoading(false);
        }
      }
    };

    initializeAndStartScanner();

    return () => {
      isComponentMountedRef.current = false; 
      console.log("BarcodeScannerCamera unmounting, stopping scanner and stream...");
      stopScannerAndStream();
      if (videoRef.current) {
        videoRef.current.onloadedmetadata = null; 
      }
      console.log("BarcodeScannerCamera unmounted and cleaned up.");
    };
  }, [onScanSuccess, onScanError, stopScannerAndStream]); 

  const handleRetry = () => {
     if (isComponentMountedRef.current) {
        setIsLoading(true);
        setHasPermission(false);
        setErrorMessage(null);
        // The useEffect will re-run due to state changes or if dependencies change.
        // Forcing a re-initialization can be done by calling initializeAndStartScanner again,
        // but typically it's better to let useEffect handle it if possible.
        // Re-mounting the component (controlled by parent) is the most robust way to retry.
        onScanError(new Error("Reintentando conexión de cámara...")); 
        onClose(); // Close the scanner, user can reopen to trigger a fresh initialization
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
        
        <div className={cn("aspect-video w-full bg-gray-900 rounded-md overflow-hidden relative mb-3", { 'hidden': isLoading && !hasPermission && !errorMessage })}>
            <video
            ref={videoRef}
            className="w-full h-full object-cover" 
            playsInline 
            muted 
            autoPlay 
            />
            {hasPermission && !isLoading && !errorMessage && (
              <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
                  <div className="w-3/4 h-1/2 border-2 border-dashed border-green-500 opacity-75 rounded-md"></div>
              </div>
            )}
        </div>


        {isLoading && (
            <div className="flex flex-col justify-center items-center text-center p-4 min-h-[100px]">
                <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                <p className="text-muted-foreground">Solicitando permiso y activando cámara...</p>
            </div>
        )}

        {!isLoading && !hasPermission && errorMessage && (
             <Alert variant="destructive" className="mt-2">
                 <AlertTriangle className="h-5 w-5" />
                 <AlertTitle>Problema con la Cámara</AlertTitle>
                 <AlertDescription>
                    {errorMessage}
                    <Button onClick={handleRetry} variant="link" className="p-0 h-auto mt-1 text-destructive-foreground">Intentar de nuevo</Button>
                 </AlertDescription>
             </Alert>
        )}
        
        {!isLoading && hasPermission && errorMessage && ( // Show error even if permission was granted but something else failed
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
            Apunta la cámara al código de barras. El escaneo es continuo.
        </p>
      </div>
    </div>
  );
};

export default BarcodeScannerCamera;
