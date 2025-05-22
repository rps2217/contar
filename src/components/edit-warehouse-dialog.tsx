
// src/components/edit-warehouse-dialog.tsx
"use client";

import React, { useState, useEffect, useId } from 'react';
import type { Warehouse } from '@/types/product';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from 'lucide-react';

interface EditWarehouseDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  warehouse: Warehouse | null;
  onSave: (updatedWarehouse: Warehouse) => void;
  isProcessing?: boolean;
}

export const EditWarehouseDialog: React.FC<EditWarehouseDialogProps> = ({
  isOpen,
  setIsOpen,
  warehouse,
  onSave,
  isProcessing = false,
}) => {
  const [editedName, setEditedName] = useState("");
  const descriptionId = useId();

  useEffect(() => {
    if (warehouse) {
      setEditedName(warehouse.name);
    }
  }, [warehouse]);

  const handleSubmit = () => {
    if (!warehouse || !editedName.trim()) {
      // Basic validation, can be enhanced with toasts
      alert("El nombre del almacén no puede estar vacío.");
      return;
    }
    onSave({ ...warehouse, name: editedName.trim() });
  };

  const handleClose = () => {
    setIsOpen(false);
    if (warehouse) setEditedName(warehouse.name); // Reset on close
  };

  if (!warehouse) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); else setIsOpen(true); }}>
      <DialogContent className="sm:max-w-md" aria-describedby={descriptionId}>
        <DialogHeader>
          <DialogTitle>Editar Almacén</DialogTitle>
          <DialogDescription id={descriptionId}>
            Modifica el nombre del almacén. El ID (<span className="font-mono text-sm">{warehouse.id}</span>) no se puede cambiar.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="warehouse-name-edit" className="text-right col-span-1">
              Nombre
            </Label>
            <Input
              id="warehouse-name-edit"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              className="col-span-3"
              placeholder="Nombre del Almacén"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isProcessing}>
              Cancelar
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit} disabled={isProcessing || !editedName.trim() || editedName.trim() === warehouse.name}>
            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

EditWarehouseDialog.displayName = 'EditWarehouseDialog';
    