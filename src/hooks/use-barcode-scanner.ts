// src/hooks/use-barcode-scanner.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { useToast } from "@/hooks/use-toast";
import { playBeep } from '@/lib/helpers';
import { debounce } from '@/lib/utils';

interface UseBarcodeScannerOptions {
  onScanSuccess: (barcode: string) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  isEnabled: boolean; // Control whether the scanner should be active
}

interface UseBarcodeScannerResult {
  isInitializing: boolean;
  hasPermission: boolean | null;
  startScanning: () => void; // Keep public start/stop if needed
  stopScanning: () => void;
}

const PERMISSION_REQUEST_TIMEOUT = 15000;
const SCAN_SUCCESS_DEBOUNCE_MS = 500;

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
  const isMountedRef = useRef(true);
  const permissionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null); // Store the video element itself

   const debouncedOnScanSuccess = useCallback(
     debounce((barcode: string) => {
       if (isMountedRef.current && isEnabled) { // Check isEnabled again
           onScanSuccess(barcode);
       }
     }, SCAN_SUCCESS_DEBOUNCE_MS),
     [onScanSuccess, isEnabled] // isEnabled is a dependency now
   );

  const stopStream = useCallback(() => {
    console.log("Attempting to stop stream...");
     if (permissionTimeoutRef.current) {
        clearTimeout(permissionTimeoutRef.current);
        permissionTimeoutRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current.reset(); // Reset the ZXing reader
      console.log("ZXing reader reset.");
       // readerRef.current = null; // Optionally nullify the ref
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.log("Camera stream stopped.");
    }
    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
      videoElementRef.current.load(); // Ensure video stops loading data
      console.log("Video source cleared and loaded.");
       videoElementRef.current = null; // Clear the stored element ref
    }
    // Don't reset hasPermission here, keep the last known state
    setIsInitializing(false); // Ensure loading state is reset
    console.log("stopStream completed.");
  }, []); // No dependencies needed for stopStream itself

  // Public function to signal the start of scanning intent (optional)
  const startScanning = useCallback(() => {
    console.log("useBarcodeScanner: startScanning called (no direct action, relies on isEnabled).");
    // This function might not be strictly necessary if activation is solely based on isEnabled prop
    // but can be useful for triggering UI changes or initial permission request logic if needed.
  }, []);

  // Public function to signal stopping the scanning process (optional)
  const stopScanning = useCallback(() => {
    console.log("useBarcodeScanner: stopScanning called (no direct action, relies on isEnabled).");
    // stopStream is called by useEffect when isEnabled becomes false
  }, []);


  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    const initializeScanner = async () => {
      console.log("Initializing scanner... isEnabled:", isEnabled, "isMounted:", isMountedRef.current);

      if (!isEnabled || !isMountedRef.current) {
        console.log("Initialization preconditions not met or scanning disabled.");
        stopStream();
        return;
      }

      // Check for secure context
      if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        console.warn("Camera access requires a secure context (HTTPS).");
        toast({ variant: 'destructive', title: 'Contexto Inseguro (HTTP)', description: 'El acceso a la cámara requiere HTTPS.', duration: 9000 });
        setHasPermission(false);
        setIsInitializing(false);
        return;
      }

      setIsInitializing(true);
      setHasPermission(null);

       // Clear previous permission timeout
       if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);


      if (!videoRef.current) {
        console.error("Video element ref not available during initialization attempt.");
        setIsInitializing(false);
        // No automatic retry here, parent component needs to ensure ref is ready
        return;
      }
      videoElementRef.current = videoRef.current; // Store the video element
      const currentVideoEl = videoElementRef.current;


      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
        console.log("ZXing BrowserMultiFormatReader instance created.");
      }
      const reader = readerRef.current;

      // Timeout for permission request
      permissionTimeoutRef.current = setTimeout(() => {
         if (isInitializing && hasPermission === null && !cancelled) {
            console.warn("Camera permission request timed out.");
            toast({ variant: 'destructive', title: 'Tiempo de Espera Excedido', description: 'La solicitud de permiso de cámara tardó demasiado.', duration: 9000 });
             if(isMountedRef.current) stopStream(); // Clean up on timeout
         }
      }, PERMISSION_REQUEST_TIMEOUT);

      try {
        console.log("Requesting camera permission...");
        const constraints = { video: { facingMode: "environment" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);

        if (cancelled || !isMountedRef.current || !isEnabled) { // Check isEnabled again
          console.log("Initialization cancelled or unmounted/disabled during permission grant.");
          stream.getTracks().forEach(track => track.stop());
          setIsInitializing(false);
          return;
        }

        console.log("Camera permission granted.");
        setHasPermission(true);
        streamRef.current = stream;

        if (currentVideoEl) {
          currentVideoEl.srcObject = stream;
          await currentVideoEl.play();
          console.log("Video stream playing.");
          setIsInitializing(false); // Ready after successful play

            if (cancelled || !isMountedRef.current || !isEnabled) {
                console.log("Scanning cancelled/unmounted/disabled after play.");
                stopStream();
                return;
            }

           if (reader) {
             console.log("Starting barcode decoding loop...");
              reader.decodeFromVideoElement(currentVideoEl).then(result => {
                  if (!cancelled && isMountedRef.current && isEnabled) { // Check again before processing
                      const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, '');
                      console.log('Barcode detected:', detectedBarcode);
                      playBeep(900, 80);
                      debouncedOnScanSuccess(detectedBarcode);
                      // Restart decoding loop after success (if desired)
                      // This creates a continuous scanning loop
                      // Be cautious with performance and battery usage
                      // if (isMountedRef.current && isEnabled) {
                      //      initializeScanner(); // Restart scan
                      // }
                       // For now, let's stop after one successful scan by not restarting the loop
                       // The parent component can re-enable scanning if needed
                      // stopStream(); // Optionally stop after one scan
                  }
              }).catch(err => {
                   if (!cancelled && isMountedRef.current && isEnabled) {
                       if (err instanceof NotFoundException) {
                           // No barcode found, continue scanning by restarting the process
                            console.log("No barcode found, continuing scan...");
                            // Add a small delay before restarting to avoid excessive CPU usage
                            setTimeout(() => {
                                if (!cancelled && isMountedRef.current && isEnabled) {
                                    initializeScanner();
                                }
                            }, 100); // Adjust delay as needed
                       } else {
                           console.error("Error during barcode decoding:", err);
                            toast({ variant: "destructive", title: "Error de Escaneo", description: `Error al decodificar: ${err.message}` });
                            stopStream(); // Stop on significant errors
                       }
                   }
              });

             console.log("decodeFromVideoElement initiated.");
           }

        } else {
             if (!cancelled) {
                 console.warn("Video ref became null after permission grant.");
                 stream.getTracks().forEach(track => track.stop());
                 setIsInitializing(false);
             }
         }

      } catch (error: any) {
         if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);

        if (cancelled || !isMountedRef.current) {
            console.log("Initialization cancelled or unmounted during error handling.");
            setIsInitializing(false);
            return;
        };

        console.error('Error accessing camera or starting scanner:', error.name, error.message);
        setHasPermission(false);
        setIsInitializing(false);

         let description = 'Ocurrió un error inesperado al acceder a la cámara.';
         // ... (keep existing error message handling) ...
         if (error.name === 'NotAllowedError') {
            description = 'Permiso de cámara denegado. Habilítalo en la configuración de tu navegador.';
        } else if (error.name === 'NotFoundError') {
            description = 'No se encontró una cámara compatible.';
        } else if (error.name === 'NotReadableError') {
            description = 'La cámara está siendo utilizada por otra aplicación.';
        } else if (error.name === 'OverconstrainedError') {
            description = 'Las especificaciones de la cámara solicitadas no son soportadas.';
        } else {
            description = `Error: ${error.name || error.message}`;
        }

        toast({ variant: 'destructive', title: 'Acceso a Cámara Fallido', description: description, duration: 10000 });
        stopStream();
      }
    };

    if (isEnabled) {
       initializeScanner();
    } else {
      stopStream(); // Clean up if isEnabled becomes false
    }

    // Cleanup function
    return () => {
      console.log("Cleaning up barcode scanner effect...");
      isMountedRef.current = false;
      cancelled = true;
      if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);
      stopStream(); // Ensure cleanup on unmount or when isEnabled changes to false
    };
  }, [isEnabled, videoRef, debouncedOnScanSuccess, stopStream, toast]); // Dependencies

  return { isInitializing, hasPermission, startScanning, stopScanning };
}
