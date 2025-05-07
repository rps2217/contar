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
  startScanning: () => void; // Public function to indicate intent to start
  stopScanning: () => void; // Public function to indicate intent to stop
}

const PERMISSION_REQUEST_TIMEOUT = 15000; // 15 seconds
const SCAN_SUCCESS_DEBOUNCE_MS = 700; // Debounce successful scans

export function useBarcodeScanner({
  onScanSuccess,
  videoRef,
  isEnabled
}: UseBarcodeScannerOptions): UseBarcodeScannerResult {
  const { toast } = useToast();
  const [isInitializing, setIsInitializing] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null); // null: unknown, true: granted, false: denied
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);
  const permissionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeDecodeTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for active decoding timeout

  // Debounce the success callback to prevent multiple triggers from a single scan
  const debouncedOnScanSuccess = useCallback(
    debounce((barcode: string) => {
      if (isMountedRef.current && isEnabled) {
        console.log("Debounced scan success triggered for:", barcode);
        onScanSuccess(barcode);
      } else {
         console.log("Debounced scan success skipped (unmounted or disabled).");
      }
    }, SCAN_SUCCESS_DEBOUNCE_MS),
    [onScanSuccess, isEnabled] // Recreate debounce if isEnabled changes
  );

  // Cleanup function to stop stream and reader
  const stopStreamAndReader = useCallback(() => {
    console.log("Attempting to stop stream and reader...");

    // Clear any pending decoding loops
     if (activeDecodeTimeoutRef.current) {
       clearTimeout(activeDecodeTimeoutRef.current);
       activeDecodeTimeoutRef.current = null;
       console.log("Cleared active decoding timeout.");
     }

    // Clear permission timeout
    if (permissionTimeoutRef.current) {
      clearTimeout(permissionTimeoutRef.current);
      permissionTimeoutRef.current = null;
      console.log("Cleared permission request timeout.");
    }

    // Reset the ZXing reader
    if (readerRef.current) {
      try {
        readerRef.current.reset();
        console.log("ZXing reader reset.");
      } catch (resetError) {
        console.warn("Error resetting ZXing reader:", resetError);
      }
      // Don't nullify readerRef, reuse instance if possible
    }

    // Stop camera stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
          console.log(`Stopped track: ${track.kind} (${track.label})`);
        } catch (trackStopError) {
          console.warn("Error stopping media track:", trackStopError);
        }
      });
      streamRef.current = null;
      console.log("Camera stream stopped.");
    }

    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load(); // Important to reset video element state
      console.log("Video source cleared and load() called.");
    }

    // Update state only if component is still mounted
    if (isMountedRef.current) {
      setIsInitializing(false); // Ensure initializing state is false when stopped
      // Do not reset hasPermission here, as it reflects the last known status
    }
    console.log("stopStreamAndReader completed.");
  }, [videoRef]); // Dependencies

  // --- Public Control Functions ---

  // Signals intent to start scanning, relies on isEnabled prop and useEffect
  const startScanning = useCallback(() => {
    console.log("useBarcodeScanner: User called startScanning (relies on isEnabled).");
    // The actual start logic is within the useEffect based on isEnabled
  }, []);

  // Signals intent to stop scanning, relies on isEnabled prop and useEffect
  const stopScanning = useCallback(() => {
    console.log("useBarcodeScanner: User called stopScanning (relies on isEnabled).");
    // Explicitly call stopStreamAndReader for immediate effect if needed,
    // although the useEffect hook driven by `isEnabled` is the primary control mechanism.
    stopStreamAndReader();
  }, [stopStreamAndReader]);

  // --- Main Effect for Scanner Initialization and Control ---

  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false; // Flag to prevent actions on unmounted/cancelled state

    const initializeAndStartScanner = async () => {
       console.log("Effect triggered: isEnabled:", isEnabled, "isMounted:", isMountedRef.current, "videoRef exists:", !!videoRef.current);

      if (!isEnabled || !isMountedRef.current) {
        console.log("Scanner effect: Not enabled or unmounted. Ensuring cleanup.");
        stopStreamAndReader();
        return;
      }

      // --- Pre-checks ---
      if (typeof window === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
         console.error("Camera access (getUserMedia) not supported in this environment.");
         toast({ variant: 'destructive', title: 'Cámara no Soportada', description: 'Tu navegador o dispositivo no soporta el acceso a la cámara.', duration: 9000 });
         if (isMountedRef.current) setHasPermission(false);
         return;
      }

      if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        console.warn("Camera access requires a secure context (HTTPS).");
        toast({ variant: 'destructive', title: 'Contexto Inseguro (HTTP)', description: 'El acceso a la cámara requiere HTTPS.', duration: 9000 });
        if (isMountedRef.current) setHasPermission(false);
        return;
      }

      if (!videoRef.current) {
        console.error("Video element ref not available during initialization attempt.");
        // We won't retry automatically here; the parent component needs to ensure the ref is stable.
        // If the ref appears later, the useEffect will re-run if `isEnabled` is still true.
        if (isMountedRef.current) setIsInitializing(false);
        return;
      }

      // --- Initialization Start ---
       if(isMountedRef.current) {
         setIsInitializing(true);
         setHasPermission(null); // Reset permission status while initializing
       }

      // Clear previous permission timeout if any
      if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);
      permissionTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current && isInitializing && hasPermission === null && !cancelled) {
          console.warn("Camera permission request timed out.");
          toast({ variant: 'destructive', title: 'Tiempo de Espera Excedido', description: 'La solicitud de permiso de cámara tardó demasiado.', duration: 9000 });
          stopStreamAndReader(); // Stop if timed out
          if (isMountedRef.current) setHasPermission(false); // Mark as denied due to timeout
        }
      }, PERMISSION_REQUEST_TIMEOUT);

      // Initialize ZXing reader instance if needed
      if (!readerRef.current) {
        try {
          readerRef.current = new BrowserMultiFormatReader();
          console.log("ZXing BrowserMultiFormatReader instance created.");
        } catch (readerInitError: any) {
          console.error("Error creating BrowserMultiFormatReader:", readerInitError);
          toast({ variant: 'destructive', title: 'Error Inicializando Escáner', description: `No se pudo crear el lector de códigos: ${readerInitError.message}`, duration: 9000 });
          if (isMountedRef.current) setIsInitializing(false);
          if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current); // Clear timeout on error
          return;
        }
      }
      const reader = readerRef.current;
      const currentVideoEl = videoRef.current; // Capture ref value

      // --- Request Camera Permission and Start Stream ---
      try {
        console.log("Requesting camera permission...");
        const constraints = { video: { facingMode: "environment" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current); // Permission granted/denied, clear timeout

        if (cancelled || !isMountedRef.current || !isEnabled) {
          console.log("Initialization cancelled or unmounted/disabled during permission grant.");
          stream.getTracks().forEach(track => track.stop());
          if (isMountedRef.current) setIsInitializing(false);
          return;
        }

        console.log("Camera permission granted.");
        if (isMountedRef.current) setHasPermission(true);
        streamRef.current = stream; // Store the active stream

        // --- Setup Video Element ---
        if (currentVideoEl) {
          // Ensure previous srcObject is cleared if any
           if (currentVideoEl.srcObject !== stream) {
                currentVideoEl.srcObject = stream;
           }

          currentVideoEl.onerror = (err) => {
            console.error("Video element error:", err);
            toast({ variant: 'destructive', title: 'Error de Video', description: 'Hubo un problema al mostrar el video de la cámara.', duration: 9000 });
            stopStreamAndReader(); // Stop on video error
          };
          await currentVideoEl.play(); // Start playing the video stream
          console.log("Video stream playing.");
        } else {
          console.error("Video element became null before play could be called.");
          stopStreamAndReader();
          return;
        }

        if(isMountedRef.current) setIsInitializing(false); // Initializing done

        if (cancelled || !isMountedRef.current || !isEnabled) {
          console.log("Scanning cancelled/unmounted/disabled after video play started.");
          stopStreamAndReader();
          return;
        }

        // --- Start Decoding Loop ---
        if (reader && currentVideoEl) {
          console.log("Starting barcode decoding loop...");

          const decodeContinuously = () => {
             // Clear previous timeout before starting new decode attempt
             if (activeDecodeTimeoutRef.current) {
               clearTimeout(activeDecodeTimeoutRef.current);
               activeDecodeTimeoutRef.current = null;
             }

             if (cancelled || !isMountedRef.current || !isEnabled || !readerRef.current || !videoRef.current || !streamRef.current) {
               console.log("Stopping decodeContinuously loop (cancelled, unmounted, disabled, or refs invalid).");
               return; // Stop if state changed
             }

            try {
              // Use the current videoRef directly inside the promise chain
              readerRef.current.decodeFromVideoElement(videoRef.current)
                .then(result => {
                  if (!cancelled && isMountedRef.current && isEnabled) {
                    const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, '');
                    console.log('Barcode detected:', detectedBarcode);
                    playBeep(900, 80);
                    debouncedOnScanSuccess(detectedBarcode);
                    // Consider stopping or pausing after success if needed
                    // For now, we'll rely on the debounce to prevent rapid triggers
                    // and let the loop continue via setTimeout below.
                  }
                })
                .catch(err => {
                  if (!cancelled && isMountedRef.current && isEnabled) {
                    if (err instanceof NotFoundException) {
                      // No barcode found, schedule next attempt
                      // console.log("No barcode found, continuing scan...");
                      // Schedule the next attempt using a timeout
                       activeDecodeTimeoutRef.current = setTimeout(decodeContinuously, 100); // Adjust delay if needed
                    } else {
                      console.error("Error during barcode decoding:", err.name, err.message);
                      // Ignore common noise/scan errors
                      if (err.name !== "ChecksumException" && err.name !== "FormatException") {
                        toast({ variant: "destructive", title: "Error de Escaneo", description: `Error al decodificar: ${err.message}` });
                        // Consider stopping on significant errors: stopStreamAndReader();
                        // For now, let's attempt to continue unless it's a critical error
                         activeDecodeTimeoutRef.current = setTimeout(decodeContinuously, 500); // Longer delay after error
                      } else {
                          // Minor scan error, retry quickly
                         activeDecodeTimeoutRef.current = setTimeout(decodeContinuously, 100);
                      }
                    }
                  }
                })
                .finally(() => {
                   // Schedule next attempt only if NotFoundException didn't already do it
                    if (!cancelled && isMountedRef.current && isEnabled && !activeDecodeTimeoutRef.current) {
                      // console.log("Scheduling next decode attempt from finally block.");
                      activeDecodeTimeoutRef.current = setTimeout(decodeContinuously, 100);
                    }
                });
            } catch (decodeError: any) {
              console.error("Synchronous error starting decodeFromVideoElement:", decodeError);
              if (!cancelled && isMountedRef.current) {
                toast({ variant: "destructive", title: "Error de Escaneo Inesperado", description: `Error al iniciar decodificación: ${decodeError.message}`, duration: 9000 });
                stopStreamAndReader(); // Stop on synchronous errors
              }
            }
          };

          decodeContinuously(); // Start the loop
          console.log("decodeContinuously loop initiated.");
        }

      } catch (error: any) {
        if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current); // Clear timeout on error

        if (cancelled || !isMountedRef.current) {
          console.log("Initialization cancelled or unmounted during error handling.");
          if (isMountedRef.current) setIsInitializing(false);
          return;
        }

        console.error('Error accessing camera or starting scanner:', error.name, error.message);
        if(isMountedRef.current) {
           setHasPermission(false);
           setIsInitializing(false);
        }

        let description = 'Ocurrió un error inesperado al acceder a la cámara.';
         if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            description = 'Permiso de cámara denegado. Habilítalo en la configuración de tu navegador.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            description = 'No se encontró una cámara compatible.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            description = 'La cámara está siendo utilizada por otra aplicación o no se pudo iniciar.';
        } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
            description = 'Las especificaciones de la cámara solicitadas no son soportadas.';
        } else if (error.name === 'AbortError') {
             description = 'La solicitud de cámara fue abortada.';
        } else if (error.name === 'TypeError') {
             description = 'Error de tipo, posible problema con las capacidades del dispositivo.';
        } else {
            description = `Error desconocido: ${error.name || error.message}`;
        }

        toast({ variant: 'destructive', title: 'Acceso a Cámara Fallido', description: description, duration: 10000 });
        stopStreamAndReader(); // Ensure cleanup on error
      }
    };

    // Run initialization only when enabled
    if (isEnabled) {
      initializeAndStartScanner();
    } else {
      stopStreamAndReader(); // Cleanup if disabled
    }

    // --- Cleanup Function ---
    return () => {
      console.log("Cleaning up barcode scanner effect (unmount or isEnabled changed). isEnabled:", isEnabled);
      isMountedRef.current = false;
      cancelled = true; // Signal cancellation
      stopStreamAndReader(); // Call the main cleanup function
    };

  }, [isEnabled, videoRef, debouncedOnScanSuccess, stopStreamAndReader, toast]); // Dependencies

  return { isInitializing, hasPermission, startScanning, stopScanning };
}
