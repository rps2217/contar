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

const PERMISSION_REQUEST_TIMEOUT = 15000; // 15 seconds timeout for permission request

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
  const isMountedRef = useRef(true);
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const permissionTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout for permission

  // Function to stop camera stream and release resources
  const stopStream = useCallback(() => {
    console.log("Attempting to stop stream...");
    if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
    }
     if (permissionTimeoutRef.current) {
        clearTimeout(permissionTimeoutRef.current);
        permissionTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.log("Camera stream stopped.");
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load();
      console.log("Video source cleared.");
    }
    if (readerRef.current) {
      readerRef.current.reset();
      console.log("ZXing reader reset.");
    }
    setIsScanningActive(false);
    setIsInitializing(false);
    // Don't reset hasPermission here, keep the last known state unless explicitly denied
    console.log("stopStream completed.");
  }, [videoRef]);

  // Public function to signal the start of scanning intent
  const startScanning = useCallback(() => {
    console.log("useBarcodeScanner: startScanning called.");
    // Reset permission status only if it was previously denied or unknown
    setHasPermission(prev => (prev === false ? false : null));
    setIsScanningActive(true);
  }, []);

  // Public function to signal stopping the scanning process
  const stopScanning = useCallback(() => {
    console.log("useBarcodeScanner: stopScanning called.");
    setIsScanningActive(false);
    stopStream();
  }, [stopStream]);

  // Effect to manage the camera and scanner initialization/teardown
  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    const initializeScanner = async () => {
      console.log("Initializing scanner... isEnabled:", isEnabled, "isScanningActive:", isScanningActive, "isMounted:", isMountedRef.current);

      if (!isEnabled || !isScanningActive || !isMountedRef.current) {
        console.log("Initialization preconditions not met.");
        stopStream();
        return;
      }

      // Check for secure context (HTTPS)
      if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        console.warn("Camera access requires a secure context (HTTPS).");
        toast({
          variant: 'destructive',
          title: 'Contexto Inseguro (HTTP)',
          description: 'El acceso a la cámara requiere una conexión segura (HTTPS).',
          duration: 9000
        });
        setHasPermission(false); // Can't get permission on HTTP
        setIsInitializing(false);
        setIsScanningActive(false); // Stop trying
        return;
      }


      setIsInitializing(true);
      setHasPermission(null); // Indicate permission status is unknown/being requested

      // Clear previous timeouts
       if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);
       if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);

      await new Promise(resolve => setTimeout(resolve, 50)); // Short delay for ref

      if (!videoRef.current) {
        console.error("Video element ref not available after delay.");
         if (!cancelled && isMountedRef.current && isEnabled && isScanningActive) {
            initTimeoutRef.current = setTimeout(initializeScanner, 150); // Retry initialization
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

      // Set a timeout for the permission request itself
      permissionTimeoutRef.current = setTimeout(() => {
         if (isInitializing && hasPermission === null) { // If still initializing and permission unknown
            console.warn("Camera permission request timed out.");
            toast({
               variant: 'destructive',
               title: 'Tiempo de Espera Excedido',
               description: 'La solicitud de permiso de cámara tardó demasiado. Inténtalo de nuevo.',
               duration: 9000
            });
            stopScanning(); // Stop the process on timeout
         }
      }, PERMISSION_REQUEST_TIMEOUT);

      try {
        console.log("Requesting camera permission...");
        // Try simpler constraints first if environment fails? For now, stick to environment.
        const constraints = { video: { facingMode: "environment" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        // If we got the stream, clear the permission timeout
        if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);

        if (cancelled || !isMountedRef.current) {
          console.log("Initialization cancelled or unmounted during permission grant.");
          stream.getTracks().forEach(track => track.stop());
          setIsInitializing(false);
          return;
        }

        console.log("Camera permission granted.");
        setHasPermission(true);
        streamRef.current = stream;

        if (currentVideoRef) {
          currentVideoRef.srcObject = stream;
          console.log("Video stream attached to video element.");

           try {
               await currentVideoRef.play();
               console.log("Video stream playing.");
               setIsInitializing(false); // Camera is ready AFTER successful play

                if (cancelled || !isMountedRef.current || !isScanningActive) {
                    console.log("Scanning cancelled/unmounted after play.");
                    stopStream(); // Ensure stream stops if cancelled right after play
                    return;
                }

               if (reader) {
                 console.log("Starting barcode decoding from video device...");
                 reader.decodeFromVideoDevice(undefined, currentVideoRef, (result, err) => {
                   if (cancelled || !isMountedRef.current || !isScanningActive) {
                        console.log("Decoding stopped (cancelled, unmounted, or inactive).");
                        // Reader might need explicit stopping if decodeFromVideoDevice doesn't handle it
                        if(readerRef.current) readerRef.current.reset();
                        return;
                   }

                   if (result) {
                     const detectedBarcode = result.getText().trim().replace(/\r?\n|\r/g, '');
                     console.log('Barcode detected:', detectedBarcode);
                     playBeep(900, 80);
                     onScanSuccess(detectedBarcode);
                   }
                   if (err && !(err instanceof NotFoundException)) {
                     console.warn('Scanning error (non-critical):', err.name, err.message);
                   }
                 }).catch(decodeErr => {
                   if (!cancelled && isMountedRef.current) {
                     console.error("Error starting decodeFromVideoDevice:", decodeErr);
                     toast({ variant: "destructive", title: "Error de Escaneo", description: `No se pudo iniciar la decodificación: ${decodeErr.name}`});
                     stopScanning();
                     setIsInitializing(false);
                     setHasPermission(null);
                   }
                 });
                 console.log("Barcode decoding loop started.");
               }

           } catch (playError: any) {
                console.error("Error playing video stream:", playError.name, playError.message);
                 toast({
                   variant: 'destructive',
                   title: 'Error al Iniciar Cámara',
                   description: `No se pudo iniciar la reproducción de video: ${playError.name}`,
                   duration: 9000
                 });
                stopScanning(); // Stop if video can't play
           }
        } else {
             if (!cancelled) {
                 console.warn("Video ref became null after permission grant.");
                 stream.getTracks().forEach(track => track.stop());
             }
             setIsInitializing(false);
         }

      } catch (error: any) {
         if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current); // Clear timeout on error too

        if (cancelled || !isMountedRef.current) {
            console.log("Initialization cancelled or unmounted during error handling.");
            return;
        };

        console.error('Error accessing camera or starting scanner:', error.name, error.message);
        setHasPermission(false);
        setIsInitializing(false);

         let description = 'Ocurrió un error inesperado al acceder a la cámara.';
         if (error.name === 'NotAllowedError') {
           description = 'Permiso de cámara denegado. Por favor, habilita los permisos en la configuración de tu navegador o dispositivo para este sitio.';
         } else if (error.name === 'NotFoundError') {
           description = 'No se encontró una cámara compatible. Asegúrate de tener una cámara conectada y habilitada.';
         } else if (error.name === 'NotReadableError') {
           description = 'La cámara está siendo utilizada por otra aplicación o el hardware falló.';
         } else if (error.name === 'OverconstrainedError') {
            description = 'Las especificaciones de la cámara solicitadas (ej. facingMode) no son soportadas por tu dispositivo.';
         } else {
             description = `Error: ${error.name || error.message}`;
         }

        toast({
          variant: 'destructive',
          title: 'Acceso a Cámara Fallido',
          description: description,
          duration: 10000 // Longer duration for permission errors
        });
        stopScanning();
      }
    };

    if (isEnabled && isScanningActive) {
       if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
       initTimeoutRef.current = setTimeout(() => {
          if (isEnabled && isScanningActive && isMountedRef.current) {
              initializeScanner();
          }
      }, 100);
    } else {
      stopStream();
    }

    return () => {
      console.log("Cleaning up barcode scanner effect...");
      isMountedRef.current = false;
      cancelled = true;
      if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
      if (permissionTimeoutRef.current) clearTimeout(permissionTimeoutRef.current);
      stopStream();
      setIsInitializing(false);
    };
  }, [isEnabled, isScanningActive, videoRef, onScanSuccess, stopStream, toast, stopScanning]); // Removed startScanning dependency as it triggers state change

  return { isInitializing, hasPermission, startScanning, stopScanning };
}
