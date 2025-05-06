// src/components/edit-product-dialog.tsx
"use client";

import type { ProductDetail } from '@/types/product';
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Trash } from "lucide-react";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

// --- Zod Schema for the Edit Dialog (includes stock for the specific warehouse) ---
const editProductSchema = z.object({
  barcode: z.string().min(1, { message: "El código de barras es requerido." }),
  description: z.string().min(1, { message: "La descripción es requerida." }),
  provider: z.string().optional(),
  stock: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? 0 : Number(val)),
    z.number().min(0, { message: "El stock debe ser mayor o igual a 0." }).default(0)
  ),
});

// --- Infer the type from the schema ---
type EditProductValues = z.infer<typeof editProductSchema>;

// --- Props Interface ---
interface EditProductDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  selectedDetail: ProductDetail | null; // Accepts ProductDetail (which might not have full stockPerWarehouse)
  setSelectedDetail: (detail: ProductDetail | null) => void; // Add this prop
  onSubmit: (data: EditProductValues) => Promise<void>; // Expects a Promise now
  onDelete?: (barcode: string) => void; // Optional delete handler
  isProcessing?: boolean; // Optional processing state
  initialStock?: number; // Initial stock value FOR THE CURRENT WAREHOUSE
  context?: 'database' | 'countingList'; // Optional context prop
  warehouseName?: string; // Add warehouse name for context
}

// --- React Component ---
export const EditProductDialog: React.FC<EditProductDialogProps> = ({
  isOpen,
  setIsOpen,
  selectedDetail,
  setSelectedDetail,
  onSubmit,
  onDelete,
  isProcessing = false,
  initialStock = 0,
  context = 'database', // Default context is database
  warehouseName = 'Almacén Principal', // Default warehouse name
}) => {
  const { toast } = useToast();

  // --- Initialize the form ---
  const form = useForm<EditProductValues>({
    resolver: zodResolver(editProductSchema),
    defaultValues: {
      barcode: "",
      description: "",
      provider: "",
      stock: 0,
    },
  });

  // --- Effect to reset form when selectedDetail changes ---
  useEffect(() => {
    if (selectedDetail) {
      form.reset({
        barcode: selectedDetail.barcode,
        description: selectedDetail.description,
        provider: selectedDetail.provider || "",
        stock: initialStock, // Use initialStock prop for stock of the current warehouse
      });
    } else {
      form.reset({ // Reset to empty values when adding new
        barcode: "",
        description: "",
        provider: "",
        stock: 0,
      });
    }
  }, [selectedDetail, initialStock, form]); // Depend on initialStock

  // --- Submit Handler ---
  const handleFormSubmit = async (data: EditProductValues) => {
    try {
      await onSubmit(data);
      // Keep dialog open on error handled in parent, close on success
    } catch (error) {
       console.error("Error during form submission:", error);
       // Toast message should be handled in the parent onSubmit
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    form.reset(); // Reset form on close
     if (setSelectedDetail) {
      setSelectedDetail(null); // Clear selected detail on close
    }
  };

  // --- Render ---
  const isAddingNew = !selectedDetail?.barcode; // Check if adding a new product
  const dialogTitle = isAddingNew ? "Agregar Nuevo Producto" : `Editar Producto (${warehouseName})`;
  const dialogDescription = isAddingNew ?
      "Completa la información para agregar un nuevo producto y su stock inicial." :
      `Modifica los detalles del producto y el stock para el almacén "${warehouseName}".`;
  const stockLabel = `Stock (${warehouseName})`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); else setIsOpen(true); }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="barcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código de Barras</FormLabel>
                  <FormControl>
                    <Input placeholder="Código de Barras" {...field} disabled={!isAddingNew} /> {/* Disable if editing */}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del Producto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del Proveedor (Opcional)" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="stock"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{stockLabel}</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="numeric" placeholder="Stock" {...field} onChange={e => field.onChange(parseInt(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="flex flex-col sm:flex-row sm:justify-between gap-2 mt-4">
               {/* Delete button available only if editing an existing product */}
               {!isAddingNew && onDelete && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => onDelete(selectedDetail!.barcode)} // Use selectedDetail barcode
                    disabled={isProcessing}
                    className="w-full sm:w-auto"
                  >
                    <Trash className="mr-2 h-4 w-4" />
                    Eliminar de DB
                  </Button>
                )}
                 {/* Spacer to push buttons to the right if delete is not shown */}
                 {isAddingNew && <div className="flex-grow"></div>}

                <div className="flex flex-col sm:flex-row sm:justify-end gap-2 w-full sm:w-auto">
                   <DialogClose asChild>
                      <Button type="button" variant="outline" onClick={handleClose} className="w-full sm:w-auto">
                         Cancelar
                      </Button>
                   </DialogClose>
                   <Button type="submit" disabled={isProcessing} className="w-full sm:w-auto">
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {isProcessing ? "Guardando..." : "Guardar Cambios"}
                   </Button>
                </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
