

"use client";

import React, { useState, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"; // Import Dialog components
import { Trash, Edit, Plus, Warehouse as WarehouseIcon, AlertTriangle } from "lucide-react"; // Ensure you have these icons
import { cn } from "@/lib/utils";
import { format } from 'date-fns'; // Import format function

interface Warehouse {
  id: string;
  name: string;
}

interface WarehouseManagementProps {
  warehouses: Warehouse[];
  onAddWarehouse: (newWarehouse: Warehouse) => void;
  onUpdateWarehouses: (updatedWarehouses: Warehouse[]) => void;
  onClearDatabaseRequest: () => void; // Add prop for clearing all data
}

export const WarehouseManagement: React.FC<WarehouseManagementProps> = ({
  warehouses,
  onAddWarehouse,
  onUpdateWarehouses,
  onClearDatabaseRequest, // Destructure the new prop
}) => {
  const { toast } = useToast();
  const [newWarehouseId, setNewWarehouseId] = useState("");
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [warehouseToDelete, setWarehouseToDelete] = useState<Warehouse | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [warehouseToEdit, setWarehouseToEdit] = useState<Warehouse | null>(null);
  const [editWarehouseName, setEditWarehouseName] = useState("");


  const handleAddWarehouse = () => {
    let warehouseId = newWarehouseId.trim().toLowerCase().replace(/\s+/g, '');
    const warehouseName = newWarehouseName.trim();

    if (!warehouseName) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un nombre de almacén válido.",
      });
      return;
    }

    // If ID is empty, generate a timestamp ID including date and time
    if (!warehouseId) {
       // Format: YYYYMMDD_HHMMSS
       warehouseId = `wh_${format(new Date(), 'yyyyMMdd_HHmmss')}`;
       toast({
        title: "ID Generado",
        description: `Se ha generado un ID de almacén automático: ${warehouseId}`,
      });
    }

    const newWarehouse = { id: warehouseId, name: warehouseName };
    onAddWarehouse(newWarehouse); // This will trigger the parent's check for duplicates
    setNewWarehouseId(""); // Clear inputs after successful attempt or failure handling in parent
    setNewWarehouseName("");
  };

  const handleDeleteRequest = useCallback((warehouse: Warehouse) => {
    // Prevent deleting the 'main' warehouse
    if (warehouse.id === 'main') {
         toast({
            variant: "destructive",
            title: "Operación no permitida",
            description: "No se puede eliminar el almacén principal ('main').",
        });
        return;
    }
    setWarehouseToDelete(warehouse);
    setIsDeleteDialogOpen(true);
  }, [toast]);

  const confirmDelete = () => {
    if (warehouseToDelete && warehouseToDelete.id !== 'main') {
      const updatedWarehouses = warehouses.filter(w => w.id !== warehouseToDelete.id);
      onUpdateWarehouses(updatedWarehouses);
      toast({
        title: "Almacén eliminado",
      });
       // TODO: Consider deleting associated inventory items from IndexedDB here as well
       // This would require importing the delete functions and calling them
       // e.g., clearInventoryForWarehouse(warehouseToDelete.id);
    } else {
        console.warn("Attempted to delete main warehouse or no warehouse selected.");
    }
    setIsDeleteDialogOpen(false);
    setWarehouseToDelete(null);
  };

  const handleOpenEditDialog = useCallback((warehouse: Warehouse) => {
    setWarehouseToEdit(warehouse);
    setEditWarehouseName(warehouse.name); // Initialize with existing name
    setIsEditDialogOpen(true);
  }, []);

  const handleSaveEdit = () => {
    if (!warehouseToEdit || !editWarehouseName.trim()) {
       toast({
        variant: "destructive",
        title: "Error",
        description: "El nombre del almacén no puede estar vacío.",
      });
      return;
    }

    // Prevent changing the ID of 'main' warehouse if needed (though ID is not edited here)
    // if (warehouseToEdit.id === 'main') { ... }

    const updatedWarehouses = warehouses.map(w =>
      w.id === warehouseToEdit.id ? { ...warehouseToEdit, name: editWarehouseName.trim() } : w
    );
    onUpdateWarehouses(updatedWarehouses);
    toast({
      title: "Almacén actualizado",
    });
    setIsEditDialogOpen(false);
    setWarehouseToEdit(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Administrar Almacenes</h2>
        <p className="text-muted-foreground">
          Agregar, editar o eliminar almacenes existentes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Add Warehouse Form */}
        <div className="space-y-2 p-4 border rounded-lg bg-card dark:bg-gray-800 shadow-sm">
          <h3 className="text-lg font-semibold">Agregar Nuevo Almacén</h3>
          <div className="grid grid-cols-1 gap-2">
            <Input
              type="text"
              placeholder="ID (opcional, se genera si está vacío)"
              value={newWarehouseId}
              onChange={(e) => setNewWarehouseId(e.target.value)} // Removed automatic processing here
              className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              aria-label="ID del nuevo almacén (opcional)"
            />
            <Input
              type="text"
              placeholder="Nombre del Almacén (ej. 'Almacén Secundario')"
              value={newWarehouseName}
              onChange={(e) => setNewWarehouseName(e.target.value)}
              className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              aria-label="Nombre del nuevo almacén"
            />
          </div>
           <p className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
                Si deja el ID vacío, se generará uno automáticamente (ej. wh_20240729_103055). Si lo introduce, debe ser único y sin espacios (se convertirá a minúsculas).
           </p>
          <Button onClick={handleAddWarehouse}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar Almacén
          </Button>
        </div>

        {/* Existing Warehouses List */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Almacenes Existentes</h3>
          <ScrollArea className="max-h-[300px] border rounded-md shadow-sm bg-white dark:bg-gray-800">
            <Table>
              <TableCaption className="dark:text-gray-400">Lista de almacenes existentes.</TableCaption>
              <TableHeader className="sticky top-0 bg-background dark:bg-gray-700 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-[100px] dark:text-gray-300">ID</TableHead>
                  <TableHead className="dark:text-gray-300">Nombre</TableHead>
                  <TableHead className="text-right dark:text-gray-300">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouses.length > 0 ? warehouses.map((warehouse) => (
                  <TableRow key={warehouse.id} className="hover:bg-muted/50 dark:hover:bg-gray-700 text-sm transition-colors duration-150">
                    <TableCell className="font-medium dark:text-gray-100">{warehouse.id}</TableCell>
                    <TableCell className="dark:text-gray-100">{warehouse.name}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEditDialog(warehouse)}
                        aria-label={`Editar ${warehouse.name}`}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                      >
                        <Edit className="mr-1 h-4 w-4" />
                        Editar
                      </Button>
                      {/* Prevent deleting the 'main' warehouse */}
                      {warehouse.id !== 'main' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteRequest(warehouse)}
                           aria-label={`Borrar ${warehouse.name}`}
                           className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                           disabled={warehouse.id === 'main'} // Explicitly disable for main
                        >
                          <Trash className="mr-1 h-4 w-4" />
                          Borrar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )) : (
                   <TableRow>
                     <TableCell colSpan={3} className="text-center py-4 text-muted-foreground dark:text-gray-400">
                       No hay almacenes definidos.
                     </TableCell>
                   </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </div>

       {/* Clear Database Button */}
        <div className="mt-6 pt-4 border-t border-destructive/30">
          <h3 className="text-lg font-semibold text-destructive mb-2">Zona de Peligro</h3>
          <Button
              variant="destructive"
              onClick={onClearDatabaseRequest} // Call the passed handler
              className="flex items-center gap-2"
          >
              <AlertTriangle className="h-4 w-4" />
              Borrar Toda la Base de Datos (Productos e Historial)
          </Button>
          <p className="text-xs text-destructive/80 mt-1">
              Esta acción eliminará permanentemente todos los productos y el historial de conteos de la base de datos local. ¡Úsela con precaución!
          </p>
      </div>


      {/* Delete Warehouse Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas eliminar el almacén "{warehouseToDelete?.name}"? Esta acción no se puede deshacer y podría afectar los datos de inventario asociados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Warehouse Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-900 text-black dark:text-white border-teal-500 rounded-lg shadow-xl p-6">
          <DialogHeader>
            <DialogTitle className="text-center text-xl font-semibold text-gray-800 dark:text-gray-200">
                <span className="flex items-center justify-center gap-2">
                    <WarehouseIcon className="h-6 w-6 text-teal-600"/>
                    Editar Almacén ({warehouseToEdit?.id})
                </span>
            </DialogTitle>
            <DialogDescription className="text-center text-gray-600 dark:text-gray-400 mt-1">
              Modifica el nombre de este almacén. El ID no se puede cambiar.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right font-medium text-gray-700 dark:text-gray-300">
                Nombre
              </Label>
              <Input
                id="name"
                value={editWarehouseName}
                onChange={(e) => setEditWarehouseName(e.target.value)}
                className="col-span-3 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="Nombre del Almacén"
                aria-label="Nuevo nombre del almacén"
              />
            </div>
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="button" onClick={handleSaveEdit} className="bg-teal-600 hover:bg-teal-700 text-white">
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
