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
  const [isScanningActive, setIsScanningActive] = useState(false); // Internal state to manage the scanning process

  // Function to stop camera stream and release resources
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.log("Camera stream stopped.");
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null; // Clear video source
    }
    if (readerRef.current) {
      readerRef.current.reset(); // Reset scanner state
    }
    setIsScanningActive(false); // Ensure scanning is marked as inactive
  }, [videoRef]);

  // Public function to signal the start of scanning intent
  const startScanning = useCallback(() => {
    setHasPermission(null); // Reset permission status before starting
    setIsScanningActive(true); // Activate the internal scanning process
  }, []);

  // Public function to signal stopping the scanning process
  const stopScanning = useCallback(() => {
    setIsScanningActive(false); // Deactivate the internal scanning process
    stopStream(); // Ensure stream and scanner are stopped
  }, [stopStream]);

  // Effect to manage the camera and scanner initialization/teardown
  useEffect(() => {
    let cancelled = false;
    let isMounted = true;
    let initTimeoutId: NodeJS.Timeout | null = null;

    const initializeScanner = async () => {
      if (!isEnabled || !isScanningActive || !isMounted) {
        stopStream(); // Ensure cleanup if disabled or stopped
        setIsInitializing(false);
        return;
      }

      setIsInitializing(true); // Indicate camera is initializing

      // Ensure videoRef is available before proceeding
      if (!videoRef.current) {
        console.error("Video element ref not available during initialization.");
        // Retry only if still enabled and active
        if (!cancelled && isMounted && isEnabled && isScanningActive) {
          initTimeoutId = setTimeout(() => initializeScanner(), 150); // Retry delay
        } else {
          setIsInitializing(false);
        }
        return;
      }
      const currentVideoRef = videoRef.current;

      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
        console.log("ZXing BrowserMultiFormatReader initialized.");
      }
      const reader = readerRef.current;

      try {
        console.log("Requesting camera permission...");
        const constraints = { video: { facingMode: "environment" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled || !isMounted) {
          stream.getTracks().forEach(track => track.stop());
          setIsInitializing(false);
          return;
        }

        console.log("Camera permission granted.");
        setHasPermission(true);
        streamRef.current = stream;

        if (currentVideoRef) { // Double check ref after await
          currentVideoRef.srcObject = stream;
          // Wait for metadata to load before playing
          await new Promise<void>((resolve, reject) => {
            currentVideoRef.onloadedmetadata = () => resolve();
            currentVideoRef.onerror = (e) => {
                console.error("Video metadata error:", e);
                reject(new Error(`Video metadata error: ${e}`));
            };
          });

           if (cancelled || !isMounted) {
             setIsInitializing(false);
             return;
            } // Check again after await

          await currentVideoRef.play(); // Play the video stream

           if (cancelled || !isMounted) {
               setIsInitializing(false);
               return;
            } // Check again after await
          console.log("Video stream attached and playing.");
          setIsInitializing(false); // Camera is ready

          if (reader) {
            console.log("Starting barcode decoding from video device...");
            reader.decodeFromVideoDevice(undefined, currentVideoRef, (result, err) => {
              // Check if still mounted and scanning should be active
              if (cancelled || !isMounted || !isScanningActive) return;

              if (result) {
                console.log('Barcode detected:', result.getText());
                const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, ''); // Clean barcode
                playBeep(900, 80);
                onScanSuccess(detectedBarcode);
                // Automatically stop scanning after success
                stopScanning(); // Call the hook's stop function
              }
              if (err && !(err instanceof NotFoundException)) {
                console.error('Scanning error:', err);
                // Consider adding non-intrusive UI feedback for scanning errors
              }
            }).catch(decodeErr => {
              if (!cancelled && isMounted) {
                console.error("Error starting decodeFromVideoDevice:", decodeErr);
                toast({ variant: "destructive", title: "Error de Escaneo", description: "No se pudo iniciar la decodificación del código de barras."});
                stopScanning(); // Stop on error
              }
            });
            console.log("Barcode decoding started.");
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

        console.error('Error accessing camera or starting scanner:', error.name, error.message, error.stack);
        setHasPermission(false);
        toast({
          variant: 'destructive',
          title: 'Acceso a Cámara Denegado',
          description: `Por favor, habilita los permisos de cámara. Error: ${error.name || error.message}`,
          duration: 9000
        });
        stopScanning(); // Stop on permission error
        setIsInitializing(false);
      }
    };

    if (isEnabled && isScanningActive) {
      console.log("isEnabled and isScanningActive true, initializing scanner...");
      // Delay the initial call slightly to ensure DOM is fully ready
       initTimeoutId = setTimeout(() => {
           if (isEnabled && isScanningActive && isMounted) { // Check again before starting
               initializeScanner();
           }
       }, 50); // Short delay
    } else {
      // Ensure cleanup if the scanner is disabled or explicitly stopped
      stopStream();
      setIsInitializing(false);
    }

    // Cleanup function
    return () => {
      console.log("Cleaning up barcode scanner effect...");
      isMounted = false;
      cancelled = true;
      if (initTimeoutId) clearTimeout(initTimeoutId);
      stopStream(); // Ensure stream is stopped on unmount or dependency change
      setIsInitializing(false);
    };
  // Rerun effect if isEnabled or isScanningActive changes
  }, [isEnabled, isScanningActive, videoRef, onScanSuccess, stopStream, toast, stopScanning]);

  return { isInitializing, hasPermission, startScanning, stopScanning };
}
