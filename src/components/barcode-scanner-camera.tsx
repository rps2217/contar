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
  const [isScannerReady, setIsScannerReady] = useState(false);
  const isComponentMountedRef = useRef(true);

  const stopScannerAndStream = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.reset();
        console.log("ZXing Reader reset and camera released.");
      } catch (e) {
        console.error("Error resetting ZXing Reader:", e);
      }
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      console.log("Camera stream tracks explicitly stopped.");
    }
    if (isComponentMountedRef.current) {
        setIsScannerReady(false);
    }
  }, []);

  const initializeScanner = useCallback(async () => {
    if (!isComponentMountedRef.current || !videoRef.current || !readerRef.current ) return;
    
    setIsScannerReady(false); // Reset scanner ready state

    // Ensure video is playing
    try {
        await videoRef.current.play();
        console.log("Video stream playing, attempting to decode.");
    } catch (playError: any) {
        if (isComponentMountedRef.current) {
            console.error("Error playing video:", playError);
            setHasPermission(false); // May be a permission issue if play fails
            const videoPlayError = new Error(`Error al reproducir video: ${playError.message}.`);
            setErrorMessage(videoPlayError.message);
            onScanError(videoPlayError);
            setIsLoading(false);
        }
        return;
    }

    if (videoRef.current && readerRef.current && videoRef.current.srcObject && (videoRef.current.srcObject as MediaStream).active && isComponentMountedRef.current) {
        console.log("Starting decodeFromVideoElement...");
        readerRef.current.decodeFromVideoElement(videoRef.current, (result, error) => {
            if (!isComponentMountedRef.current) return;

            if (result) {
                console.log("!!! BARCODE DETECTED !!!:", result.getText());
                onScanSuccess(result.getText());
            } else if (error) {
                if (error instanceof NotFoundException) {
                    // Normal, no barcode found in this frame - continue scanning
                    return;
                }
                console.warn(`ZXing scan attempt error: ${error.name}`, error.message);
                if (error.name === 'SourceDataEndedException') {
                    console.warn("Stream ended during scan attempt callback. Scanner might be closing.");
                }
            }
        }).then(() => {
            if(isComponentMountedRef.current) setIsScannerReady(true);
        }).catch(decodePromiseError => {
            if (!isComponentMountedRef.current) {
                console.log("decodeFromVideoElement promise error caught during component unmount (ignored):", (decodePromiseError as Error).name);
                return;
            }
            console.error("Error from decodeFromVideoElement promise (component mounted):", decodePromiseError);
            const err = decodePromiseError as Error;
            let specificErrorMessage = `Error de decodificación: ${err.message}`;

            if (err.name === 'SourceDataEndedException' || (err.message && err.message.toLowerCase().includes("stream has ended"))) {
                specificErrorMessage = "El flujo de video terminó inesperadamente. Verifica la cámara y los permisos.";
                console.warn(specificErrorMessage, err);
                // Propagate this error if it happens while scanner should be active
                if (isComponentMountedRef.current) {
                    onScanError(new Error(specificErrorMessage));
                }
            } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                specificErrorMessage = "Permiso de cámara denegado.";
                setErrorMessage(specificErrorMessage);
                onScanError(new Error(specificErrorMessage));
            } else {
                setErrorMessage(specificErrorMessage);
                onScanError(new Error(specificErrorMessage));
            }
            if (isComponentMountedRef.current) {
                setIsLoading(false);
                setIsScannerReady(false);
            }
        });
    } else if (isComponentMountedRef.current) {
        console.warn("Video stream not active or component unmounted before decoding could start.");
        if (isLoading) setIsLoading(false);
    }
  }, [videoRef, readerRef, onScanSuccess, onScanError, setIsLoading, setHasPermission, setErrorMessage, setIsScannerReady, isLoading]);


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
          const refError = new Error("Error interno: Referencia del elemento de video no disponible.");
          setErrorMessage(refError.message);
          onScanError(refError);
        }
        return;
      }

      if (isComponentMountedRef.current) {
        setIsLoading(true);
        setHasPermission(false);
        setErrorMessage(null);
        setIsScannerReady(false);
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
        readerRef.current = new BrowserMultiFormatReader(hints, 500);
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
        
        videoRef.current.onloadedmetadata = () => {
             if (!isComponentMountedRef.current || !videoRef.current) return;
             initializeScanner(); // Call initializeScanner once metadata is loaded
        };
        // If metadata already loaded (e.g. on retry)
        if (videoRef.current.readyState >= videoRef.current.HAVE_METADATA) {
            console.log("Video metadata already loaded, calling initializeScanner.");
            initializeScanner();
        }

      } catch (err: any) {
        if (isComponentMountedRef.current) {
          console.error("Error initializing camera:", err);
          setHasPermission(false);
          let userFriendlyMessage = `Error al acceder a la cámara: ${err.name} - ${err.message}`;
          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            userFriendlyMessage = "Permiso de cámara denegado. Por favor, habilítalo en la configuración de tu navegador.";
          } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            userFriendlyMessage = "No se encontró una cámara compatible.";
          } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
            userFriendlyMessage = "La cámara está en uso por otra aplicación o hay un problema de hardware.";
          }
          setErrorMessage(userFriendlyMessage);
          onScanError(new Error(userFriendlyMessage));
        }
      } finally {
          if(isComponentMountedRef.current) setIsLoading(false);
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
  }, [onScanSuccess, onScanError, stopScannerAndStream, initializeScanner]);

  const handleRetry = () => {
    if (isComponentMountedRef.current) {
      onClose(); 
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
          {hasPermission && !isLoading && !errorMessage && isScannerReady && (
            <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
              <div className="w-3/4 h-1/2 border-2 border-dashed border-green-500 opacity-75 rounded-md"></div>
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
              <Button onClick={handleRetry} variant="link" className="p-0 h-auto mt-1 text-destructive-foreground">Reintentar</Button>
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && hasPermission && errorMessage && ( 
          <Alert variant="destructive" className="mt-2">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle>Error del Escáner</AlertTitle>
            <AlertDescription>
              {errorMessage}
              <Button onClick={handleRetry} variant="link" className="p-0 h-auto mt-1 text-destructive-foreground">Reintentar</Button>
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
