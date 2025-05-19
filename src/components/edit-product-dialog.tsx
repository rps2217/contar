
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
    Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, Save, Trash } from "lucide-react";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { format, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';


// --- Zod Schema for the Edit Dialog (includes stock for the specific warehouse) ---
const editProductSchema = z.object({
  barcode: z.string().min(1, { message: "El código de barras es requerido." }),
  description: z.string().min(1, { message: "La descripción es requerida." }),
  provider: z.string().optional(),
  stock: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? 0 : Number(val)),
    z.number().min(0, { message: "El stock debe ser mayor o igual a 0." }).default(0)
  ),
  expirationDate: z.string().optional().refine(val => {
    if (!val) return true; // Optional field
    return /^\d{4}-\d{2}-\d{2}$/.test(val) || isValid(parseISO(val));
  }, { message: "Formato de fecha inválido. Use YYYY-MM-DD." }),
});

// --- Infer the type from the schema ---
type EditProductValues = z.infer<typeof editProductSchema>;

// --- Props Interface ---
interface EditProductDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  selectedDetail: ProductDetail | null;
  setSelectedDetail: (detail: ProductDetail | null) => void;
  onSubmit: (data: EditProductValues) => Promise<void>;
  onDelete?: (barcode: string) => void;
  isProcessing?: boolean;
  initialStock?: number;
  context?: 'database' | 'countingList' | 'expiration';
  warehouseName?: string;
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
  context = 'database',
  warehouseName = 'Almacén Principal',
}) => {
  const { toast } = useToast();

  const form = useForm<EditProductValues>({
    resolver: zodResolver(editProductSchema),
    defaultValues: {
      barcode: "",
      description: "",
      provider: "",
      stock: 0,
      expirationDate: "",
    },
  });

  useEffect(() => {
    if (selectedDetail) {
      form.reset({
        barcode: selectedDetail.barcode,
        description: selectedDetail.description,
        provider: selectedDetail.provider || "",
        stock: context === 'countingList' ? initialStock : (selectedDetail.stock ?? 0),
        expirationDate: selectedDetail.expirationDate || "",
      });
    } else {
      form.reset({
        barcode: "",
        description: "",
        provider: "",
        stock: 0,
        expirationDate: "",
      });
    }
  }, [selectedDetail, initialStock, form, context]);

  const handleFormSubmit = async (data: EditProductValues) => {
    try {
      await onSubmit(data);
    } catch (error) {
       console.error("Error during form submission:", error);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    form.reset(); 
     if (setSelectedDetail) {
      setSelectedDetail(null); 
    }
  };

  const isAddingNew = !selectedDetail?.barcode;
  const dialogTitle = isAddingNew ? "Agregar Nuevo Producto" : 
    (context === 'expiration' ? `Editar Vencimiento (${selectedDetail?.description})` : `Editar Producto (${warehouseName})`);
  const dialogDescription = isAddingNew ?
      "Completa la información para agregar un nuevo producto, su stock inicial y fecha de vencimiento." :
      (context === 'expiration' ? "Modifica la fecha de vencimiento del producto." :
      `Modifica los detalles del producto, el stock para el almacén "${warehouseName}" y su fecha de vencimiento.`);
  
  const stockLabel = context === 'database' || context === 'expiration' ? `Stock (Base de Datos)` : `Stock (${warehouseName})`;


  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); else setIsOpen(true); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="barcode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código de Barras</FormLabel>
                  <FormControl>
                    <Input placeholder="Código de Barras" {...field} disabled={!isAddingNew} />
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
            {context !== 'expiration' && (
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
            )}
             <FormField
              control={form.control}
              name="stock"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{stockLabel}</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      inputMode="numeric" 
                      placeholder="Stock" 
                      {...field} 
                      onChange={e => field.onChange(parseInt(e.target.value) || 0)} 
                      disabled={context === 'expiration'}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
                control={form.control}
                name="expirationDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fecha de Vencimiento (Opcional)</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value && isValid(parseISO(field.value)) ? (
                              format(parseISO(field.value), "PPP", { locale: es })
                            ) : (
                              <span>Seleccionar fecha</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent 
                        className="w-auto p-0" 
                        align="start"
                        onPointerDownOutside={(event) => {
                          event.preventDefault();
                        }}
                        onEscapeKeyDown={(event) => {
                           event.stopPropagation();
                        }}
                      >
                        <Calendar
                          mode="single"
                          selected={field.value && isValid(parseISO(field.value)) ? parseISO(field.value) : undefined}
                          onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                          disabled={(date) =>
                            date < new Date("1900-01-01") 
                          }
                          initialFocus
                          locale={es}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      La fecha en que el producto vence.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            <DialogFooter className="flex flex-col sm:flex-row sm:justify-between gap-2 mt-3">
               {!isAddingNew && onDelete && context !== 'expiration' && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => selectedDetail && onDelete(selectedDetail.barcode)}
                    disabled={isProcessing}
                    className="w-full sm:w-auto"
                  >
                    <Trash className="mr-2 h-4 w-4" />
                    Eliminar de DB
                  </Button>
                )}
                 {(isAddingNew || context === 'expiration') && <div className="flex-grow sm:hidden"></div>}


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

