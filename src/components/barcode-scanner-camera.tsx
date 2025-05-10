"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { XCircle } from "lucide-react";

interface BarcodeScannerCameraProps {
    onScanSuccess: (barcode: string) => void;
    onScanError: (error: Error) => void;
    onClose: () => void;
}

const BarcodeScannerCamera: React.FC<BarcodeScannerCameraProps> = ({ onScanSuccess, onScanError, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isInitializing, setIsInitializing] = useState(false);
    const [hasCameraAccess, setHasCameraAccess] = useState(false);
    const codeReader = useRef<BrowserMultiFormatReader | null>(null);


    const initializeCamera = useCallback(async () => {
        setIsInitializing(true);
        setHasCameraAccess(false);

        if (codeReader.current) {
            codeReader.current.reset();
            codeReader.current = null;
        }

        const reader = new BrowserMultiFormatReader();
        codeReader.current = reader;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current?.play().then(() => {
                      if (codeReader.current && videoRef.current) {
                          codeReader.current.decodeFromVideoElement(videoRef.current, (result, error) => {
                              if (result) {
                                  onScanSuccess(result.getText());
                              }
                              if (error) {
                                  if (error instanceof NotFoundException) {
                                      // no barcode found, which is normal
                                      return;
                                  }
                                  if (error instanceof ChecksumException || error instanceof FormatException) {
                                      // Corrupted image or format error
                                      return;
                                  }

                                  console.warn("Unexpected decoding problem:", error);
                                  onScanError(error);
                              }
                          });
                      }
                    }).catch(videoError => {
                        console.error("Error playing video:", videoError);
                        onScanError(new Error('Error al iniciar la cámara.'));
                    });
                };
                setHasCameraAccess(true);
            }
        } catch (e: any) {
            console.error("Error accessing camera:", e);
            onScanError(new Error(e.message || 'Error al acceder a la cámara.'));
        } finally {
            setIsInitializing(false);
        }
    }, [onScanSuccess, onScanError]);

    useEffect(() => {
        initializeCamera();

        return () => {
            if (codeReader.current) {
                codeReader.current.reset();
            }
            if (videoRef.current && videoRef.current.srcObject) {
                const stream = videoRef.current.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
                videoRef.current.srcObject = null;
            }
        };
    }, [initializeCamera]);

    return (
        <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-75 z-50 flex justify-center items-center">
            <div className="relative w-full max-w-md mx-auto">
                <button
                    onClick={onClose}
                    className="absolute top-2 right-2 text-white bg-gray-800 bg-opacity-50 rounded-full p-2 hover:bg-gray-700 transition-colors"
                    aria-label="Cerrar escáner"
                >
                    <XCircle className="h-6 w-6" />
                </button>
                {isInitializing ? (
                    <div className="text-white text-center">Inicializando cámara...</div>
                ) : !hasCameraAccess ? (
                    <div className="text-white text-center">Esperando acceso a la cámara...</div>
                ) : (
                    <video ref={videoRef} className="w-full h-auto rounded-md" muted playsInline />
                )}
            </div>
        </div>
    );
};

export default BarcodeScannerCamera;
