// src/components/sidebar-layout.tsx
"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Edit, PanelLeftClose, PanelRightOpen, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Warehouse } from '@/types/product'; 

interface SectionItem {
  name: string;
  icon: React.ElementType;
  label: string;
}

interface SidebarLayoutProps {
  isMobileView: boolean;
  isCollapsed: boolean;
  activeSection: string;
  sectionItems: SectionItem[];
  currentUserId: string | null; 
  warehouses: Warehouse[];
  currentWarehouseId: string;
  handleWarehouseChange: (id: string) => void;
  getWarehouseName: (id: string | null | undefined) => string;
  onSectionChange: (section: string) => void;
  onToggleCollapse?: () => void;
  onSignOut: () => void; 
}

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  isMobileView,
  isCollapsed,
  activeSection,
  sectionItems,
  currentUserId,
  warehouses,
  currentWarehouseId,
  handleWarehouseChange,
  getWarehouseName,
  onSectionChange,
  onToggleCollapse,
  onSignOut, 
}) => {
  return (
    <div className={cn("flex flex-col h-full", isMobileView ? "p-0" : "p-4")}>
      <div className={cn(
        "flex items-center",
        isCollapsed && !isMobileView ? "justify-center" : "justify-between",
        isMobileView ? "p-4 border-b mb-2" : "mb-2" 
      )}>
        {!isCollapsed && <h2 className="text-xl font-bold px-2 truncate">StockCounter Pro</h2>}
        {!isMobileView && onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
            title={isCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
          >
            {isCollapsed ? <PanelRightOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </Button>
        )}
      </div>

      <nav className={cn(
          "flex-grow space-y-1",
          isMobileView ? "px-4" : (isCollapsed ? "hidden md:block" : "block")
        )}>
        {sectionItems.map((item) => (
          <Button
            key={item.name}
            variant={activeSection === item.name ? 'secondary' : 'ghost'}
            className={cn(
              "w-full flex items-center gap-2 py-2.5 h-auto text-sm",
              isCollapsed && !isMobileView ? "md:justify-center md:px-0" : "justify-start"
            )}
            onClick={() => onSectionChange(item.name)}
            title={item.label}
          >
            <item.icon className={cn("h-5 w-5 flex-shrink-0",
              !isCollapsed && "mr-1",
              isCollapsed && !isMobileView && "md:mr-0"
            )} />
            {(!isCollapsed || isMobileView) && <span className="truncate font-semibold">{item.label}</span>}
          </Button>
        ))}
      </nav>

      {(!isCollapsed || isMobileView) && (
        <div className={cn(
            "mt-auto pt-4 border-t border-border",
             isMobileView ? "p-4" : "" 
            )}>
          {warehouses.length > 0 && currentUserId && ( 
            <div className="space-y-2 mb-4 px-2">
              <Label htmlFor="warehouse-select-sidebar-layout" className="text-sm font-medium text-muted-foreground">Almacén Activo:</Label>
              <Select value={currentWarehouseId} onValueChange={handleWarehouseChange} name="warehouse-select-sidebar-layout">
                <SelectTrigger className="w-full bg-background border-border">
                  <SelectValue placeholder="Seleccionar Almacén" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2 px-2">
            <Label htmlFor="user-id-display-sidebar" className="text-sm font-medium text-muted-foreground">
              Usuario:
            </Label>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span id="user-id-display-sidebar" className="text-sm truncate" title={currentUserId || "No conectado"}>
                {currentUserId || 'No conectado'}
              </span>
            </div>
             <Button 
                variant="outline" 
                size="sm" 
                onClick={onSignOut} 
                className="w-full mt-2"
                title="Cerrar sesión"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesión
              </Button>
          </div>
        </div>
      )}
    </div>
  );
};
