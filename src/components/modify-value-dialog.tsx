// src/components/modify-value-dialog.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Minus, Plus, Check, Warehouse as WarehouseIcon } from "lucide-react";
import type { DisplayProduct } from '@/types/product'; // Ensure DisplayProduct is correctly typed
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

  // Effect to focus input when editing starts
  useEffect(() => {
    if (isOpen && isEditing) {
      requestAnimationFrame(() => {
        valueInputRef.current?.focus();
        valueInputRef.current?.select();
      });
    }
  }, [isOpen, isEditing]);

  // Effect to reset editing state when the dialog closes or the product changes
  useEffect(() => {
    if (!isOpen) {
        setIsEditing(false);
        setEditingValue('');
    } else {
        // Reset if product changes while open (edge case)
        setIsEditing(false);
        setEditingValue(currentValue.toString()); // Pre-fill with current value if needed for display
    }
  }, [isOpen, product, currentValue]);


  if (!product) return null;

  const titleText = type === 'stock' ? `Ajustar Stock (${product.description})` : `Ajustar Cantidad (${product.description})`;
  const descriptionText = type === 'stock' ?
    `Ajuste el stock del producto en este almacén (${warehouseName}). Este cambio se reflejará en la base de datos.` :
    `Ajuste la cantidad contada manualmente en ${warehouseName}.`;

  const handleValueClick = () => {
    setEditingValue(currentValue.toString()); // Start editing with the current value
    setIsEditing(true);
  };

  // Consolidated handler for both "Guardar" and "Sumar"
  const handleValueSubmit = (sumValue: boolean = false) => {
    if (!product) return;
    const valueToProcess = parseInt(editingValue, 10);

    if (isNaN(valueToProcess) || valueToProcess < 0) {
      toast({ variant: "destructive", title: "Entrada Inválida", description: "Por favor, ingrese un número positivo válido." });
      setEditingValue(currentValue.toString()); // Reset input to current value on invalid input
      return; // Stop processing
    }

    onSet(product.barcode, type, valueToProcess, sumValue);

    // Reset editing state *after* calling onSet
    setIsEditing(false);
    setEditingValue(''); // Clear input after successful submission

    // Keep the dialog open unless explicitly closed by parent via onClose/setIsOpen
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only digits
    setEditingValue(e.target.value.replace(/\D/g, ''));
  };

  const handleInputBlur = () => {
    // Use a small delay to allow submit buttons to be clicked
    setTimeout(() => {
      // Check if focus is still within the component or related elements
      // This check is simplified; a more robust solution might involve tracking related elements.
      if (document.activeElement !== valueInputRef.current && !document.activeElement?.closest('.dialog-submit-button-group')) {
        setIsEditing(false);
        setEditingValue('');
      }
    }, 150);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleValueSubmit(e.shiftKey); // Pass shiftKey status for sum functionality
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditingValue('');
    }
  };

   const handleDialogClose = () => {
    setIsEditing(false); // Ensure editing mode is off when dialog closes
    setEditingValue('');
    onClose(); // Call the original onClose handler
  };

  return (
    <Dialog open={isOpen} onOpenChange={(openState) => { if (!openState) handleDialogClose(); else setIsOpen(true); }}>
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
            {/* Decrement Button */}
            <Button
              size="lg"
              className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
              onClick={() => product && onDecrement(product.barcode, type)}
              aria-label={`Disminuir ${type}`}
              disabled={isEditing || !product} // Disable if editing or no product
            >
              <Minus className="h-8 w-8 sm:h-10 sm:w-10" />
            </Button>

            {/* Value Display / Input */}
            <div className="flex-grow mx-2 sm:mx-4 relative flex justify-center items-center">
              {isEditing ? (
                <form onSubmit={(e) => { e.preventDefault(); handleValueSubmit(false); }} className="w-full">
                  <Input
                    ref={valueInputRef}
                    type="number"
                    pattern="\d*" // Suggest numeric keyboard
                    inputMode="numeric" // Semantic numeric input
                    value={editingValue}
                    onChange={handleInputChange}
                    onBlur={handleInputBlur}
                    onKeyDown={handleInputKeyDown}
                    className="text-5xl sm:text-6xl font-bold text-center w-full h-auto p-2 border-2 border-blue-500 dark:bg-gray-800 dark:text-gray-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-md appearance-none m-0" // Use appearance-none to hide spinners
                    aria-label="Editar valor"
                    autoFocus
                    min="0" // Prevent negative numbers
                  />
                </form>
              ) : (
                <div
                  className="text-5xl sm:text-6xl font-bold text-gray-800 dark:text-gray-100 tabular-nums select-none cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                  onClick={handleValueClick}
                  title={`Click para editar ${type}`}
                  role="button" // Indicate interactivity
                  tabIndex={0} // Make focusable
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleValueClick(); }} // Allow activation with keyboard
                >
                  {currentValue}
                </div>
              )}
            </div>

             {/* Increment Button */}
            <Button
              size="lg"
              className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl shadow-md transition-transform transform hover:scale-105 w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center"
              onClick={() => product && onIncrement(product.barcode, type)}
              aria-label={`Aumentar ${type}`}
              disabled={isEditing || !product} // Disable if editing or no product
            >
              <Plus className="h-8 w-8 sm:h-10 sm:w-10" />
            </Button>
          </div>
           {/* Conditional Buttons for Editing Mode */}
            {isEditing && (
                 <div className="dialog-submit-button-group flex justify-center gap-2 mt-8"> {/* Add class for blur check */}
                  <Button
                    type="button" // Use type="button" to prevent form submission if nested
                    size="sm"
                    variant="outline"
                    className="bg-green-100 dark:bg-green-900 border-green-500 hover:bg-green-200 dark:hover:bg-green-800 text-green-700 dark:text-green-300"
                    title="Guardar (Reemplazar)"
                    onClick={() => handleValueSubmit(false)} // Replace action
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur on button click
                  >
                    <Check className="h-4 w-4 mr-1" /> Guardar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-blue-100 dark:bg-blue-900 border-blue-500 hover:bg-blue-200 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300"
                    onClick={() => handleValueSubmit(true)} // Sum action
                    title="Sumar a la cantidad actual (Shift+Enter)"
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur on button click
                  >
                    <Plus className="h-4 w-4 mr-1" /> Sumar
                  </Button>
                </div>
            )}
        </div>
        <DialogFooter className={isEditing ? "mt-10" : "mt-4"}> {/* Adjust margin based on editing state */}
          <DialogClose asChild>
            <Button type="button" variant="outline" className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={handleDialogClose}>
              Cerrar
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
