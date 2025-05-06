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
  startScanning: () => void;
  stopScanning: () => void;
}

const PERMISSION_REQUEST_TIMEOUT = 15000;
const SCAN_SUCCESS_DEBOUNCE_MS = 700; // Increased debounce for stability

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
  const localVideoElementRef = useRef<HTMLVideoElement | null>(null); // Store the video element itself

   const debouncedOnScanSuccess = useCallback(
     debounce((barcode: string) => {
       if (isMountedRef.current && isEnabled) {
           onScanSuccess(barcode);
       }
     }, SCAN_SUCCESS_DEBOUNCE_MS),
     [onScanSuccess, isEnabled]
   );

  const stopStreamAndReader = useCallback(() => {
    console.log("Attempting to stop stream and reader...");
     if (permissionTimeoutRef.current) {
        clearTimeout(permissionTimeoutRef.current);
        permissionTimeoutRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current.reset();
      console.log("ZXing reader reset.");
      // Consider not nullifying readerRef.current to reuse the instance if performance allows
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.log("Camera stream stopped.");
    }
    if (localVideoElementRef.current) {
      localVideoElementRef.current.srcObject = null;
      if (localVideoElementRef.current.parentNode) { // Check if still in DOM
        localVideoElementRef.current.load(); // Ensure video stops loading data
      }
      console.log("Video source cleared.");
      // localVideoElementRef.current = null; // Don't nullify if videoRef from parent is persistent
    }
    setIsInitializing(false);
    console.log("stopStreamAndReader completed.");
  }, []);

  // Public function to signal the start of scanning intent
  const startScanning = useCallback(() => {
    console.log("useBarcodeScanner: User explicitly called startScanning.");
    // This function itself doesn't start the stream, it relies on isEnabled and useEffect.
    // If isEnabled is false, the useEffect will handle cleanup.
    // If isEnabled is true and videoRef.current is not ready, useEffect will wait.
    // We could potentially trigger a permission request here if not already granted,
    // but the current design handles it within useEffect.
  }, []);

  // Public function to signal stopping the scanning process
  const stopScanning = useCallback(() => {
    console.log("useBarcodeScanner: User explicitly called stopScanning.");
    // This also relies on isEnabled becoming false to trigger cleanup via useEffect.
    // If immediate stop is needed regardless of isEnabled prop, then call stopStreamAndReader directly here.
    // However, the current design ties scanner activity to 'isEnabled'.
  }, []);


  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false; // Flag to prevent actions on unmounted component or if scan is cancelled

    const initializeAndStartScanner = async () => {
      console.log("initializeAndStartScanner: isEnabled:", isEnabled, "isMounted:", isMountedRef.current, "videoRef.current exists:", !!videoRef.current);

      if (!isEnabled || !isMountedRef.current) {
        console.log("initializeAndStartScanner: Preconditions not met or scanning disabled. Stopping stream.");
        stopStreamAndReader();
        return;
      }

      if (!videoRef.current) {
        console.warn("initializeAndStartScanner: Video element ref not available yet. Will retry shortly if still enabled.");
        // Set a brief timeout to allow the ref to become available
        // This is a common pattern if the ref is populated slightly after the effect runs
        const retryTimeout = setTimeout(() => {
            if (isEnabled && isMountedRef.current && !cancelled) {
                initializeAndStartScanner(); // Retry
            }
        }, 100); // Short delay
        return () => clearTimeout(retryTimeout); // Cleanup timeout
      }
      localVideoElementRef.current = videoRef.current; // Store the video element once available

      if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        console.warn("Camera access requires a secure context (HTTPS).");
        toast({ variant: 'destructive', title: 'Contexto Inseguro (HTTP)', description: 'El acceso a la cámara requiere HTTPS.', duration: 9000 });
        if(isMountedRef.current) setHasPermission(false);
        if(isMountedRef.current) setIsInitializing(false);
        return;
      }

      if(isMountedRef.current) setIsInitializing(true);
      if(isMountedRef.current) setHasPermission(null);

       if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);

      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
        console.log("ZXing BrowserMultiFormatReader instance created.");
      }
      const reader = readerRef.current;
      const currentVideoEl = localVideoElementRef.current; // Use the locally stored ref

       if (!currentVideoEl) { // Should not happen if the initial check passed, but good for safety
            console.error("initializeAndStartScanner: Local video element ref became null unexpectedly.");
            if(isMountedRef.current) setIsInitializing(false);
            return;
        }


      permissionTimeoutRef.current = setTimeout(() => {
         if (isMountedRef.current && isInitializing && hasPermission === null && !cancelled) {
            console.warn("Camera permission request timed out.");
            toast({ variant: 'destructive', title: 'Tiempo de Espera Excedido', description: 'La solicitud de permiso de cámara tardó demasiado.', duration: 9000 });
             stopStreamAndReader();
         }
      }, PERMISSION_REQUEST_TIMEOUT);

      try {
        console.log("Requesting camera permission...");
        const constraints = { video: { facingMode: "environment" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);

        if (cancelled || !isMountedRef.current || !isEnabled) {
          console.log("Initialization cancelled or unmounted/disabled during permission grant.");
          stream.getTracks().forEach(track => track.stop());
          if(isMountedRef.current) setIsInitializing(false);
          return;
        }

        console.log("Camera permission granted.");
        if(isMountedRef.current) setHasPermission(true);
        streamRef.current = stream;

          currentVideoEl.srcObject = stream;
          await currentVideoEl.play();
          console.log("Video stream playing.");
          if(isMountedRef.current) setIsInitializing(false);

            if (cancelled || !isMountedRef.current || !isEnabled) {
                console.log("Scanning cancelled/unmounted/disabled after play.");
                stopStreamAndReader();
                return;
            }

           if (reader && currentVideoEl) { // Ensure reader and video element are still valid
             console.log("Starting barcode decoding loop...");
              const decodeContinuously = () => {
                if (cancelled || !isMountedRef.current || !isEnabled || !readerRef.current || !localVideoElementRef.current || !streamRef.current) {
                  console.log("Stopping decodeContinuously loop due to cancellation or invalid state.");
                  return;
                }
                readerRef.current.decodeFromVideoElement(localVideoElementRef.current).then(result => {
                    if (!cancelled && isMountedRef.current && isEnabled) {
                        const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, '');
                        console.log('Barcode detected:', detectedBarcode);
                        playBeep(900, 80);
                        debouncedOnScanSuccess(detectedBarcode);
                        // To stop after one scan, one would typically call stopStreamAndReader() here
                        // and ensure the parent component controls re-enabling.
                        // For continuous scanning, we'll call decodeContinuously again.
                        // However, ZXing's decodeFromVideoElement often handles continuous scanning internally if not reset.
                        // Let's rely on ZXing's internal loop or a manual restart if needed.
                        // For this implementation, let's assume a single successful scan might be enough
                        // and the parent re-enables if more scans are needed.
                        // If continuous is desired, call decodeContinuously() in a setTimeout or requestAnimationFrame
                        // setTimeout(decodeContinuously, 100); // Example of restarting after a delay
                    }
                }).catch(err => {
                     if (!cancelled && isMountedRef.current && isEnabled) {
                         if (err instanceof NotFoundException) {
                              // No barcode found, continue scanning by restarting the process
                              // console.log("No barcode found, continuing scan via timeout...");
                              setTimeout(() => {
                                  if (!cancelled && isMountedRef.current && isEnabled) {
                                       decodeContinuously(); // Recursively call to continue
                                  }
                              }, 100); // Adjust delay as needed
                         } else {
                             console.error("Error during barcode decoding:", err.name, err.message);
                              if (err.name !== "ChecksumException" && err.name !== "FormatException") { // Ignore common scan errors
                                 toast({ variant: "destructive", title: "Error de Escaneo", description: `Error al decodificar: ${err.message}` });
                                 stopStreamAndReader(); // Stop on significant errors
                              } else {
                                 // For minor scan errors, just try again
                                  setTimeout(() => {
                                      if (!cancelled && isMountedRef.current && isEnabled) {
                                          decodeContinuously();
                                      }
                                  }, 100);
                              }
                         }
                     }
                });
              };
              decodeContinuously(); // Start the decoding loop
             console.log("decodeContinuously loop initiated.");
           }

      } catch (error: any) {
         if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);

        if (cancelled || !isMountedRef.current) {
            console.log("Initialization cancelled or unmounted during error handling.");
            if(isMountedRef.current) setIsInitializing(false);
            return;
        };

        console.error('Error accessing camera or starting scanner:', error.name, error.message);
        if(isMountedRef.current) setHasPermission(false);
        if(isMountedRef.current) setIsInitializing(false);

         let description = 'Ocurrió un error inesperado al acceder a la cámara.';
         if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') { // Added PermissionDeniedError
            description = 'Permiso de cámara denegado. Habilítalo en la configuración de tu navegador.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') { // Added DevicesNotFoundError
            description = 'No se encontró una cámara compatible.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') { // Added TrackStartError
            description = 'La cámara está siendo utilizada por otra aplicación o no se pudo iniciar.';
        } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') { // Added ConstraintNotSatisfiedError
            description = 'Las especificaciones de la cámara solicitadas no son soportadas.';
        } else if (error.name === 'AbortError') {
             description = 'La solicitud de cámara fue abortada.';
        } else if (error.name === 'TypeError') {
             description = 'Error de tipo, posible problema con las capacidades del dispositivo.';
        } else {
            description = `Error desconocido: ${error.name || error.message}`;
        }

        toast({ variant: 'destructive', title: 'Acceso a Cámara Fallido', description: description, duration: 10000 });
        stopStreamAndReader();
      }
    };

    if (isEnabled) {
       initializeAndStartScanner();
    } else {
      stopStreamAndReader();
    }

    return () => {
      console.log("Cleaning up barcode scanner effect. isEnabled:", isEnabled);
      isMountedRef.current = false; // Mark as unmounted
      cancelled = true; // Set cancelled flag
      if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);
      stopStreamAndReader();
    };
  }, [isEnabled, videoRef, debouncedOnScanSuccess, stopStreamAndReader, toast, isInitializing, hasPermission]); // Added isInitializing and hasPermission to dependencies

  return { isInitializing, hasPermission, startScanning, stopScanning };
}

