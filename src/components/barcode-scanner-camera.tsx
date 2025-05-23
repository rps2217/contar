// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Loader2, VideoOff, AlertTriangle, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BarcodeScannerCameraProps {
  onBarcodeScanned: (barcode: string) => void;
  isScanningActive: boolean;
  // The onStopScanning prop was removed in a previous refactor as the parent controls activation.
  // If it's still needed for a button within this component, it can be re-added.
  // onStopScanning?: () => void; 
}

const BarcodeScannerCameraComponent: React.FC<BarcodeScannerCameraProps> = ({
  onBarcodeScanned,
  isScanningActive,
  // onStopScanning, // Ensure this prop is passed if the button below is to be used.
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [lastScannedTime, setLastScannedTime] = useState<number>(0);
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  const SCAN_DEBOUNCE_TIME = 1500; // Milliseconds to wait before processing the same barcode again

  const initializeScanner = useCallback(async () => {
    if (!isScanningActive || !videoRef.current) {
        if (isScanningActive && !videoRef.current) {
            console.warn("Video element ref not available during initialization attempt, will retry if component mounts.");
        }
        setIsLoading(false); // Ensure loading stops if prerequisites aren't met
        return;
    }

    setIsLoading(true);
    setError(null);

    if (!readerRef.current) {
      readerRef.current = new BrowserMultiFormatReader();
    }
    const reader = readerRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: 'environment' },
      });
      setHasPermission(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS
        
        // Ensure video is playing before attempting to decode
        videoRef.current.onloadedmetadata = async () => {
            try {
                await videoRef.current!.play(); // Ensure video is playing
                setIsLoading(false);
                console.log("Attempting to decode from video device...");
                reader.decodeFromVideoDevice(selectedDeviceId, videoRef.current!, (result, err) => {
                  if (!isScanningActive) { 
                    return;
                  }
                  if (result) {
                    const currentTime = Date.now();
                    if (result.getText() !== lastScanned || (currentTime - lastScannedTime > SCAN_DEBOUNCE_TIME)) {
                      console.log("Barcode detected:", result.getText());
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
                  } else if (err) {
                    if (!(err instanceof NotFoundException || err instanceof ChecksumException || err instanceof FormatException)) {
                      console.warn("ZXing decoding error (non-critical):", err.message);
                    }
                  }
                });
            } catch (playError) {
                console.error("Error playing video stream:", playError);
                setError("No se pudo iniciar el stream de video.");
                setIsLoading(false);
            }
        };
        videoRef.current.onerror = () => {
            setError("Error con el elemento de video.");
            setIsLoading(false);
        };
      } else {
         setIsLoading(false); // videoRef.current is null
      }
    } catch (err: any) {
      console.error("Error initializing camera or scanner:", err);
      setHasPermission(false);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Permiso de cámara denegado. Por favor, habilítalo en la configuración de tu navegador.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setError("No se encontró una cámara compatible. Asegúrate de que tu dispositivo tenga una cámara trasera.");
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setError("La cámara ya está en uso o no se puede acceder. Cierra otras aplicaciones que puedan estar usándola.");
      } else {
        setError(`Error al acceder a la cámara: ${err.message}`);
      }
      setIsLoading(false);
    }
  }, [isScanningActive, onBarcodeScanned, selectedDeviceId, lastScanned, lastScannedTime]);

  // Effect to get available video devices
  useEffect(() => {
    if (!isScanningActive || typeof navigator === 'undefined' || !navigator.mediaDevices) return;

    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true }); // Request permission first
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setAvailableVideoDevices(videoDevices);
        
        if (videoDevices.length > 0 && !selectedDeviceId) {
          const backCamera = videoDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trasera'));
          setSelectedDeviceId(backCamera ? backCamera.deviceId : videoDevices[0].deviceId);
        } else if (videoDevices.length === 0) {
            setError("No se encontraron dispositivos de video.")
        }
      } catch (err) {
        console.error("Error enumerating devices or getting initial permission:", err);
        if ((err as Error).name === "NotAllowedError" || (err as Error).name === "PermissionDeniedError") {
            setError("Permiso de cámara denegado.");
            setHasPermission(false);
        } else {
            setError("No se pudieron listar los dispositivos de cámara.");
        }
        setIsLoading(false);
      }
    };
    getDevices();
  }, [isScanningActive, selectedDeviceId]);

  // Effect to initialize and clean up the scanner
  useEffect(() => {
    let currentReaderInstance = readerRef.current;
    let currentVideoElement = videoRef.current;

    if (isScanningActive && selectedDeviceId && videoRef.current && hasPermission !== false) {
      initializeScanner();
    } else if (!isScanningActive) {
        setIsLoading(true); // Reset loading state when scanning becomes inactive
    }

    return () => {
      console.log("Cleaning up BarcodeScannerCamera component...");
      if (currentReaderInstance) {
        currentReaderInstance.reset();
        readerRef.current = null; // Help with GC by breaking the ref cycle
      }
      if (currentVideoElement && currentVideoElement.srcObject) {
        const stream = currentVideoElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        currentVideoElement.srcObject = null;
        console.log("Camera stream stopped and cleaned.");
      }
       // Reset loading state on cleanup if scanning was active
      if (isScanningActive) setIsLoading(true);
    };
  }, [isScanningActive, initializeScanner, selectedDeviceId, hasPermission]);


  const handleDeviceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDeviceId(event.target.value);
  };

  if (!isScanningActive) {
    return null; 
  }
  
  // Render video element regardless of permission to ensure ref is available for initialization attempt
  // UI feedback for permission/loading/error states will overlay or control visibility.

  return (
    <div className="relative w-full h-full bg-black rounded-md shadow-lg flex flex-col items-center justify-center text-white">
      {/* Video element should always be in the DOM if isScanningActive for ref to be picked up */}
      <video
        ref={videoRef}
        className={cn("w-full h-full object-contain rounded-md", {
          'hidden': isLoading || error || hasPermission === false, // Hide video if loading, error, or no permission
        })}
        playsInline 
        muted
        autoPlay // Added autoPlay
      />

      {hasPermission === false && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-destructive/80 rounded-md">
          <AlertTriangle className="mx-auto h-10 w-10 text-white mb-2" />
          <p className="font-semibold text-lg">Error de Permiso de Cámara</p>
          <p className="text-sm">{error || "No se pudo acceder a la cámara."}</p>
          {/* The onStopScanning prop was removed, so this button's functionality needs to be handled by the parent
              by setting isScanningActive to false. For now, it won't do anything if onStopScanning is not passed. 
          <Button onClick={onStopScanning} variant="outline" className="mt-4 border-white text-white hover:bg-white/20">
            Cerrar Escáner
          </Button> */}
        </div>
      )}

      {isLoading && hasPermission !== false && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-black/70 rounded-md">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-2" />
          <p className="text-muted-foreground">Inicializando cámara...</p>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
      )}
      
      {error && hasPermission !== false && !isLoading && ( 
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center rounded-md">
          <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
          <p className="text-sm text-destructive/90">{error}</p>
          <Button onClick={initializeScanner} variant="outline" size="sm" className="mt-2 text-xs text-white border-white hover:bg-white/20">
            <RefreshCcw className="mr-1 h-3 w-3" /> Reintentar
          </Button>
        </div>
      )}

      {hasPermission && !isLoading && !error && availableVideoDevices.length > 1 && (
        <div className="absolute top-2 left-2 z-10 bg-black/50 p-1 rounded">
          <select
            value={selectedDeviceId || ''}
            onChange={handleDeviceChange}
            className="bg-transparent text-white text-xs border border-gray-600 rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Seleccionar dispositivo de cámara"
          >
            {availableVideoDevices.map(device => (
              <option key={device.deviceId} value={device.deviceId} className="text-black bg-white">
                {device.label || `Cámara ${availableVideoDevices.indexOf(device) + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* The "Stop Scanning" button was part of previous designs but was removed.
          If it's needed, it should call a prop passed from parent to set isScanningActive=false
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent flex justify-center">
        <Button onClick={onStopScanning} variant="destructive" size="sm">
          <VideoOff className="mr-2 h-4 w-4" /> Detener Escáner
        </Button>
      </div> 
      */}
    </div>
  );
};

export const BarcodeScannerCamera = React.memo(BarcodeScannerCameraComponent);
