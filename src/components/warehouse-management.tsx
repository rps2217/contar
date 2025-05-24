
// src/components/warehouse-management.tsx
"use client";

import React, { useState, useCallback, useId, useEffect } from 'react';
import type { Warehouse } from '@/types/product';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EditWarehouseDialog } from '@/components/edit-warehouse-dialog';
import { Trash, Edit, Plus, CheckCircle, Building, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_WAREHOUSE_ID } from '@/lib/constants';
import { useToast } from '@/hooks/use-toast';

interface WarehouseManagementProps {
  warehouses: Warehouse[];
  currentWarehouseId: string;
  onAddWarehouse: (name: string) => Promise<void>;
  onUpdateWarehouse: (warehouse: Warehouse) => Promise<void>;
  onDeleteWarehouse: (warehouseId: string) => Promise<void>;
  onSelectWarehouse: (warehouseId: string) => void;
  isLoading: boolean;
}

export const WarehouseManagement: React.FC<WarehouseManagementProps> = ({
  warehouses,
  currentWarehouseId,
  onAddWarehouse,
  onUpdateWarehouse,
  onDeleteWarehouse,
  onSelectWarehouse,
  isLoading: parentIsLoading,
}) => {
  const [newWarehouseName, setNewWarehouseName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [warehouseToDelete, setWarehouseToDelete] = useState<Warehouse | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [warehouseToEdit, setWarehouseToEdit] = useState<Warehouse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const deleteDialogDescriptionId = useId();
  // const editDialogDescriptionId = useId();  // No longer needed if EditWarehouseDialog manages its own

  const handleAddNewWarehouse = async () => {
    if (!newWarehouseName.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'El nombre del almacén no puede estar vacío.' });
      return;
    }
    setIsProcessing(true);
    try {
      await onAddWarehouse(newWarehouseName.trim());
      setNewWarehouseName("");
      // Toast for success is handled by parent (page.tsx) after Firestore operation
    } catch (error) {
      // Error toast is handled by parent
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteRequest = useCallback((warehouse: Warehouse) => {
    if (warehouse.id === DEFAULT_WAREHOUSE_ID) {
      toast({ variant: 'destructive', title: 'Operación no permitida', description: "El Almacén Principal no se puede eliminar." });
      return;
    }
    setWarehouseToDelete(warehouse);
    setIsDeleteDialogOpen(true);
  }, [toast]);

  const confirmDelete = async () => {
    if (warehouseToDelete) {
      setIsProcessing(true);
      try {
        await onDeleteWarehouse(warehouseToDelete.id);
        // Toast for success/failure is handled by parent (page.tsx) after Firestore operation
      } catch (error) {
        // Error toast is handled by parent
      } finally {
        setIsProcessing(false);
        setIsDeleteDialogOpen(false);
        setWarehouseToDelete(null);
      }
    }
  };

  const handleOpenEditDialog = useCallback((warehouse: Warehouse) => {
    setWarehouseToEdit(warehouse);
    setIsEditDialogOpen(true);
  }, []);

  const handleSaveEdit = async (updatedWarehouse: Warehouse) => {
    setIsProcessing(true);
    try {
      await onUpdateWarehouse(updatedWarehouse);
      // Toast for success/failure is handled by parent (page.tsx) after Firestore operation
    } catch (error) {
      // Error toast is handled by parent
    } finally {
      setIsProcessing(false);
      setIsEditDialogOpen(false);
      setWarehouseToEdit(null);
    }
  };
  
  const isLoading = parentIsLoading || isProcessing;

  return (
    <div className="p-4 md:p-6 space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Administración de Almacenes</h2>
        <p className="text-muted-foreground">
          Crea, edita, elimina y selecciona tus almacenes. El ID se genera automáticamente al crear.
        </p>
      </div>

      <Card className="shadow-lg rounded-lg bg-card">
        <CardHeader>
          <CardTitle className="text-xl">Agregar Nuevo Almacén</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="new-warehouse-name" className="text-sm font-medium">Nombre del Nuevo Almacén</Label>
            <Input
              id="new-warehouse-name"
              type="text"
              placeholder="Ej: Bodega Central, Isla #3"
              value={newWarehouseName}
              onChange={(e) => setNewWarehouseName(e.target.value)}
              className="mt-1"
              aria-label="Nombre del nuevo almacén"
              disabled={isLoading}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleAddNewWarehouse} disabled={isLoading || !newWarehouseName.trim()}>
            {isLoading && !warehouseToEdit && !warehouseToDelete ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Agregar Almacén
          </Button>
        </CardFooter>
      </Card>

      <div>
        <h3 className="text-xl font-semibold mb-4">Almacenes Existentes</h3>
        {parentIsLoading && !warehouses.length && <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Cargando almacenes...</div>}
        {!parentIsLoading && warehouses.length === 0 && (
          <p className="text-muted-foreground">No hay almacenes definidos. Agrega uno para comenzar.</p>
        )}
        {warehouses.length > 0 && (
          <ScrollArea className="h-[calc(100vh-500px)] md:h-[calc(100vh-450px)] pr-3 -mr-3">
            <div className="space-y-3">
              {warehouses.map((warehouse) => (
                <Card key={warehouse.id} className={cn("shadow-md hover:shadow-lg transition-shadow rounded-md bg-card", warehouse.id === currentWarehouseId && "border-primary ring-2 ring-primary")}>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-base flex items-center">
                        <Building className="mr-2 h-4 w-4 text-muted-foreground" />
                        {warehouse.name}
                      </CardTitle>
                      {warehouse.id === currentWarehouseId && (
                        <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full dark:bg-green-700 dark:text-green-100">
                          Activo
                        </span>
                      )}
                    </div>
                    <CardDescription className="text-xs text-muted-foreground pt-0.5">ID: {warehouse.id}</CardDescription>
                  </CardHeader>
                  <CardFooter className="flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-2 pt-2 pb-3 px-4">
                    <Button
                      variant={warehouse.id === currentWarehouseId ? "default" : "outline"}
                      size="sm"
                      onClick={() => onSelectWarehouse(warehouse.id)}
                      disabled={isLoading || warehouse.id === currentWarehouseId}
                      className="w-full sm:w-auto"
                      title={warehouse.id === currentWarehouseId ? "Almacén actualmente activo" : `Seleccionar ${warehouse.name} como activo`}
                    >
                      {warehouse.id === currentWarehouseId ? <CheckCircle className="mr-2 h-4 w-4" /> : null}
                      {warehouse.id === currentWarehouseId ? "Activo" : "Seleccionar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenEditDialog(warehouse)}
                      className="w-full sm:w-auto"
                      disabled={isLoading}
                      title={`Editar nombre de ${warehouse.name}`}
                    >
                      <Edit className="mr-1 h-4 w-4" />
                      Editar
                    </Button>
                    {warehouse.id !== DEFAULT_WAREHOUSE_ID && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteRequest(warehouse)}
                        className="w-full sm:w-auto"
                        disabled={isLoading}
                        title={`Eliminar almacén ${warehouse.name}`}
                      >
                        <Trash className="mr-1 h-4 w-4" />
                        Eliminar
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {warehouseToDelete && (
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent aria-describedby={deleteDialogDescriptionId}>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar Eliminación</AlertDialogTitle>
              <AlertDialogDescription id={deleteDialogDescriptionId}>
                ¿Estás seguro de que deseas eliminar el almacén "{warehouseToDelete?.name}" (ID: {warehouseToDelete?.id})? Esta acción no se puede deshacer y también eliminará cualquier lista de conteo asociada en la nube.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)} disabled={isProcessing}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete} className={cn("bg-destructive hover:bg-destructive/90")} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {warehouseToEdit && (
        <EditWarehouseDialog
          isOpen={isEditDialogOpen}
          setIsOpen={setIsEditDialogOpen}
          warehouse={warehouseToEdit}
          onSave={handleSaveEdit}
          isProcessing={isLoading} // Use combined isLoading for dialog processing state
        />
      )}
    </div>
  );
};

WarehouseManagement.displayName = 'WarehouseManagement';
