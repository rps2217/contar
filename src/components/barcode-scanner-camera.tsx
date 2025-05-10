// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException, DecodeHintType, BarcodeFormat, ChecksumException, FormatException, Exception } from '@zxing/library';
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
  const isComponentMountedRef = useRef(true);

  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isScannerActive, setIsScannerActive] = useState(false); // Tracks if ZXing is actively trying to decode


  const stopScannerAndStream = useCallback(() => {
    console.log("Attempting to stop scanner and stream...");
    if (readerRef.current) {
      try {
        readerRef.current.reset(); // This should stop decoding and release the camera.
        console.log("ZXing Reader reset.");
      } catch (e) {
        console.error("Error resetting ZXing Reader:", e);
      }
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => {
        track.stop();
        console.log(`Track ${track.kind} stopped.`);
      });
      videoRef.current.srcObject = null; // Important to release the stream
      videoRef.current.load(); // Reset video element
      console.log("Video stream tracks explicitly stopped and srcObject set to null.");
    }
    if (isComponentMountedRef.current) {
      setIsScannerActive(false);
      // Do not set isLoading here as it's primarily for initial setup
    }
  }, []);


  useEffect(() => {
    isComponentMountedRef.current = true;
    let currentStream: MediaStream | null = null;

    const hints = new Map();
    const formats = [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR,
    ];
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(DecodeHintType.TRY_HARDER, true);
    readerRef.current = new BrowserMultiFormatReader(hints, 500);
    console.log("ZXing Reader initialized on mount.");

    const setupCameraAndStartScanner = async () => {
      if (!isComponentMountedRef.current || !videoRef.current || !readerRef.current) {
        console.warn("Component unmounted or refs not available during setup.");
        if(isComponentMountedRef.current) setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setHasPermission(false);
      setErrorMessage(null);
      setIsScannerActive(false);

      try {
        console.log("Requesting camera permission...");
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 },
          }
        };
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!isComponentMountedRef.current) {
          currentStream?.getTracks().forEach(track => track.stop());
          return;
        }

        console.log("Camera permission granted.");
        setHasPermission(true);
        videoRef.current.srcObject = currentStream;

        // Wait for the video to be ready to play
        videoRef.current.oncanplay = async () => {
          if (!isComponentMountedRef.current || !readerRef.current || !videoRef.current) return;
          
          // Attempt to play the video. User interaction might be needed on some browsers.
          try {
            await videoRef.current.play();
            console.log("Video is playing.");

            if (!isComponentMountedRef.current) return; // Check again after await

            console.log("Attempting to decode from video element...");
            setIsScannerActive(true);
            // The decodeFromVideoElement method itself handles continuous scanning when a callback is provided.
             readerRef.current.decodeFromVideoElement(videoRef.current, (result, error) => {
              if (!isComponentMountedRef.current || !isScannerActive) return; // Check if still active

              if (result) {
                console.log("Barcode detected:", result.getText());
                onScanSuccess(result.getText());
                // No need to call stopScannerAndStream here if we want it to be continuous until closed by user
              } else if (error) {
                if (error instanceof NotFoundException) {
                  // This is normal, no barcode found in the current frame. Keep scanning.
                  return;
                }
                if (error instanceof ChecksumException || error instanceof FormatException) {
                  console.warn(`Minor scan error (Checksum/Format): ${error.message}`);
                  return; // Continue scanning for these common, non-fatal scan issues
                }
                // For other errors, log them but decide if scanning should stop.
                // Some errors might be transient.
                console.error("Scan error in callback:", error);
                // Potentially set an error message or attempt recovery if applicable
                // For now, let it continue unless it's a fatal error handled by the promise catch below.
              }
            }).catch(decodeError => { // This catch is for fatal errors from decodeFromVideoElement itself
                if (!isComponentMountedRef.current) return;
                 console.error("Fatal error from decodeFromVideoElement promise:", decodeError);
                 let specificMsg = `Error al iniciar el decodificador: ${(decodeError as Error).message}`;
                 if ((decodeError as Error).name === "SourceUnavailableError" || (decodeError as Error).message?.includes("video source") || (decodeError as Error).message?.includes("Failed to allocate")) {
                    specificMsg = "La fuente de video no está disponible o ya está en uso. Intenta cerrar otras aplicaciones/pestañas que usen la cámara.";
                 }
                 setErrorMessage(specificMsg);
                 onScanError(new Error(specificMsg));
                 setIsScannerActive(false);
            });
            console.log("decodeFromVideoElement initiated with callback for continuous scanning.");

          } catch (playError: any) {
             if (!isComponentMountedRef.current) return;
             console.error("Error playing video:", playError);
             setHasPermission(false);
             const videoPlayError = new Error(`Error al reproducir video: ${playError.message}. Es posible que necesite interactuar con la página primero.`);
             setErrorMessage(videoPlayError.message);
             onScanError(videoPlayError);
          } finally {
            if (isComponentMountedRef.current) setIsLoading(false); // Loading finishes once play is attempted
          }
        };
        
        // Fallback if oncanplay doesn't fire quickly (e.g. if metadata is already loaded)
        if (videoRef.current.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
            console.log("Video already has enough data, triggering oncanplay manually if available.");
            videoRef.current.oncanplay?.(new Event('canplay'));
        }


      } catch (err: any) {
        if (!isComponentMountedRef.current) return;
        console.error("Error initializing camera access:", err);
        setHasPermission(false);
        let userFriendlyMessage = `Error al acceder a la cámara. Verifica los permisos y que ninguna otra aplicación la esté usando. (${err.name}) Detalle: ${err.message}`;
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          userFriendlyMessage = "Permiso de cámara denegado. Habilítalo en la configuración de tu navegador.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          userFriendlyMessage = "No se encontró una cámara compatible.";
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError" || err.name === "SourceUnavailableError" || err.message?.includes("Failed to allocate videosource")) {
          userFriendlyMessage = "No se pudo acceder a la cámara. Puede estar en uso por otra aplicación/pestaña o haber un problema de hardware/controlador. Intenta cerrar otras apps que usen la cámara y reintenta.";
        } else if (err.name === "OverconstrainedError") {
           userFriendlyMessage = "No se pudo aplicar la configuración de cámara solicitada. Intenta con otra cámara o verifica las restricciones (resolución, etc.).";
        }
        setErrorMessage(userFriendlyMessage);
        onScanError(new Error(userFriendlyMessage));
        setIsLoading(false);
      }
    };

    setupCameraAndStartScanner();

    return () => {
      console.log("BarcodeScannerCamera unmounting...");
      isComponentMountedRef.current = false;
      stopScannerAndStream(); // Ensure this is called
      if (videoRef.current) {
        videoRef.current.oncanplay = null; // Clean up event listener
        videoRef.current.onloadedmetadata = null; 
      }
      currentStream?.getTracks().forEach(track => track.stop()); // Ensure stream from this closure is stopped
      readerRef.current = null; // Dispose of the reader instance
      console.log("BarcodeScannerCamera unmounted and cleaned up.");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array: runs once on mount, cleans up on unmount.

  const handleRetry = () => {
    // Re-mounting by parent is the cleanest way to retry full initialization
    onClose(); 
    // Parent component can then set isCameraScannerActive to true again to re-mount this.
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

        <div className={cn("aspect-video w-full bg-gray-900 rounded-md overflow-hidden relative mb-3")}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline // Important for iOS
            muted // Muting is often required for autoplay
            // autoPlay // Autoplay is handled by videoRef.current.play() after stream is set
          />
          {hasPermission && !isLoading && !errorMessage && isScannerActive && (
            <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
              <div className="w-3/4 h-1/2 border-2 border-dashed border-green-500 opacity-75 rounded-md animate-pulse"></div>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="flex flex-col justify-center items-center text-center p-4 min-h-[100px]">
            <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
            <p className="text-muted-foreground">Activando cámara...</p>
          </div>
        )}

        {!isLoading && !hasPermission && errorMessage && (
          <Alert variant="destructive" className="mt-2">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle>Problema con la Cámara</AlertTitle>
            <AlertDescription>
              {errorMessage}
              <Button onClick={handleRetry} variant="link" className="p-0 h-auto mt-1 text-destructive-foreground">Reintentar cerrando</Button>
            </AlertDescription>
          </Alert>
        )}
        
        {!isLoading && hasPermission && errorMessage && !isScannerActive && ( // Show general error if scanner isn't active but there's an error
          <Alert variant="warning" className="mt-2">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle>Error del Escáner</AlertTitle>
            <AlertDescription>
              {errorMessage}
              <Button onClick={handleRetry} variant="link" className="p-0 h-auto mt-1 text-yellow-700 dark:text-yellow-300">Reintentar cerrando</Button>
            </AlertDescription>
          </Alert>
        )}
        
        {hasPermission && !isLoading && !errorMessage && !isScannerActive && ( // Message if camera is on but scanner not yet active (e.g. video loading but not yet decoding)
             <div className="flex flex-col justify-center items-center text-center p-4 min-h-[60px]">
                <Loader2 className="h-6 w-6 text-primary animate-spin mb-2" />
                <p className="text-sm text-muted-foreground">Preparando escáner...</p>
            </div>
        )}

        <p className="text-xs text-muted-foreground text-center mt-2">
          Apunta la cámara al código de barras. El escaneo es continuo.
        </p>
      </div>
    </div>
  );
};

export default BarcodeScannerCamera;
