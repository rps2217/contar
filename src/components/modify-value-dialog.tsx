// src/components/modify-value-dialog.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Minus, Plus, Check, Warehouse as WarehouseIcon } from "lucide-react";
import { DisplayProduct } from '@/types/product';
import { useToast } from "@/hooks/use-toast";

interface ModifyValueDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  type: 'count' | 'stock';
  product: DisplayProduct | null;
  warehouseName: string;
  currentValue: number;
  onIncrement: (barcode: string, type: 'count' | 'stock') => void;
  onDecrement: (barcode: string, type: 'count' | 'stock') => void;
  onSet: (barcode: string, type: 'count' | 'stock', value: number, sum?: boolean) => void;
  onClose: () => void;
}

export const ModifyValueDialog: React.FC<ModifyValueDialogProps> = ({
  isOpen,
  setIsOpen,
  type,
  product,
  warehouseName,
  currentValue,
  onIncrement,
  onDecrement,
  onSet,
  onClose
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editingValue, setEditingValue] = useState<string>('');
  const valueInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && isEditing) {
      requestAnimationFrame(() => {
        valueInputRef.current?.focus();
        valueInputRef.current?.select();
      });
    }
     if (!isOpen) {
        setIsEditing(false); // Reset edit mode when dialog closes
        setEditingValue('');
    }
  }, [isOpen, isEditing]);

  if (!product) return null;

  const titleText = type === 'stock' ? `Ajustar Stock (${product.description})` : `Ajustar Cantidad (${product.description})`;
  const descriptionText = type === 'stock' ?
    `Ajuste el stock del producto en este almacén (${warehouseName}). Este cambio se reflejará en la base de datos.` :
    `Ajuste la cantidad contada manualmente en ${warehouseName}.`;

  const handleValueClick = () => {
    setEditingValue(currentValue.toString());
    setIsEditing(true);
  };

  const handleValueSubmit = (e: React.FormEvent | null, sumValue: boolean = false) => {
    if (e) e.preventDefault();
    const valueToProcess = parseInt(editingValue, 10);
    if (!isNaN(valueToProcess)) {
      onSet(product.barcode, type, valueToProcess, sumValue);
    } else {
      toast({ variant: "destructive", title: "Entrada Inválida", description: "Por favor, ingrese un número válido." });
    }
    setEditingValue('');
    setIsEditing(false);
    // Optional: Close dialog after submit, handled by onSet in parent now
    // onClose();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingValue(e.target.value.replace(/\D/g, ''));
  };

  const handleInputBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== valueInputRef.current) {
        setIsEditing(false);
        setEditingValue('');
      }
    }, 150);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleValueSubmit(null, e.shiftKey); // Pass shiftKey status for sum functionality
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditingValue('');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(openState) => { if (!openState) onClose(); else setIsOpen(true); }}>
      <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-900 text-black dark:text-white border-teal-500 rounded-lg shadow-xl p-6">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-semibold text-gray-800 dark:text-gray-200">
            <span className="flex items-center justify-center gap-2">
              <WarehouseIcon className="h-6 w-6 text-teal-600" />
              {warehouseName}
            </span>
            {titleText}
          </DialogTitle>
          <DialogDescription className="text-center text-gray-600 dark:text-gray-400 mt-1">
            {descriptionText}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-6">
          <div className="flex justify-around items-center">
            <Button
              size="lg"
              className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
              onClick={() => onDecrement(product.barcode, type)}
              aria-label={`Disminuir ${type}`}
              disabled={isEditing}
            >
              <Minus className="h-8 w-8 sm:h-10 sm:w-10" />
            </Button>
            {isEditing ? (
              <form onSubmit={(e) => handleValueSubmit(e, false)} className="flex-grow mx-2 sm:mx-4 relative">
                <Input
                  ref={valueInputRef}
                  type="number"
                  pattern="\d*"
                  inputMode="numeric"
                  value={editingValue}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                  onKeyDown={handleInputKeyDown}
                  className="text-5xl sm:text-6xl font-bold text-center w-full h-full p-0 border-2 border-blue-500 dark:bg-gray-800 dark:text-gray-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-md"
                  aria-label="Editar valor"
                  autoFocus
                />
                <div className="absolute -bottom-14 left-0 right-0 flex justify-center gap-2 mt-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="bg-green-100 dark:bg-green-900 border-green-500 hover:bg-green-200 dark:hover:bg-green-800 text-green-700 dark:text-green-300"
                    title="Guardar (Reemplazar)"
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur on button click
                  >
                    <Check className="h-4 w-4 mr-1" /> Guardar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-blue-100 dark:bg-blue-900 border-blue-500 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300"
                    onClick={() => handleValueSubmit(null, true)}
                    title="Sumar a la cantidad actual (Shift+Enter)"
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur on button click
                  >
                    <Plus className="h-4 w-4 mr-1" /> Sumar
                  </Button>
                </div>
              </form>
            ) : (
              <div
                className="text-5xl sm:text-6xl font-bold mx-4 sm:mx-6 text-gray-800 dark:text-gray-100 tabular-nums select-none cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                onClick={handleValueClick}
                title={`Click para editar ${type}`}
              >
                {currentValue}
              </div>
            )}
            <Button
              size="lg"
              className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
              onClick={() => onIncrement(product.barcode, type)}
              aria-label={`Aumentar ${type}`}
              disabled={isEditing}
            >
              <Plus className="h-8 w-8 sm:h-10 sm:w-10" />
            </Button>
          </div>
        </div>
        <DialogFooter className="mt-16 sm:mt-4">
          <DialogClose asChild>
            <Button type="button" variant="outline" className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={onClose}>
              Cerrar
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
