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
import { Trash, Edit, Plus, Warehouse as WarehouseIcon } from "lucide-react"; // Ensure you have these icons
import { cn } from "@/lib/utils";

interface Warehouse {
  id: string;
  name: string;
}

interface WarehouseManagementProps {
  warehouses: Warehouse[];
  onAddWarehouse: (newWarehouse: Warehouse) => void;
  onUpdateWarehouses: (updatedWarehouses: Warehouse[]) => void;
}

export const WarehouseManagement: React.FC<WarehouseManagementProps> = ({
  warehouses,
  onAddWarehouse,
  onUpdateWarehouses,
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
    if (!newWarehouseId.trim() || !newWarehouseName.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor, introduce un ID y nombre de almacén válidos.",
      });
      return;
    }

    const newWarehouse = { id: newWarehouseId.trim(), name: newWarehouseName.trim() };
    onAddWarehouse(newWarehouse);
    setNewWarehouseId("");
    setNewWarehouseName("");
  };

  const handleDeleteRequest = useCallback((warehouse: Warehouse) => {
    setWarehouseToDelete(warehouse);
    setIsDeleteDialogOpen(true);
  }, []);

  const confirmDelete = () => {
    if (warehouseToDelete) {
      const updatedWarehouses = warehouses.filter(w => w.id !== warehouseToDelete.id);
      onUpdateWarehouses(updatedWarehouses);
      toast({
        title: "Almacén eliminado",
        description: `${warehouseToDelete.name} ha sido eliminado de la lista de almacenes.`,
        variant: "default"
      });
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
    if (!warehouseToEdit) return;

    const updatedWarehouses = warehouses.map(w =>
      w.id === warehouseToEdit.id ? { ...warehouseToEdit, name: editWarehouseName.trim() } : w
    );
    onUpdateWarehouses(updatedWarehouses);
    toast({
      title: "Almacén actualizado",
      description: `${warehouseToEdit.name} ha sido actualizado a ${editWarehouseName.trim()}.`,
      variant: "default"
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
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Agregar Nuevo Almacén</h3>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="text"
              placeholder="ID del Almacén"
              value={newWarehouseId}
              onChange={(e) => setNewWarehouseId(e.target.value)}
            />
            <Input
              type="text"
              placeholder="Nombre del Almacén"
              value={newWarehouseName}
              onChange={(e) => setNewWarehouseName(e.target.value)}
            />
          </div>
          <Button onClick={handleAddWarehouse}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar Almacén
          </Button>
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Almacenes Existentes</h3>
          <ScrollArea className="max-h-[300px] border rounded-md shadow-sm">
            <Table>
              <TableCaption>Lista de almacenes existentes.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">ID</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouses.map((warehouse) => (
                  <TableRow key={warehouse.id}>
                    <TableCell className="font-medium">{warehouse.id}</TableCell>
                    <TableCell>{warehouse.name}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEditDialog(warehouse)}
                        aria-label={`Editar ${warehouse.name}`}
                      >
                        <Edit className="mr-2 h-4 w-4" />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteRequest(warehouse)}
                         aria-label={`Borrar ${warehouse.name}`}
                      >
                        <Trash className="mr-2 h-4 w-4" />
                        Borrar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que deseas eliminar el almacén "{warehouseToDelete?.name}"? Esta acción no se puede deshacer.
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

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Editar Almacén</DialogTitle>
            <DialogDescription>
              Editar el nombre del almacén.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="name" className="text-right">
                Nombre
              </label>
              <Input
                id="name"
                value={editWarehouseName}
                onChange={(e) => setEditWarehouseName(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="button" onClick={handleSaveEdit}>
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
