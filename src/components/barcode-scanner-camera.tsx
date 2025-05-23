// src/components/barcode-scanner-camera.tsx
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { Button } from '@/components/ui/button';
import { Loader2, VideoOff, AlertTriangle, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming you have this utility function

interface BarcodeScannerCameraProps {
  onBarcodeScanned: (barcode: string) => void;
  isScanningActive: boolean;
  onStopScanning: () => void;
}

const BarcodeScannerCamera: React.FC<BarcodeScannerCameraProps> = ({
  onBarcodeScanned,
  isScanningActive,
  onStopScanning,
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
            console.warn("Video ref not available during initialization attempt, will retry if component mounts.");
        }
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
        await videoRef.current.play(); // Ensure video is playing
        setIsLoading(false);

        console.log("Attempting to decode from video device...");
        reader.decodeFromVideoDevice(selectedDeviceId, videoRef.current, (result, err) => {
          if (!isScanningActive) { // Double check if scanning was stopped
            return;
          }
          if (result) {
            const currentTime = Date.now();
            if (result.getText() !== lastScanned || (currentTime - lastScannedTime > SCAN_DEBOUNCE_TIME)) {
              console.log("Barcode detected:", result.getText());
              onBarcodeScanned(result.getText());
              setLastScanned(result.getText());
              setLastScannedTime(currentTime);
              // Optional: brief visual feedback
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
    if (!isScanningActive) return;

    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setAvailableVideoDevices(videoDevices);
        // Prefer back camera if available and no device is selected
        if (!selectedDeviceId && videoDevices.length > 0) {
          const backCamera = videoDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('trasera'));
          if (backCamera) {
            setSelectedDeviceId(backCamera.deviceId);
          } else {
            setSelectedDeviceId(videoDevices[0].deviceId); // Fallback to the first available
          }
        } else if (videoDevices.length > 0 && !selectedDeviceId) {
             setSelectedDeviceId(videoDevices[0].deviceId); // Default to first if no preference
        }
      } catch (err) {
        console.error("Error enumerating devices:", err);
        setError("No se pudieron listar los dispositivos de cámara.");
      }
    };
    getDevices();
  }, [isScanningActive, selectedDeviceId]);

  // Effect to initialize and clean up the scanner
  useEffect(() => {
    let currentReader = readerRef.current;
    let currentVideoElement = videoRef.current;

    if (isScanningActive && hasPermission === null) { // Initial permission request
      initializeScanner();
    } else if (isScanningActive && hasPermission && selectedDeviceId && videoRef.current) {
      // Re-initialize if deviceId changes or if it was previously not permitted/ready
      console.log("Re-initializing scanner due to active state and permission/device ready.");
      initializeScanner();
    }

    return () => {
      console.log("Cleaning up BarcodeScannerCamera component...");
      if (currentReader) {
        currentReader.reset();
        currentReader = null; // Help with GC
        readerRef.current = null;
      }
      if (currentVideoElement && currentVideoElement.srcObject) {
        const stream = currentVideoElement.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        currentVideoElement.srcObject = null;
        console.log("Camera stream stopped and cleaned.");
      }
    };
  }, [isScanningActive, initializeScanner, hasPermission, selectedDeviceId]);


  const handleDeviceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDeviceId(event.target.value);
  };

  if (!isScanningActive) {
    return null; // Don't render anything if scanning is not active
  }

  if (hasPermission === false) {
    return (
      <div className="p-4 text-center bg-destructive/10 border border-destructive rounded-md">
        <AlertTriangle className="mx-auto h-12 w-12 text-destructive mb-2" />
        <p className="font-semibold text-destructive">Error de Permiso de Cámara</p>
        <p className="text-sm text-destructive/80">{error || "No se pudo acceder a la cámara."}</p>
        <Button onClick={onStopScanning} variant="outline" className="mt-4">
          Cerrar Escáner
        </Button>
      </div>
    );
  }

  if (isLoading || hasPermission === null) {
    return (
      <div className="flex flex-col items-center justify-center p-4 aspect-video bg-muted/50 rounded-md">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-2" />
        <p className="text-muted-foreground">Inicializando cámara...</p>
      </div>
    );
  }

  return (
    <div className="relative w-full bg-black rounded-md shadow-lg">
      <div className={cn("aspect-video overflow-hidden rounded-md", { 'hidden': !hasPermission || isLoading })}>
          <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline // Important for iOS
          muted // Often helps with autoplay
          />
      </div>

      {availableVideoDevices.length > 1 && (
        <div className="absolute top-2 left-2 z-10 bg-black/50 p-1 rounded">
          <select
            value={selectedDeviceId}
            onChange={handleDeviceChange}
            className="bg-transparent text-white text-xs border border-gray-600 rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {availableVideoDevices.map(device => (
              <option key={device.deviceId} value={device.deviceId} className="text-black">
                {device.label || `Cámara ${availableVideoDevices.indexOf(device) + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && hasPermission && ( // Show error overlay if permission was granted but something else failed
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 p-4 text-center rounded-md">
          <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
          <p className="text-sm text-destructive/90">{error}</p>
          <Button onClick={initializeScanner} variant="outline" size="sm" className="mt-2 text-xs">
            <RefreshCcw className="mr-1 h-3 w-3" /> Reintentar
          </Button>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent flex justify-center">
        <Button onClick={onStopScanning} variant="destructive" size="sm">
          <VideoOff className="mr-2 h-4 w-4" /> Detener Escáner
        </Button>
      </div>
    </div>
  );
};

export default React.memo(BarcodeScannerCamera);
