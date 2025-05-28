
// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException, DecodeHintType, BarcodeFormat } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Loader2, VideoOff, AlertTriangle, RefreshCcw, ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BarcodeScannerCameraProps {
  onBarcodeScanned: (barcode: string) => void;
  isScanningActive: boolean; // Overall control from parent if this section is active
  isDecodingActive: boolean; // Specific control if decoding should process results (e.g., button pressed)
}

const BarcodeScannerCameraComponent: React.FC<BarcodeScannerCameraProps> = ({
  onBarcodeScanned,
  isScanningActive,
  isDecodingActive,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [lastScannedTime, setLastScannedTime] = useState<number>(0);
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const isMountedRef = useRef(false);


  const SCAN_DEBOUNCE_TIME = 1500; // Milliseconds to wait before processing the same barcode again

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initializeScanner = useCallback(async () => {
    if (!isScanningActive || !videoRef.current || isInitializing || !isMountedRef.current) {
      if (isScanningActive && !videoRef.current && isMountedRef.current) {
        console.warn("BarcodeScannerCamera: Video element ref not available during initialization attempt.");
      }
      if (isMountedRef.current) setIsLoading(false);
      return;
    }

    if (!isMountedRef.current) return;
    console.log("BarcodeScannerCamera: Starting initializeScanner...");
    setIsInitializing(true);
    setIsLoading(true);
    setError(null);
    
    if (!readerRef.current) {
      const hints = new Map();
      const formats = [
        BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        BarcodeFormat.ITF, BarcodeFormat.DATA_MATRIX, BarcodeFormat.PDF_417, BarcodeFormat.AZTEC
      ];
      hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(DecodeHintType.TRY_HARDER, true);
      readerRef.current = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 100,
        delayBetweenScanSuccess: 500,
      });
      console.log("BarcodeScannerCamera: BrowserMultiFormatReader initialized.");
    }
    const reader = readerRef.current;

    try {
      if (availableVideoDevices.length === 0) {
        console.log("BarcodeScannerCamera: Enumerating video devices...");
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
            await navigator.mediaDevices.getUserMedia({ video: true }); 
        } else {
            throw new Error("getUserMedia is not supported by this browser.");
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        if (!isMountedRef.current) return;
        setAvailableVideoDevices(videoDevices);
        if (videoDevices.length > 0 && !selectedDeviceId) {
          const backCamera = videoDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trasera'));
          setSelectedDeviceId(backCamera ? backCamera.deviceId : videoDevices[0].deviceId);
          console.log("BarcodeScannerCamera: Selected device ID:", backCamera ? backCamera.deviceId : videoDevices[0].deviceId);
        } else if (videoDevices.length === 0) {
          console.warn("BarcodeScannerCamera: No video devices found after enumeration.");
          setError("No se encontraron dispositivos de video.");
          setIsLoading(false);
          setIsInitializing(false);
          setHasPermission(false);
          return;
        }
      }

      if (!selectedDeviceId && availableVideoDevices.length > 0) {
         console.log("BarcodeScannerCamera: Waiting for selectedDeviceId to be set.");
         setIsLoading(false);
         setIsInitializing(false);
         return;
      }
      if (!selectedDeviceId && availableVideoDevices.length === 0 && videoRef.current?.srcObject === null) {
          console.warn("BarcodeScannerCamera: No selected device ID and no devices available.");
          setError("No hay cámara seleccionada o disponible.");
          setIsLoading(false);
          setIsInitializing(false);
          setHasPermission(false);
          return;
      }

      console.log("BarcodeScannerCamera: Requesting camera stream with deviceId:", selectedDeviceId);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: 'environment' },
      });
      if (!isMountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      setHasPermission(true);
      console.log("BarcodeScannerCamera: Camera permission granted, stream obtained.");

      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');

        videoRef.current.onloadedmetadata = () => {
          if (!isMountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
          console.log("BarcodeScannerCamera: Video metadata loaded.");
          videoRef.current!.play().then(() => {
            if (!isMountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
            console.log("BarcodeScannerCamera: Video playback started.");
            setIsLoading(false); 

            if (readerRef.current && videoRef.current && isScanningActive) {
              console.log("BarcodeScannerCamera: Attempting to decode from video device...");
              reader.decodeFromVideoDevice(selectedDeviceId, videoRef.current, (result, decodeErr) => {
                if (!isScanningActive || !isMountedRef.current) return;

                if (result && isDecodingActive) { 
                  const currentTime = Date.now();
                  if (result.getText() !== lastScanned || (currentTime - lastScannedTime > SCAN_DEBOUNCE_TIME)) {
                    console.log("BarcodeScannerCamera: Barcode detected:", result.getText());
                    onBarcodeScanned(result.getText());
                    setLastScanned(result.getText());
                    setLastScannedTime(currentTime);
                    if (videoRef.current) {
                      videoRef.current.style.outline = '3px solid green';
                      setTimeout(() => {
                        if (videoRef.current) videoRef.current.style.outline = 'none';
                      }, 300);
                    }
                  }
                } else if (decodeErr) {
                  if (!(decodeErr instanceof NotFoundException || decodeErr instanceof ChecksumException || decodeErr instanceof FormatException)) {
                     // console.warn("BarcodeScannerCamera: ZXing decoding error (non-critical):", decodeErr.message);
                  }
                }
              });
            }
          }).catch((playError: any) => {
            if (!isMountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
            console.error("BarcodeScannerCamera: Error trying to play video:", playError);
            if (playError.name === "NotAllowedError") {
              setError("El navegador impidió la reproducción automática del video. Intenta interactuar con la página o revisa los permisos.");
            } else {
              setError(`No se pudo reproducir el video de la cámara: ${playError.message}`);
            }
            setIsLoading(false);
            stream.getTracks().forEach(track => track.stop());
            setHasPermission(false);
          });
        };
        videoRef.current.onerror = () => {
          if (!isMountedRef.current) return;
          console.error("BarcodeScannerCamera: Error with video element.");
          setError("Error con el elemento de video.");
          setIsLoading(false);
          setIsInitializing(false);
        };
      } else {
        if (!isMountedRef.current) return;
        console.warn("BarcodeScannerCamera: Video ref or stream not available after getUserMedia.");
        setIsLoading(false);
        setIsInitializing(false);
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      console.error("BarcodeScannerCamera: Error in initializeScanner (getUserMedia or device enumeration):", err);
      setHasPermission(false);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Permiso de cámara denegado. Por favor, habilítalo en la configuración de tu navegador.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setError("No se encontró una cámara compatible. Asegúrate de que tu dispositivo tenga una cámara.");
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setError("La cámara ya está en uso o no se puede acceder. Cierra otras aplicaciones que puedan estar usándola.");
      } else if (err.name === "SecurityError") {
         setError("Error de seguridad al acceder a la cámara. Asegúrate de que la página se sirve sobre HTTPS y que no hay restricciones de política.");
      } else {
        setError(`Error al acceder a la cámara: ${err.name} - ${err.message}`);
      }
      setIsLoading(false);
    } finally {
      if (isMountedRef.current) setIsInitializing(false);
    }
  }, [isScanningActive, selectedDeviceId, onBarcodeScanned, lastScanned, lastScannedTime, isDecodingActive, isInitializing, availableVideoDevices, availableVideoDevices.length]);


  useEffect(() => {
    if (!isScanningActive || typeof navigator === 'undefined' || !navigator.mediaDevices || availableVideoDevices.length > 0) {
      if (availableVideoDevices.length > 0 && !selectedDeviceId && isMountedRef.current) {
        const backCamera = availableVideoDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trasera'));
        setSelectedDeviceId(backCamera ? backCamera.deviceId : availableVideoDevices[0].deviceId);
      }
      return;
    }

    console.log("BarcodeScannerCamera: Attempting to enumerate devices...");
    const getDevices = async () => {
      if (!isMountedRef.current) return;
      setIsLoading(true);
      try {
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
            await navigator.mediaDevices.getUserMedia({ video: true }); 
        } else {
            throw new Error("getUserMedia is not supported by this browser for device enumeration.");
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!isMountedRef.current) return;
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        console.log("BarcodeScannerCamera: Found video devices:", videoDevices);
        setAvailableVideoDevices(videoDevices);

        if (videoDevices.length > 0) {
          const backCamera = videoDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trasera'));
          setSelectedDeviceId(backCamera ? backCamera.deviceId : videoDevices[0].deviceId);
          setHasPermission(true);
          setError(null);
        } else {
          setError("No se encontraron dispositivos de video.");
          setHasPermission(false);
        }
      } catch (err: any) {
        if (!isMountedRef.current) return;
        console.error("BarcodeScannerCamera: Error enumerating devices or getting initial permission:", err);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setError("Permiso de cámara denegado.");
          setHasPermission(false);
        } else {
          setError("No se pudieron listar los dispositivos de cámara.");
          setHasPermission(false);
        }
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };
    getDevices();
  }, [isScanningActive, availableVideoDevices.length, selectedDeviceId]);

  useEffect(() => {
    let currentReader = readerRef.current;
    let currentVideoEl = videoRef.current;

    if (isScanningActive && selectedDeviceId && hasPermission !== false && !isInitializing && videoRef.current) { // Added videoRef.current check
      initializeScanner().catch(initError => {
        console.error("BarcodeScannerCamera: initializeScanner promise rejected in useEffect:", initError);
      });
    } else if (!isScanningActive && (currentVideoEl?.srcObject || currentReader)) {
      console.log("BarcodeScannerCamera: isScanningActive is false. Cleaning up...");
      try {
        currentReader?.reset();
      } catch (e) {
        console.warn("BarcodeScannerCamera: Error during reader.reset() on cleanup:", e);
      }
      if (currentVideoEl?.srcObject) {
        const stream = currentVideoEl.srcObject as MediaStream;
        stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            console.warn("BarcodeScannerCamera: Error stopping track on cleanup:", e);
          }
        });
        currentVideoEl.srcObject = null;
      }
      if (isMountedRef.current) {
        setIsLoading(true); 
        setHasPermission(null); 
        setError(null);
      }
    }

    return () => { 
      console.log("BarcodeScannerCamera: Component cleanup effect running.");
      try {
        currentReader?.reset();
      } catch (e) {
        console.warn("BarcodeScannerCamera: Error during reader.reset() on component unmount:", e);
      }
      if (currentVideoEl?.srcObject) {
        const stream = currentVideoEl.srcObject as MediaStream;
        stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            console.warn("BarcodeScannerCamera: Error stopping track on component unmount:", e);
          }
        });
      }
      readerRef.current = null; // Explicitly nullify on unmount
    };
  }, [isScanningActive, initializeScanner, selectedDeviceId, hasPermission, isInitializing]);


  const handleDeviceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newDeviceId = event.target.value;
    console.log("BarcodeScannerCamera: Device changed to:", newDeviceId);
    if (isMountedRef.current) {
      setSelectedDeviceId(newDeviceId);
      if (readerRef.current) {
          try { readerRef.current.reset(); } catch(e) { console.warn("Error resetting reader on device change", e); }
      }
      if (videoRef.current && videoRef.current.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
          videoRef.current.srcObject = null;
      }
      setHasPermission(null);
      setIsLoading(true);
    }
  };

  if (!isScanningActive) {
    return null;
  }

  return (
    <div className="relative w-full h-full bg-black rounded-md shadow-lg flex flex-col items-center justify-center text-white p-2">
      <div className={cn("w-full h-full aspect-video overflow-hidden rounded-md relative", { 'bg-gray-800': isLoading || error || hasPermission === false })}>
        <video
          ref={videoRef}
          className={cn("w-full h-full object-contain", {
            'hidden': isLoading || error || hasPermission === false || !videoRef.current?.srcObject,
          })}
          playsInline
          muted
          autoPlay
        />

        {hasPermission === false && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-destructive/90 rounded-md">
            <AlertTriangle className="mx-auto h-10 w-10 text-white mb-2" />
            <p className="font-semibold text-lg">Error de Cámara</p>
            <p className="text-sm">{error}</p>
             <Button onClick={() => { if(isMountedRef.current) { setError(null); setHasPermission(null); setIsLoading(true); initializeScanner(); }}} variant="outline" size="sm" className="mt-4 border-white text-white hover:bg-white/20">
              <RefreshCcw className="mr-1 h-3 w-3" /> Reintentar Permiso
            </Button>
          </div>
        )}

        {isLoading && hasPermission !== false && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-black/80 rounded-md">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-2" />
            <p className="text-muted-foreground">{error ? "Reintentando..." : "Inicializando cámara..."}</p>
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </div>
        )}

        {hasPermission === null && !isLoading && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-black/80 rounded-md">
                <ScanLine className="h-12 w-12 text-primary mb-2"/>
                <p className="text-muted-foreground">Esperando permiso de cámara...</p>
            </div>
        )}
        
        {error && hasPermission !== false && !isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center rounded-md">
            <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm text-destructive/90">{error}</p>
            <Button onClick={initializeScanner} variant="outline" size="sm" className="mt-2 text-xs text-white border-white hover:bg-white/20">
              <RefreshCcw className="mr-1 h-3 w-3" /> Reintentar Conexión
            </Button>
          </div>
        )}
      </div>

      {hasPermission && !isLoading && !error && availableVideoDevices.length > 1 && (
        <div className="absolute top-3 left-3 z-10 bg-black/60 p-1 rounded">
          <select
            value={selectedDeviceId || ''}
            onChange={handleDeviceChange}
            className="bg-transparent text-white text-xs border border-gray-500 rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Seleccionar dispositivo de cámara"
          >
            {availableVideoDevices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId} className="text-black bg-white">
                {device.label || `Cámara ${index + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export const BarcodeScannerCamera = React.memo(BarcodeScannerCameraComponent);

