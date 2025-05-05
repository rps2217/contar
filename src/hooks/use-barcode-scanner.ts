// src/hooks/use-barcode-scanner.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { useToast } from "@/hooks/use-toast";
import { playBeep } from '@/lib/helpers';

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
  const isMountedRef = useRef(true); // Track component mount status
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for init timeout

  // Function to stop camera stream and release resources
  const stopStream = useCallback(() => {
    console.log("Attempting to stop stream...");
    if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.log("Camera stream stopped.");
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null; // Clear video source
       videoRef.current.load(); // Reset video element state
      console.log("Video source cleared.");
    }
    if (readerRef.current) {
      readerRef.current.reset(); // Reset scanner state
      console.log("ZXing reader reset.");
    }
    setIsScanningActive(false); // Ensure scanning is marked as inactive
    setIsInitializing(false); // Ensure initializing state is reset
     // Explicitly set permission to null when stopping, forcing a re-check next time
    // setHasPermission(null); // Commented out: Let's retain permission status unless explicitly denied
    console.log("stopStream completed.");
  }, [videoRef]);

  // Public function to signal the start of scanning intent
  const startScanning = useCallback(() => {
    console.log("useBarcodeScanner: startScanning called.");
    // Reset permission status only if it was previously denied or null
    setHasPermission(prev => (prev === false ? false : null));
    setIsScanningActive(true); // Activate the internal scanning process
  }, []);

  // Public function to signal stopping the scanning process
  const stopScanning = useCallback(() => {
    console.log("useBarcodeScanner: stopScanning called.");
    setIsScanningActive(false); // Deactivate the internal scanning process
    stopStream(); // Ensure stream and scanner are stopped
  }, [stopStream]);

  // Effect to manage the camera and scanner initialization/teardown
  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false; // Flag to prevent race conditions during async ops

    const initializeScanner = async () => {
      console.log("Initializing scanner... isEnabled:", isEnabled, "isScanningActive:", isScanningActive, "isMounted:", isMountedRef.current);

      if (!isEnabled || !isScanningActive || !isMountedRef.current) {
        console.log("Initialization preconditions not met. Stopping stream if active.");
        stopStream();
        return;
      }

      setIsInitializing(true); // Indicate camera is initializing
      setHasPermission(null); // Reset permission status at the start of initialization

      // Wait a moment for the video element to potentially become available
      await new Promise(resolve => setTimeout(resolve, 50));

      if (!videoRef.current) {
        console.error("Video element ref not available after delay.");
        if (!cancelled && isMountedRef.current && isEnabled && isScanningActive) {
          console.log("Retrying initialization...");
          initTimeoutRef.current = setTimeout(initializeScanner, 150); // Retry delay
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

        if (cancelled || !isMountedRef.current) {
          console.log("Initialization cancelled or unmounted during permission grant.");
          stream.getTracks().forEach(track => track.stop());
          setIsInitializing(false);
          return;
        }

        console.log("Camera permission granted.");
        setHasPermission(true); // Update permission state on success
        streamRef.current = stream;

        if (currentVideoRef) { // Double check ref after await
          currentVideoRef.srcObject = stream;
          console.log("Video stream attached to video element.");

          // Play the video stream - handle potential errors
          await currentVideoRef.play().catch(playError => {
              console.error("Error playing video stream:", playError);
              throw playError; // Re-throw to be caught by outer try-catch
          });

          if (cancelled || !isMountedRef.current) {
            console.log("Initialization cancelled or unmounted after play attempt.");
            setIsInitializing(false);
            return;
          }

          console.log("Video stream playing.");
          setIsInitializing(false); // Camera is ready

          if (reader) {
            console.log("Starting barcode decoding from video device...");
            reader.decodeFromVideoDevice(undefined, currentVideoRef, (result, err) => {
              if (cancelled || !isMountedRef.current || !isScanningActive) {
                   console.log("Decoding stopped (cancelled, unmounted, or inactive).");
                   return;
              }

              if (result) {
                const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, ''); // Clean barcode
                console.log('Barcode detected:', detectedBarcode);
                playBeep(900, 80);
                onScanSuccess(detectedBarcode);
                // Don't automatically stop - let the parent component decide via isEnabled
                // stopScanning();
              }
              if (err && !(err instanceof NotFoundException)) {
                console.warn('Scanning error (non-critical):', err);
                // Non-fatal errors, continue scanning
              } else if (err instanceof NotFoundException) {
                  // Normal case, no barcode found in this frame
              }
            }).catch(decodeErr => {
              if (!cancelled && isMountedRef.current) {
                console.error("Error starting decodeFromVideoDevice:", decodeErr);
                toast({ variant: "destructive", title: "Error de Escaneo", description: "No se pudo iniciar la decodificación del código de barras."});
                stopScanning(); // Stop on critical decoding error
                setIsInitializing(false);
                setHasPermission(null); // Reset permission as scanner failed
              }
            });
            console.log("Barcode decoding loop started.");
          }
        } else {
             if (!cancelled) {
                 console.warn("Video ref became null after permission grant.");
                 stream.getTracks().forEach(track => track.stop());
             }
             setIsInitializing(false);
         }

      } catch (error: any) {
        if (cancelled || !isMountedRef.current) {
            console.log("Initialization cancelled or unmounted during error handling.");
            return;
        };

        console.error('Error accessing camera or starting scanner:', error.name, error.message);
        setHasPermission(false); // Explicitly set permission to false on error
        setIsInitializing(false); // Ensure initializing state is reset on error
        toast({
          variant: 'destructive',
          title: 'Acceso a Cámara Denegado',
          description: `Por favor, habilita los permisos de cámara. Error: ${error.name || error.message}`,
          duration: 9000
        });
        stopScanning(); // Stop on permission error
      }
    };

    if (isEnabled && isScanningActive) {
        // Debounce or delay the actual initialization slightly
        if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = setTimeout(() => {
           if (isEnabled && isScanningActive && isMountedRef.current) { // Check again before starting
               initializeScanner();
           }
       }, 100); // Slightly longer delay might help ensure DOM readiness
    } else {
      // Cleanup if the scanner is disabled or explicitly stopped
      console.log("Scanner disabled or stopped. Stopping stream.");
      stopStream();
    }

    // Cleanup function
    return () => {
      console.log("Cleaning up barcode scanner effect...");
      isMountedRef.current = false;
      cancelled = true;
      if (initTimeoutRef.current) {
          clearTimeout(initTimeoutRef.current);
          initTimeoutRef.current = null;
      }
      stopStream(); // Ensure stream is stopped on unmount or dependency change
      setIsInitializing(false);
    };
  }, [isEnabled, isScanningActive, videoRef, onScanSuccess, stopStream, toast, stopScanning, startScanning]); // Added startScanning

  return { isInitializing, hasPermission, startScanning, stopScanning };
}
