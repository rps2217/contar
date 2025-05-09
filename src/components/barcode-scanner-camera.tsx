// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, XCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils"; // Added import for cn

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
  const { toast } = useToast();

  useEffect(() => {
    let isCancelled = false;
    let currentStream: MediaStream | null = null;

    const initializeScanner = async () => {
      if (isCancelled || !videoRef.current) {
        if(!videoRef.current && !isCancelled) {
          console.warn("Video ref not available during init, retrying...");
          // Only retry if not cancelled and videoRef.current is null
           if (!isCancelled) {
             setTimeout(initializeScanner, 100);
           }
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        setHasPermission(true);

        if (videoRef.current && !isCancelled) {
          videoRef.current.srcObject = currentStream;
          // Ensure video is playing before starting decode
          await videoRef.current.play().catch(playError => {
            // This catch is important for browsers that might block autoplay
            console.warn("Video play was prevented or failed:", playError);
            setErrorMessage("No se pudo iniciar el video. Asegúrate de que los permisos estén concedidos y no haya otra aplicación usando la cámara.");
            setIsLoading(false);
          });


          if (!readerRef.current) {
            readerRef.current = new BrowserMultiFormatReader();
          }
          
          if (videoRef.current && !isCancelled && videoRef.current.readyState >= videoRef.current.HAVE_ENOUGH_DATA) {
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
                  // Don't report common 'not found' errors, as scanning is continuous
                  // onScanError(error);
                  console.warn("Error de escaneo (ignorado):", error.message);
                }
              }
            });
          } else if (!isCancelled) {
             console.warn("Video not ready for decoding, will retry or wait for play event.");
             // Could implement a retry here or rely on the play event listener if added
          }
        }
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Error al acceder a la cámara:', err);
        setHasPermission(false);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setErrorMessage("Permiso de cámara denegado. Por favor, habilita el acceso a la cámara en la configuración de tu navegador.");
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setErrorMessage("No se encontró ninguna cámara. Asegúrate de que tienes una cámara conectada y habilitada.");
        } else {
          setErrorMessage(`Error al iniciar la cámara: ${err.message}`);
        }
        onScanError(err);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };
    
    if (videoRef.current) {
        videoRef.current.oncanplay = () => {
            if (!isCancelled && readerRef.current && videoRef.current) {
                 // Potentially re-initiate decode if it failed due to video not being ready
                 console.log("Video can play, attempting to decode if not already active.");
                  // This check is important to avoid multiple decodeFromVideoDevice calls
                 if (videoRef.current && readerRef.current && !readerRef.current.isVideoPlaying()) {
                    initializeScanner(); // Or a more specific restart decode logic
                 }
            }
        };
    }


    initializeScanner();

    return () => {
      isCancelled = true;
      if (readerRef.current) {
        readerRef.current.reset();
        // readerRef.current = null; // Avoid nulling out if re-initialization logic depends on it being potentially there
      }
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
       if (videoRef.current) {
         videoRef.current.srcObject = null;
         videoRef.current.oncanplay = null; // Clean up event listener
       }
    };
  }, [onScanSuccess, onScanError, toast]);

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

      {/* Render video element regardless of permission to ensure ref is available */}
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


    