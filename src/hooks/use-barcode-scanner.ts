
// src/hooks/use-barcode-scanner.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { useToast } from "@/hooks/use-toast";
import { playBeep } from '@/lib/helpers'; // Assuming playBeep is moved to helpers

interface UseBarcodeScannerOptions {
  onScanSuccess: (barcode: string) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  isEnabled: boolean; // Control whether the scanner should be active
}

interface UseBarcodeScannerResult {
  isInitializing: boolean;
  hasPermission: boolean | null;
  startScanning: () => void;
  stopScanning: () => void;
}

export function useBarcodeScanner({
  onScanSuccess,
  videoRef,
  isEnabled
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const { toast } = useToast();
  const [isInitializing, setIsInitializing] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isScanningActive, setIsScanningActive] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.log("Camera stream stopped.");
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (readerRef.current) {
      readerRef.current.reset(); // Reset scanner state
    }
    setIsScanningActive(false); // Mark scanning as inactive
  }, [videoRef]);

  const startScanning = useCallback(() => {
    setHasPermission(null); // Reset permission status
    setIsScanningActive(true); // Activate scanning process
  }, []);

  const stopScanning = useCallback(() => {
    setIsScanningActive(false); // Deactivate scanning process
    stopStream(); // Ensure stream is stopped
  }, [stopStream]);

  useEffect(() => {
    let cancelled = false;
    let isMounted = true;
    let initTimeoutId: NodeJS.Timeout | null = null;

    const initializeScanner = async () => {
      if (!isEnabled || !isScanningActive || !isMounted) {
        stopStream();
        setIsInitializing(false);
        return;
      }

      setIsInitializing(true);

      if (!videoRef.current) {
        console.error("Video element ref not available during initialization.");
        if (!cancelled && isMounted && isEnabled && isScanningActive) {
          initTimeoutId = setTimeout(() => initializeScanner(), 150);
        } else {
          setIsInitializing(false);
        }
        return;
      }
      const currentVideoRef = videoRef.current;

      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
        console.log("ZXing Reader initialized.");
      }
      const reader = readerRef.current;

      try {
        console.log("Requesting camera permission...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled || !isMounted) {
          stream.getTracks().forEach(track => track.stop());
          setIsInitializing(false);
          return;
        }

        console.log("Camera permission granted.");
        setHasPermission(true);
        streamRef.current = stream;

        if (currentVideoRef) {
          currentVideoRef.srcObject = stream;
          await new Promise<void>((resolve, reject) => {
            currentVideoRef.onloadedmetadata = () => resolve();
            currentVideoRef.onerror = (e) => reject(new Error(`Video metadata error: ${e}`));
          });

          if (cancelled || !isMounted) {
             setIsInitializing(false);
             return;
            }

          await currentVideoRef.play();
           if (cancelled || !isMounted) {
               setIsInitializing(false);
               return;
            }
          console.log("Video stream playing.");
          setIsInitializing(false);

          if (reader) {
            console.log("Starting barcode decoding...");
            reader.decodeFromVideoDevice(undefined, currentVideoRef, (result, err) => {
              if (cancelled || !isMounted || !isScanningActive) return; // Check active state

              if (result) {
                console.log('Barcode detected:', result.getText());
                const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, '');
                playBeep(900, 80);
                onScanSuccess(detectedBarcode);
                stopScanning(); // Stop scanning after success
              }
              if (err && !(err instanceof NotFoundException)) {
                console.error('Scanning error:', err);
              }
            }).catch(decodeErr => {
              if (!cancelled && isMounted) {
                console.error("Error starting decodeFromVideoDevice:", decodeErr);
                toast({ variant: "destructive", title: "Error de Escaneo", description: "No se pudo iniciar la decodificación." });
                stopScanning();
              }
            });
          }
        } else {
            if (!cancelled) {
                console.warn("Video ref became null after permission grant.");
                stream.getTracks().forEach(track => track.stop());
            }
            setIsInitializing(false);
        }

      } catch (error: any) {
        if (cancelled || !isMounted) return;
        console.error('Error accessing camera or starting scanner:', error.name, error.message);
        setHasPermission(false);
        toast({
          variant: 'destructive',
          title: 'Acceso a Cámara Denegado',
          description: `Por favor, habilita los permisos de cámara. Error: ${error.name || error.message}`,
          duration: 9000
        });
        stopScanning();
        setIsInitializing(false);
      }
    };

    if (isEnabled && isScanningActive) {
      initTimeoutId = setTimeout(() => {
           if (isEnabled && isScanningActive && isMounted) {
               initializeScanner();
           }
       }, 50);
    } else {
      stopStream();
      setIsInitializing(false);
    }

    return () => {
      console.log("Cleaning up barcode scanner effect.");
      isMounted = false;
      cancelled = true;
      if (initTimeoutId) clearTimeout(initTimeoutId);
      stopStream(); // Ensure cleanup on unmount or when disabled/stopped
      setIsInitializing(false);
    };
  }, [isEnabled, isScanningActive, videoRef, onScanSuccess, stopStream, toast]); // Rerun effect if isEnabled or isScanningActive changes

  return { isInitializing, hasPermission, startScanning, stopScanning };
}

    