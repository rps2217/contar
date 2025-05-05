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

// --- Zod Schema for the Edit Dialog (includes stock) ---
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
  selectedDetail: ProductDetail | null;
  setSelectedDetail: (detail: ProductDetail | null) => void; // Add this prop
  onSubmit: (data: EditProductValues) => Promise<void>; // Expects a Promise now
  onDelete?: (barcode: string) => void; // Optional delete handler
  isProcessing?: boolean; // Optional processing state
  initialStock?: number; // Optional initial stock value
  context?: 'database' | 'countingList'; // Optional context prop
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
        stock: initialStock, // Use initialStock prop for stock
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
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); else setIsOpen(true); }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{selectedDetail ? "Editar Producto" : "Agregar Nuevo Producto"}</DialogTitle>
          <DialogDescription>
            {selectedDetail ? "Modifica los detalles del producto y el stock del almacén principal." : "Completa la información para agregar un nuevo producto."}
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
                    <Input placeholder="Código de Barras" {...field} disabled={!!selectedDetail} />
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
                  <FormLabel>Stock (Almacén Principal)</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="numeric" placeholder="Stock Inicial" {...field} onChange={e => field.onChange(parseInt(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="flex flex-col sm:flex-row sm:justify-between gap-2 mt-4">
               {/* Conditionally render Delete button only if selectedDetail exists and context is database */}
               {selectedDetail && onDelete && context === 'database' && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => onDelete(selectedDetail.barcode)}
                    disabled={isProcessing}
                    className="w-full sm:w-auto"
                  >
                    <Trash className="mr-2 h-4 w-4" />
                    Eliminar
                  </Button>
                )}
                <div className="flex flex-col sm:flex-row sm:justify-end gap-2 w-full">
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
